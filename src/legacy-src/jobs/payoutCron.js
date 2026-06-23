/**
 * Cron jobs for creator monetization:
 * - Daily: refresh eligibility cache for all players
 * - Monthly (1st): close previous cycle, run earnings, create pending payouts
 */

const cron = require('node-cron');
const { runEligibilityForAllPlayers } = require('../services/MonetizationEligibilityEngine');
const { closePreviousCycleAndCreatePayouts } = require('../services/CreatorEarningsCalculationService');

function startPayoutCrons() {
  // Daily at 2:00 AM - refresh eligibility for all players
  cron.schedule('0 2 * * *', async () => {
    try {
      const result = await runEligibilityForAllPlayers();
      console.log('[Monetization Cron] Eligibility refresh:', result);
    } catch (err) {
      console.error('[Monetization Cron] Eligibility refresh error:', err.message);
    }
  });

  // 1st of every month at 3:00 AM - close previous cycle and create pending payouts
  cron.schedule('0 3 1 * *', async () => {
    try {
      const result = await closePreviousCycleAndCreatePayouts();
      console.log('[Monetization Cron] Close cycle & create payouts:', result);
    } catch (err) {
      console.error('[Monetization Cron] Close cycle error:', err.message);
    }
  });

  console.log('[Monetization Cron] Scheduled: daily eligibility (2:00 AM), monthly cycle close (1st 3:00 AM)');
}

module.exports = { startPayoutCrons };
