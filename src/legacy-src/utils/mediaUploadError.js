const log = require('./logger');

const respondToMediaUploadError = (res, error, publicMessage = 'Failed to upload media') => {
  const requestedStatus = Number(error?.statusCode);
  const status = [413, 415, 422].includes(requestedStatus) ? requestedStatus : 503;
  const code = status === 413
    ? 'MEDIA_TOO_LARGE'
    : status === 415
      ? 'UNSUPPORTED_MEDIA_TYPE'
      : status === 422
        ? 'INVALID_MEDIA'
        : 'MEDIA_STORAGE_UNAVAILABLE';
  log.error('Media upload failed', { error: String(error), status, code });
  return res.status(status).json({ success: false, code, message: publicMessage });
};

module.exports = { respondToMediaUploadError };
