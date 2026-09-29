// These prefixes contain media that is intentionally rendered on public or
// broadly visible product surfaces. Keep private/mixed prefixes (messages,
// stories, user audio and AI output) out of this list until they have an
// authorization-aware CloudFront delivery path.
const PUBLIC_MEDIA_PREFIXES = [
  'gaming-social/avatars/',
  'gaming-social/banners/',
  'gaming-social/group-avatars/',
  'gaming-social/post-covers/',
  'gaming-social/posts/',
  'gaming-social/clips/',
  'gaming-social/tournaments/'
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

  return PUBLIC_MEDIA_PREFIXES.some(prefix => objectKey.startsWith(prefix)) ? objectKey : '';
};

const rewritePublicMediaUrl = (value, environment = process.env) => {
  const cdnBase = normalizeCdnBase(environment.AWS_S3_CDN_URL);
  if (!cdnBase || typeof value !== 'string') return value;
  const objectKey = getPublicS3ObjectKey(
    value,
    environment.AWS_S3_BUCKET || environment.AWS_S3_BUCKET_NAME,
    environment.AWS_REGION
  );
  return objectKey ? `${cdnBase}/${objectKey}` : value;
};

// Backwards-compatible name retained for the Clip-specific call sites and
// contract tests introduced before public-image delivery was centralized.
const rewriteClipMediaUrl = rewritePublicMediaUrl;

const publicMediaJsonReplacer = (_key, value, environment = process.env) => (
  typeof value === 'string' ? rewritePublicMediaUrl(value, environment) : value
);

const rewriteUserMediaDeliveryUrls = (user, environment = process.env) => {
  if (!user || typeof user !== 'object') return user;
  const rewriteField = (target, field) => {
    if (target && typeof target[field] === 'string') {
      target[field] = rewritePublicMediaUrl(target[field], environment);
    }
  };

  for (const field of ['profileImage', 'avatarUrl', 'profilePicture', 'avatar', 'picture', 'photoURL', 'imageUrl']) {
    rewriteField(user, field);
  }
  if (user.profile && typeof user.profile === 'object') {
    for (const field of ['avatar', 'profilePicture', 'banner', 'coverImage']) {
      rewriteField(user.profile, field);
    }
  }
  return user;
};

const rewritePostMediaDeliveryUrls = (post, environment = process.env) => {
  const media = post?.content?.media;
  if (!Array.isArray(media)) return post;

  for (const item of media) {
    if (!item || typeof item !== 'object') continue;
    if (typeof item.url === 'string') item.url = rewritePublicMediaUrl(item.url, environment);
    if (typeof item.coverUrl === 'string') item.coverUrl = rewritePublicMediaUrl(item.coverUrl, environment);
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
  PUBLIC_MEDIA_PREFIXES,
  getPublicS3ObjectKey,
  normalizeCdnBase,
  publicMediaJsonReplacer,
  rewriteClipMediaUrl,
  rewritePublicMediaUrl,
  rewriteUserMediaDeliveryUrls,
  rewritePostMediaDeliveryUrls
};
