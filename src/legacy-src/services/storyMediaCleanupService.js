const StoryMediaAsset = require('../models/StoryMediaAsset');
const { deleteFile } = require('../utils/cloudinary');
const log = require('../utils/logger');
const mongoose = require('mongoose');

const uniquePublicIds = (values) => [...new Set((values || []).map(String).map(value => value.trim()).filter(Boolean))];

const deletePublicIds = async (publicIds) => {
  const ids = uniquePublicIds(publicIds);
  const results = await Promise.allSettled(ids.map(publicId => deleteFile(publicId)));
  const failures = results
    .map((result, index) => ({ result, publicId: ids[index] }))
    .filter(({ result }) => result.status === 'rejected');
  if (failures.length) {
    const error = new Error(`Failed to remove ${failures.length} Story media object(s)`);
    error.publicIds = failures.map(({ publicId }) => publicId);
    throw error;
  }
  return ids.length;
};

const deferStoryAssetCleanup = async ({ storyId, ownerId, publicIds, error }) => {
  const ids = uniquePublicIds(publicIds);
  if (!ids.length || !ownerId) return null;
  // A failed upload may not have produced a Story document. A synthetic Story
  // id still gives the cleanup tracker a stable unique key; the worker only
  // needs that key to retrieve and delete the recorded object-storage ids.
  const trackerStoryId = mongoose.Types.ObjectId.isValid(storyId)
    ? storyId
    : new mongoose.Types.ObjectId();
  return StoryMediaAsset.findOneAndUpdate(
    { story: trackerStoryId },
    {
      $set: {
        owner: ownerId,
        expiresAt: new Date(),
        lastError: String(error?.message || error || 'Deferred Story media cleanup').slice(0, 500),
      },
      $addToSet: { publicIds: { $each: ids } },
      $inc: { attempts: 1 },
    },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );
};

const cleanupStoryAssets = async ({ storyId, fallbackPublicIds = [] }) => {
  const tracker = storyId ? await StoryMediaAsset.findOne({ story: storyId }) : null;
  const publicIds = uniquePublicIds([...(tracker?.publicIds || []), ...fallbackPublicIds]);
  try {
    const deleted = await deletePublicIds(publicIds);
    if (tracker) await StoryMediaAsset.deleteOne({ _id: tracker._id });
    return { deleted, complete: true };
  } catch (error) {
    if (tracker) {
      await StoryMediaAsset.updateOne(
        { _id: tracker._id },
        { $inc: { attempts: 1 }, $set: { lastError: String(error.message || error).slice(0, 500) } }
      ).catch(() => {});
    }
    throw error;
  }
};

const cleanupExpiredStoryAssets = async ({ limit = 100 } = {}) => {
  const assets = await StoryMediaAsset.find({ expiresAt: { $lte: new Date() } })
    .sort({ expiresAt: 1 })
    .limit(Math.max(1, Math.min(500, Number(limit) || 100)));
  let cleaned = 0;
  let failed = 0;
  for (const asset of assets) {
    try {
      await cleanupStoryAssets({ storyId: asset.story });
      cleaned += 1;
    } catch (error) {
      failed += 1;
      log.error('Expired Story media cleanup failed', { storyId: String(asset.story), error: String(error) });
    }
  }
  return { scanned: assets.length, cleaned, failed };
};

module.exports = {
  cleanupStoryAssets,
  cleanupExpiredStoryAssets,
  deferStoryAssetCleanup,
  deletePublicIds,
};
