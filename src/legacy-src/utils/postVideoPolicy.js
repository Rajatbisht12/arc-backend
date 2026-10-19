const MAX_VIDEO_BYTES = 500 * 1024 * 1024;
const MAX_POST_VIDEO_BYTES = 1024 * 1024 * 1024;
const MAX_VIDEOS = 5;
const PART_SIZE = 8 * 1024 * 1024;
const VIDEO_TYPES = Object.freeze({ 'video/mp4': 'mp4', 'video/quicktime': 'mov', 'video/webm': 'webm', 'video/x-m4v': 'm4v' });
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const uploadError = (code, message, statusCode = 400) => Object.assign(new Error(message), { code, statusCode });
const validateVideoInput = input => {
  if (!UUID.test(String(input?.clientUploadId || ''))) throw uploadError('INVALID_CLIENT_ID', 'A valid upload identifier is required.');
  if (!Number.isSafeInteger(input?.size) || input.size < 1 || input.size > MAX_VIDEO_BYTES) throw uploadError('VIDEO_SIZE_LIMIT', 'Each video must be no larger than 500 MB.');
  const mimeType = String(input.mimeType || '').toLowerCase().split(';')[0].trim();
  if (!VIDEO_TYPES[mimeType]) throw uploadError('UNSUPPORTED_VIDEO', 'Select an MP4, MOV, M4V, or WebM video.', 415);
  const filename = String(input.filename || 'video').replace(/[\x00-\x1f\x7f/\\]/g, '_').slice(0, 200);
  return { clientUploadId: input.clientUploadId.toLowerCase(), filename, mimeType, size: input.size, extension: VIDEO_TYPES[mimeType], partSize: PART_SIZE, partCount: Math.ceil(input.size / PART_SIZE) };
};
const expectedPartSize = (session, partNumber) => partNumber === session.partCount ? session.size - session.partSize * (session.partCount - 1) : session.partSize;
const verifyParts = (session, parts) => {
  if (parts.length !== session.partCount) throw uploadError('UPLOAD_INCOMPLETE', 'Some video parts are missing. Resume uploading and try again.', 409);
  const sorted = [...parts].sort((a, b) => a.partNumber - b.partNumber);
  for (let index = 0; index < sorted.length; index++) {
    const part = sorted[index];
    if (part.partNumber !== index + 1 || part.size !== expectedPartSize(session, index + 1) || !part.etag) throw uploadError('INVALID_UPLOAD_PARTS', 'Uploaded parts do not match the video size. Resume the upload.', 409);
  }
  return sorted;
};
module.exports = { MAX_VIDEO_BYTES, MAX_POST_VIDEO_BYTES, MAX_VIDEOS, PART_SIZE, VIDEO_TYPES, UUID, uploadError, validateVideoInput, expectedPartSize, verifyParts };
