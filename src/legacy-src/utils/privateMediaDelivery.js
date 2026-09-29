const path = require('path');
const { rewritePublicMediaUrl } = require('./mediaDelivery');

// These prefixes contain content whose visibility is decided by an
// authenticated API query. They must never be converted to an unsigned CDN
// URL. A short-lived GET URL is created only after that query authorizes the
// current viewer.
const PRIVATE_MEDIA_PREFIXES = Object.freeze([
  'gaming-social/messages/',
  'gaming-social/stories/',
  'gaming-social/audio/user-uploads/'
]);

const normalizeKey = (value) => {
  const key = String(value || '').replace(/^\/+/, '');
  if (!key || key.includes('..') || key.includes('\\') || key.length > 1024) return '';
  return PRIVATE_MEDIA_PREFIXES.some((prefix) => key.startsWith(prefix)) ? key : '';
};

const getPrivateS3ObjectKey = (value, environment = process.env) => {
  if (typeof value !== 'string' || !value.trim()) return '';
  const directKey = normalizeKey(value);
  if (directKey) return directKey;

  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    return '';
  }
  // An already signed URL remains untouched for its bounded lifetime.
  if (parsed.protocol !== 'https:' || parsed.username || parsed.password || parsed.search || parsed.hash) return '';

  const bucket = String(environment.AWS_S3_BUCKET || environment.AWS_S3_BUCKET_NAME || '').toLowerCase();
  const region = String(environment.AWS_REGION || 'us-east-1').toLowerCase();
  if (!bucket) return '';
  const hostname = parsed.hostname.toLowerCase();
  const virtualHosts = new Set([
    `${bucket}.s3.amazonaws.com`,
    `${bucket}.s3.${region}.amazonaws.com`,
    `${bucket}.s3-${region}.amazonaws.com`
  ]);
  let key = '';
  if (virtualHosts.has(hostname)) {
    key = parsed.pathname.replace(/^\/+/, '');
  } else {
    const cdn = String(environment.AWS_S3_CDN_URL || '').trim();
    try {
      if (cdn && hostname === new URL(cdn).hostname.toLowerCase()) key = parsed.pathname.replace(/^\/+/, '');
    } catch { /* invalid CDN configuration is handled by env validation */ }
    if (!key) {
      const pathHosts = new Set(['s3.amazonaws.com', `s3.${region}.amazonaws.com`, `s3-${region}.amazonaws.com`]);
      const prefix = `/${bucket}/`;
      if (pathHosts.has(hostname) && parsed.pathname.startsWith(prefix)) key = parsed.pathname.slice(prefix.length);
    }
  }
  return normalizeKey(key);
};

const loadSigner = () => {
  // Legacy JS runs from both src (tests) and dist (production). The compiled
  // storage module is the canonical AWS client in both cases.
  const storage = require(path.join(__dirname, '../../../dist/infrastructure/storage/s3'));
  return storage.privateDownloadUrl;
};

const resolveClientMediaPayload = async (
  value,
  environment = process.env,
  signer = loadSigner()
) => {
  const signedByKey = new Map();
  const seen = new WeakSet();
  const sign = async (key) => {
    if (!signedByKey.has(key)) signedByKey.set(key, Promise.resolve(signer(key)));
    return signedByKey.get(key);
  };

  const visit = async (node) => {
    if (typeof node === 'string') return rewritePublicMediaUrl(node, environment);
    if (!node || typeof node !== 'object' || node instanceof Date || Buffer.isBuffer(node)) return node;
    if (seen.has(node)) return node;
    seen.add(node);

    if (Array.isArray(node)) {
      for (let index = 0; index < node.length; index += 1) node[index] = await visit(node[index]);
      return node;
    }

    // Prefer the storage key carried beside the URL, then support legacy rows
    // that persisted only the full S3 URL.
    const objectKey = normalizeKey(node.publicId) || getPrivateS3ObjectKey(node.url, environment);
    if (objectKey) {
      const signedUrl = await sign(objectKey);
      if (typeof node.url === 'string') node.url = signedUrl;
      if (typeof node.streamUrl === 'string') node.streamUrl = signedUrl;
    }

    for (const [key, child] of Object.entries(node)) {
      if (key === 'url' || key === 'streamUrl' || key === 'publicId') {
        if (typeof child === 'string' && !objectKey) node[key] = await visit(child);
        continue;
      }
      node[key] = await visit(child);
    }
    return node;
  };

  return visit(value);
};

module.exports = {
  PRIVATE_MEDIA_PREFIXES,
  getPrivateS3ObjectKey,
  resolveClientMediaPayload
};
