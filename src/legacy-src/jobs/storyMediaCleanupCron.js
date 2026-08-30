const cron = require('node-cron');
const { cleanupExpiredStoryAssets } = require('../services/storyMediaCleanupService');

let task = null;

function startStoryMediaCleanupCron() {
  if (task || process.env.STORY_MEDIA_CLEANUP_ENABLED === 'false') return;
  const schedule = process.env.STORY_MEDIA_CLEANUP_CRON || '*/10 * * * *';
  task = cron.schedule(schedule, async () => {
    try {
      const result = await cleanupExpiredStoryAssets({ limit: process.env.STORY_MEDIA_CLEANUP_BATCH_SIZE || 100 });
      if (result.scanned) console.log('[Story Media Cleanup]', result);
    } catch (error) {
      console.error('[Story Media Cleanup] Batch failed', { message: error?.message || String(error) });
    }
  });
}

function stopStoryMediaCleanupCron() {
  if (task) task.stop();
  task = null;
}

module.exports = { startStoryMediaCleanupCron, stopStoryMediaCleanupCron };
