// Shared by task-definition preparation, preflight and API startup. A normal
// release must not silently activate multipart ingestion or stop legacy HLS.
const VIDEO_COMPATIBILITY_FLAGS = Object.freeze({
  POST_VIDEO_UPLOADS_ENABLED: 'false',
  CLIP_HLS_ENABLED: 'true',
  CLIP_HLS_WORKER_ENABLED: 'true',
  POST_VIDEO_PRIVATE_DELIVERY_ENABLED: 'false',
  POST_VIDEO_SOURCE_RETENTION_DAYS: '0',
});

const assertVideoCompatibilityEnvironment = (environment = process.env) => {
  for (const [name, value] of Object.entries(VIDEO_COMPATIBILITY_FLAGS)) {
    if (environment[name] !== value) throw new Error(`Compatibility release requires ${name}=${value}`);
  }
};

module.exports = { VIDEO_COMPATIBILITY_FLAGS, assertVideoCompatibilityEnvironment };
