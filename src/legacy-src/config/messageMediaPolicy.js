const BYTES_PER_MEGABYTE = 1024 * 1024;

/**
 * Authoritative upload contract for message media.
 *
 * There is deliberately no duration limit: message videos are uploaded as-is
 * and the backend does not run the story-video transcoder. Keep clients in
 * sync through GET /api/messages/media-policy instead of inventing their own
 * duration or size limits.
 */
const MESSAGE_MEDIA_POLICY = Object.freeze({
  maxFileBytes: 50 * BYTES_PER_MEGABYTE,
  maxVideoBytes: 50 * BYTES_PER_MEGABYTE,
  maxVideoDurationSeconds: null,
  acceptedVideoMimeTypes: Object.freeze(['video/*']),
  uploadRequestTimeoutMs: 120_000,
});

const getPublicMessageMediaPolicy = () => ({
  video: {
    maxBytes: MESSAGE_MEDIA_POLICY.maxVideoBytes,
    maxMegabytes: MESSAGE_MEDIA_POLICY.maxVideoBytes / BYTES_PER_MEGABYTE,
    maxDurationSeconds: MESSAGE_MEDIA_POLICY.maxVideoDurationSeconds,
    acceptedMimeTypes: [...MESSAGE_MEDIA_POLICY.acceptedVideoMimeTypes],
    codecValidation: false,
  },
  uploadTimeoutMs: MESSAGE_MEDIA_POLICY.uploadRequestTimeoutMs,
});

module.exports = {
  BYTES_PER_MEGABYTE,
  MESSAGE_MEDIA_POLICY,
  getPublicMessageMediaPolicy,
};
