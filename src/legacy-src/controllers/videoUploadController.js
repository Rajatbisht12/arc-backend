const path = require('path');
const mongoose = require('mongoose');
const service = require('../services/videoUploadService');
const { rewriteManifest, verifyPlaybackToken, normalizedPlaybackKey, assertDeliveryReady, resolvePlaybackKey, playbackAuthorization } = require('../utils/postVideoDelivery');
const Session = require('../models/VideoUploadSession');
const Post = require('../models/Post');
const User = require('../models/User');
const { resolvePostAccess } = require('../utils/privacyPolicy');
let manifestReader;

// Renewal uses CURRENT optional authentication, never the old media bearer as
// proof of continued access. No storage read or fresh signature precedes ACLs.
const renewPlaybackGrant = async (req, res) => {
  res.set('Cache-Control', 'private, no-store');
  try {
    assertDeliveryReady();
    if (!mongoose.isValidObjectId(req.params.id)) return res.status(404).json({ success: false, code: 'PLAYBACK_UNAVAILABLE' });
    const session = await Session.findOne({ _id: req.params.id, status: 'READY' }).select('_id owner postId claimedPostId output').lean();
    if (!session) return res.status(404).json({ success: false, code: 'PLAYBACK_UNAVAILABLE' });
    const post = await Post.findOne({ _id: session.postId || session.claimedPostId, isActive: { $ne: false }, hiddenByAdmin: { $ne: true }, 'content.media.uploadSessionId': session._id }).select('author visibility isActive hiddenByAdmin').lean();
    const viewer = req.user?._id ? await User.findById(req.user._id).select('_id userType isActive blockedUsers').lean() : null;
    if (!post || req.user?._id && (!viewer || viewer.isActive === false) || !(await resolvePostAccess({ post, viewer })).allowed) return res.status(403).json({ success: false, code: 'PLAYBACK_FORBIDDEN' });
    const now = Date.now();
    const viewerId = viewer ? String(viewer._id) : '';
    const output = session.output;
    const root = `post-video-playback/${session.owner}/${session._id}/`;
    if (!output?.prefix?.startsWith(root) || !/^[a-zA-Z0-9_-]+$/.test(output.prefix.slice(root.length))
      || [output.hlsKey, output.fallbackKey, output.thumbnailKey].filter(Boolean).some(key => !normalizedPlaybackKey(key) || !key.startsWith(`${output.prefix}/`))) throw new Error('Invalid persisted playback scope');
    const authorization = playbackAuthorization(output.hlsKey, now);
    if (!authorization) throw new Error('Invalid persisted playback key');
    return res.json({ success: true, data: {
      sessionId: String(session._id),
      playback: { status: 'ready', hlsUrl: resolvePlaybackKey(output.hlsKey, process.env, viewerId, now), fallbackMp4Url: resolvePlaybackKey(output.fallbackKey, process.env, viewerId, now), authorization },
      thumbnailUrl: output.thumbnailKey ? resolvePlaybackKey(output.thumbnailKey, process.env, viewerId, now) : undefined,
    } });
  } catch (error) { return res.status(Number(error.statusCode) || 503).json({ success: false, code: error.code || 'PLAYBACK_UNAVAILABLE', message: 'Video playback is unavailable. Please try again.' }); }
};

const respond = action => async (req, res) => {
  try { return res.json({ success: true, data: await action(req) }); }
  catch (error) {
    const status = Number(error.statusCode) || 503;
    return res.status(status).json({ success: false, code: error.code || 'VIDEO_UPLOAD_UNAVAILABLE', message: error.statusCode ? error.message : 'Video upload is temporarily unavailable. Please try again.' });
  }
};
const playbackManifest = async (req, res) => {
  res.set('Cache-Control', 'private, no-store');
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
  policy: (req, res) => {
    res.set('Cache-Control', 'private, no-store');
    return respond(request => service.policy(request.user._id))(req, res);
  },
  create: respond(async req => ({ session: await service.createSession(req.user._id, req.body) })),
  get: respond(async req => ({ session: await service.getSession(req.user._id, req.params.id) })),
  listParts: respond(async req => ({ parts: await service.listParts(req.user._id, req.params.id) })),
  signParts: respond(async req => ({ parts: await service.signParts(req.user._id, req.params.id, req.body.partNumbers) })),
  complete: respond(async req => ({ session: await service.completeSession(req.user._id, req.params.id) })),
  retry: respond(async req => ({ session: await service.retrySession(req.user._id, req.params.id) })),
  cancel: respond(async req => ({ session: await service.cancelSession(req.user._id, req.params.id) })),
  playbackManifest,
  renewPlaybackGrant,
  __setManifestReaderForTests: reader => { manifestReader = reader; },
};
