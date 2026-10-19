const mongoose = require('mongoose');
const { createHash, randomUUID } = require('crypto');
const Session = require('../models/VideoUploadSession');
const Post = require('../models/Post');
const { MAX_POST_VIDEO_BYTES, MAX_VIDEOS, UUID, uploadError } = require('../utils/postVideoPolicy');
const { assertDeliveryReady, normalizedPlaybackKey } = require('../utils/postVideoDelivery');
const Publication = mongoose.models.VideoPostPublication || mongoose.model('VideoPostPublication', new mongoose.Schema({ _id: mongoose.Schema.Types.ObjectId, owner: mongoose.Schema.Types.ObjectId, token: String, expiresAt: Date }, { autoIndex: false }));

const acquirePublication = async (owner, postId) => {
  const token = randomUUID();
  let lock;
  try { lock = await Publication.findOneAndUpdate({ _id: postId, owner, expiresAt: { $lte: new Date() } }, { $set: { owner, token, expiresAt: new Date(Date.now() + 5 * 60_000) } }, { upsert: true, new: true }); }
  catch (error) { if (error.code !== 11000) throw error; }
  if (!lock) throw uploadError('POST_PUBLICATION_BUSY', 'This post is already being published. Please wait and retry.', 409);
  return { owner, postId, token };
};
const finishPublication = async lease => {
  if (!lease) return;
  const { owner, postId, token } = lease;
  // Only the holder may compensate. A completed post is always the source of
  // truth, including a lost HTTP response or partial finalization failure.
  const held = await Publication.exists({ _id: postId, owner, token });
  if (!held) return;
  const post = await Post.findOne({ _id: postId, author: owner }).select('content.media.uploadSessionId');
  if (post) await finalizeVideoPost(owner, postId, post.content.media.map(row => row.uploadSessionId).filter(Boolean));
  else await Session.updateMany({ owner, claimedPostId: postId, postId: null, claimToken: token }, { $unset: { claimedPostId: 1, claimToken: 1 } });
  await Publication.deleteOne({ _id: postId, owner, token });
};
const releaseAbandonedClaim = async session => {
  if (!session.claimedPostId || session.postId) return false;
  if (await Publication.exists({ _id: session.claimedPostId, expiresAt: { $gt: new Date() } })) return false;
  if (await Post.exists({ _id: session.claimedPostId })) return false;
  await Session.updateOne({ _id: session._id, claimedPostId: session.claimedPostId, postId: null }, { $unset: { claimedPostId: 1, claimToken: 1 } });
  return true;
};

const parseIds = value => {
  if (value == null || value === '') return [];
  let ids;
  try { ids = typeof value === 'string' ? JSON.parse(value) : value; } catch { throw uploadError('INVALID_UPLOAD_IDS', 'Video uploads must be a valid list.'); }
  if (!Array.isArray(ids) || ids.length > MAX_VIDEOS || new Set(ids.map(String)).size !== ids.length || ids.some(id => typeof id !== 'string' || !mongoose.isValidObjectId(id))) throw uploadError('INVALID_UPLOAD_IDS', 'Select up to five distinct uploaded videos.');
  return ids;
};
const postIdentity = (owner, clientPostId) => {
  if (!UUID.test(String(clientPostId || ''))) throw uploadError('INVALID_CLIENT_POST_ID', 'A valid post identifier is required for video posts.');
  return new mongoose.Types.ObjectId(createHash('sha256').update(`${owner}:${clientPostId.toLowerCase()}`).digest('hex').slice(0, 24));
};
const reserveReadyVideos = async ({ owner, ids, postId, claimToken }) => {
  if (!ids.length) return [];
  assertDeliveryReady();
  const sessions = await Session.find({ _id: { $in: ids }, owner }).select('size status expiresAt output metadata claimedPostId postId attempts');
  if (sessions.length !== ids.length) throw uploadError('UPLOAD_NOT_FOUND', 'One or more video uploads were not found.', 404);
  if (sessions.reduce((sum, row) => sum + row.size, 0) > MAX_POST_VIDEO_BYTES) throw uploadError('POST_VIDEO_SIZE_LIMIT', 'Videos in one post may total up to 1 GB.');
  const byId = new Map(sessions.map(row => [String(row._id), row]));
  const media = [];
  for (const id of ids) {
    const session = byId.get(id);
    if (session.status !== 'READY' || !session.output || new Date(session.expiresAt).getTime() <= Date.now()) throw uploadError('VIDEO_NOT_READY', 'Wait until every video has finished processing before publishing.', 409);
    const expectedPrefix = `post-video-playback/${owner}/${id}/`;
    if (![session.output.hlsKey, session.output.fallbackKey, session.output.thumbnailKey].every(key => normalizedPlaybackKey(key) && key.startsWith(expectedPrefix))) throw uploadError('INVALID_VIDEO_OUTPUT', 'This video is not ready for publication.', 409);
    const claim = await Session.findOneAndUpdate({ _id: id, owner, status: 'READY', postId: null, expiresAt: { $gt: new Date() }, $or: [{ claimedPostId: null }, { claimedPostId: postId }] }, { $set: { claimedPostId: postId, claimToken, expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000) } }, { new: true });
    if (!claim) throw uploadError('VIDEO_ALREADY_USED', 'This video is already attached to another post.', 409);
    const metadata = session.metadata || {};
    const fallback = session.output.fallbackKey;
    media.push({ type: 'video', uploadSessionId: session._id, url: fallback, publicId: fallback,
      duration: metadata.duration, width: metadata.width, height: metadata.height,
      aspectRatio: metadata.width && metadata.height ? metadata.width / metadata.height : undefined,
      coverUrl: session.output.thumbnailKey, coverPublicId: session.output.thumbnailKey,
      playback: { status: 'ready', version: session.output.prefix.split('/').pop(), hlsUrl: session.output.hlsKey, hlsPublicId: session.output.hlsKey, fallbackMp4Url: fallback, fallbackPublicId: fallback, duration: metadata.duration, width: metadata.width, height: metadata.height, renditions: session.output.renditions || [], attempts: session.attempts, completedAt: session.completedAt || new Date(), outputBytes: session.output.outputBytes },
    });
  }
  return media;
};
const arrangeMedia = (images, videos, rawOrder) => {
  if (images.length + videos.length > 5) throw uploadError('MEDIA_COUNT_LIMIT', 'A post may contain up to five photos and videos.');
  if (!rawOrder) return [...images, ...videos];
  let order;
  try { order = typeof rawOrder === 'string' ? JSON.parse(rawOrder) : rawOrder; } catch { throw uploadError('INVALID_MEDIA_ORDER', 'Invalid media order.'); }
  if (!Array.isArray(order) || order.length !== images.length + videos.length) throw uploadError('INVALID_MEDIA_ORDER', 'Invalid media order.');
  const used = new Set();
  return order.map(item => {
    let key, media;
    if (item?.type === 'image' && Number.isInteger(item.index) && item.index >= 0 && item.index < images.length) { key = `image:${item.index}`; media = images[item.index]; }
    if (item?.type === 'video' && typeof item.sessionId === 'string') { key = `video:${item.sessionId}`; media = videos.find(row => String(row.uploadSessionId) === item.sessionId); }
    if (!media || used.has(key)) throw uploadError('INVALID_MEDIA_ORDER', 'Invalid media order.');
    used.add(key); return media;
  });
};
const finalizeVideoPost = async (owner, postId, ids) => {
  if (!ids.length) return;
  await Session.updateMany({ _id: { $in: ids }, owner, claimedPostId: postId }, { $set: { postId } });
};
module.exports = { parseIds, postIdentity, acquirePublication, finishPublication, releaseAbandonedClaim, reserveReadyVideos, arrangeMedia, finalizeVideoPost };
