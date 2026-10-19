const path = require('path');
const service = require('../services/videoUploadService');
const { rewriteManifest, verifyPlaybackToken, normalizedPlaybackKey, assertDeliveryReady } = require('../utils/postVideoDelivery');
const Session = require('../models/VideoUploadSession');
const Post = require('../models/Post');
const User = require('../models/User');
const { resolvePostAccess } = require('../utils/privacyPolicy');
let manifestReader;

const respond = action => async (req, res) => {
  try { return res.json({ success: true, data: await action(req) }); }
  catch (error) {
    const status = Number(error.statusCode) || 503;
    return res.status(status).json({ success: false, code: error.code || 'VIDEO_UPLOAD_UNAVAILABLE', message: error.statusCode ? error.message : 'Video upload is temporarily unavailable. Please try again.' });
  }
};
const playbackManifest = async (req, res) => {
  try {
    assertDeliveryReady();
    const token = String(req.query.token || '');
    const grant = verifyPlaybackToken(token);
    const key = `post-video-playback/${req.params[0] || ''}`;
    if (!normalizedPlaybackKey(key) || !key.startsWith(grant.prefix) || !key.endsWith('.m3u8')) return res.status(403).end();
    const sessionId = grant.prefix.split('/')[2];
    const session = await Session.findOne({ _id: sessionId, status: 'READY', 'output.prefix': grant.prefix.replace(/\/$/, '') }).select('_id postId claimedPostId').lean();
    if (!session) return res.status(404).end();
    const post = await Post.findOne({ _id: session.postId || session.claimedPostId, isActive: { $ne: false }, hiddenByAdmin: { $ne: true }, 'content.media.uploadSessionId': sessionId }).select('author visibility isActive hiddenByAdmin').lean();
    const viewer = grant.viewerId ? await User.findById(grant.viewerId).select('_id userType isActive blockedUsers').lean() : null;
    if (!post || grant.viewerId && (!viewer || viewer.isActive === false) || !(await resolvePostAccess({ post, viewer })).allowed) return res.status(403).end();
    const read = manifestReader || require(path.join(__dirname, '../../../dist/infrastructure/storage/s3')).readVideoManifest;
    const text = await read(key);
    res.set('Cache-Control', 'private, no-store');
    res.type('application/vnd.apple.mpegurl').send(rewriteManifest(text, key, token));
  } catch (error) { res.status(Number(error.statusCode) || 503).json({ success: false, code: error.code || 'PLAYBACK_UNAVAILABLE', message: 'Video playback is unavailable. Refresh the post and try again.' }); }
};
module.exports = {
  policy: respond(() => service.policy()),
  create: respond(async req => ({ session: await service.createSession(req.user._id, req.body) })),
  get: respond(async req => ({ session: await service.getSession(req.user._id, req.params.id) })),
  listParts: respond(async req => ({ parts: await service.listParts(req.user._id, req.params.id) })),
  signParts: respond(async req => ({ parts: await service.signParts(req.user._id, req.params.id, req.body.partNumbers) })),
  complete: respond(async req => ({ session: await service.completeSession(req.user._id, req.params.id) })),
  retry: respond(async req => ({ session: await service.retrySession(req.user._id, req.params.id) })),
  cancel: respond(async req => ({ session: await service.cancelSession(req.user._id, req.params.id) })),
  playbackManifest,
  __setManifestReaderForTests: reader => { manifestReader = reader; },
};
