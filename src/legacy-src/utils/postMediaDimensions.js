const positiveNumber = (value) => {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : null;
};

const { randomUUID } = require('crypto');

/**
 * Convert the authoritative storage upload result into the post media shape.
 * Metadata remains optional so legacy media documents stay backwards-compatible.
 */
const toPostMediaItem = (result) => {
  const width = positiveNumber(result?.width);
  const height = positiveNumber(result?.height);
  const duration = positiveNumber(result?.duration);
  const media = {
    type: result.type,
    url: result.url,
    publicId: result.publicId,
    ...(width && height ? { width, height, aspectRatio: width / height } : {}),
    ...(duration ? { duration } : {})
  };
  if (result.type === 'video') {
    const hlsEnabled = process.env.CLIP_HLS_ENABLED !== 'false';
    media.playback = {
      status: hlsEnabled ? 'processing' : 'failed',
      version: randomUUID(),
      fallbackMp4Url: result.url,
      fallbackPublicId: result.publicId,
      ...(width && height ? { width, height } : {}),
      ...(duration ? { duration } : {}),
      attempts: 0,
      ...(!hlsEnabled ? { failureCode: 'PROCESSING_DISABLED', failedAt: new Date() } : {})
    };
  }
  return media;
};

module.exports = { toPostMediaItem };
