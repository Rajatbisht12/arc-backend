const ContentExposure = require('../models/ContentExposure');

const MEANINGFUL_EXPOSURE_MS = 1000;
// Removal also proves a prior explicit action, including historical likes
// created before exposure tracking was deployed.
const EXPLICIT_INTERACTIONS = new Set(['like', 'comment', 'share', 'save', 'unlike', 'unsave']);
const exposureKey = (user, post) => `${String(user?._id || user).toLowerCase()}:${String(post?._id || post).toLowerCase()}`;

function buildExposureUpdate({ userId, postId, contentType, at = new Date(), interaction = false }) {
  return {
    $setOnInsert: { user: userId, post: postId, ...(!contentType ? { contentType: 'post' } : {}), ...(!interaction ? { interacted: false } : {}) },
    $min: { firstViewedAt: at, ...(interaction ? { firstInteractedAt: at } : {}) },
    $max: { lastViewedAt: at, ...(interaction ? { lastInteractedAt: at } : {}) },
    ...(interaction || contentType ? { $set: { ...(interaction ? { interacted: true } : {}), ...(contentType ? { contentType } : {}) } } : {})
  };
}

async function recordContentExposure({ userId, postId, contentType, durationMs, interaction = false, at }) {
  if (!userId || !postId || (!interaction && !(Number(durationMs) >= MEANINGFUL_EXPOSURE_MS))) return false;
  const update = buildExposureUpdate({ userId, postId, contentType, interaction, at });
  const filter = { _id: exposureKey(userId, postId) };
  try {
    // setDefaultsOnInsert:false avoids conflicting $set(interacted:true) with
    // a schema default in $setOnInsert. No pipeline updates (DocumentDB).
    await ContentExposure.updateOne(filter, update, { upsert: true, setDefaultsOnInsert: false });
  } catch (error) {
    if (error?.code !== 11000) throw error;
    await ContentExposure.updateOne(filter, update, { upsert: false });
  }
  return true;
}

// Candidate selection precedes hydration, relationship and media URL work.
// Re-read the small outgoing video page on the primary immediately before
// delivery so a concurrent acknowledged watch cannot escape via that snapshot.
// Match user/post as well as canonical keys to respect legacy exposure rows.
async function excludeExposedVideos(posts, userId) {
  if (!userId) return posts;
  const videos = posts.filter(post => post?.content?.media?.some(media => media.type === 'video'));
  if (!videos.length) return posts;
  const rows = await ContentExposure.find({
    user: userId, post: { $in: videos.map(post => post._id) },
    $or: [{ lastViewedAt: { $ne: null } }, { firstViewedAt: { $ne: null } }, { interacted: true }]
  }).read('primary').select('post').lean();
  const excluded = new Set(rows.map(row => String(row.post)));
  return posts.filter(post => !excluded.has(String(post._id)));
}

module.exports = { MEANINGFUL_EXPOSURE_MS, EXPLICIT_INTERACTIONS, exposureKey, buildExposureUpdate, recordContentExposure, excludeExposedVideos };
