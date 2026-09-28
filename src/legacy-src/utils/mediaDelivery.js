const PUBLIC_CLIP_MEDIA_PREFIXES = [
  'gaming-social/posts/',
  'gaming-social/clips/'
];

const normalizeCdnBase = (value) => {
  const candidate = String(value || '').trim();
  if (!candidate) return '';
  try {
    const parsed = new URL(candidate);
    if (parsed.protocol !== 'https:' || parsed.username || parsed.password || parsed.search || parsed.hash) return '';
    return parsed.href.replace(/\/$/, '');
  } catch {
    return '';
  }
};

const getPublicS3ObjectKey = (value, bucket, region) => {
  if (!value || !bucket) return '';
  let parsed;
  try {
    parsed = new URL(String(value));
  } catch {
    return '';
  }
  // Query-bearing S3 URLs may be signed. Never remove or reinterpret their
  // authorization parameters as a public CloudFront URL.
  if (parsed.protocol !== 'https:' || parsed.username || parsed.password || parsed.search || parsed.hash) return '';

  const hostname = parsed.hostname.toLowerCase();
  const normalizedBucket = String(bucket).toLowerCase();
  const normalizedRegion = String(region || 'us-east-1').toLowerCase();
  const virtualHostedOrigins = new Set([
    `${normalizedBucket}.s3.amazonaws.com`,
    `${normalizedBucket}.s3.${normalizedRegion}.amazonaws.com`,
    `${normalizedBucket}.s3-${normalizedRegion}.amazonaws.com`
  ]);

  let objectKey = '';
  if (virtualHostedOrigins.has(hostname)) {
    objectKey = parsed.pathname.replace(/^\/+/, '');
  } else {
    const pathStyleOrigins = new Set([
      's3.amazonaws.com',
      `s3.${normalizedRegion}.amazonaws.com`,
      `s3-${normalizedRegion}.amazonaws.com`
    ]);
    const pathPrefix = `/${bucket}/`;
    if (pathStyleOrigins.has(hostname) && parsed.pathname.startsWith(pathPrefix)) {
      objectKey = parsed.pathname.slice(pathPrefix.length);
    }
  }

  return PUBLIC_CLIP_MEDIA_PREFIXES.some(prefix => objectKey.startsWith(prefix)) ? objectKey : '';
};

const rewriteClipMediaUrl = (value, environment = process.env) => {
  const cdnBase = normalizeCdnBase(environment.AWS_S3_CDN_URL);
  if (!cdnBase || typeof value !== 'string') return value;
  const objectKey = getPublicS3ObjectKey(
    value,
    environment.AWS_S3_BUCKET || environment.AWS_S3_BUCKET_NAME,
    environment.AWS_REGION
  );
  return objectKey ? `${cdnBase}/${objectKey}` : value;
};

const rewritePostMediaDeliveryUrls = (post, environment = process.env) => {
  const media = post?.content?.media;
  if (!Array.isArray(media)) return post;

  for (const item of media) {
    if (!item || typeof item !== 'object') continue;
    if (typeof item.url === 'string') item.url = rewriteClipMediaUrl(item.url, environment);
    if (typeof item.coverUrl === 'string') item.coverUrl = rewriteClipMediaUrl(item.coverUrl, environment);
    const playback = item.playback;
    if (!playback || typeof playback !== 'object') continue;
    if (typeof playback.hlsUrl === 'string') playback.hlsUrl = rewriteClipMediaUrl(playback.hlsUrl, environment);
    if (typeof playback.fallbackMp4Url === 'string') {
      playback.fallbackMp4Url = rewriteClipMediaUrl(playback.fallbackMp4Url, environment);
    }
    if (Array.isArray(playback.renditions)) {
      for (const rendition of playback.renditions) {
        if (rendition && typeof rendition.playlistUrl === 'string') {
          rendition.playlistUrl = rewriteClipMediaUrl(rendition.playlistUrl, environment);
        }
      }
    }
  }
  return post;
};

module.exports = {
  getPublicS3ObjectKey,
  normalizeCdnBase,
  rewriteClipMediaUrl,
  rewritePostMediaDeliveryUrls
};
