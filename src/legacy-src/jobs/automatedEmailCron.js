const cron = require('node-cron');
const log = require('../utils/logger');
const { scheduleInactiveUserEmails, recoverPendingAutomatedEmails } = require('../services/automatedEmailService');

let task = null;
function startAutomatedEmailCron() {
  if (task) return;
  task = cron.schedule('0 * * * *', async () => {
    try {
      await recoverPendingAutomatedEmails(100);
      await scheduleInactiveUserEmails({ limit: 100 });
    } catch (error) {
      log.error('Automated email scheduler failed', { code: String(error?.code || 'SCHEDULER_ERROR') });
    }
  }, { timezone: 'Etc/UTC' });
}
function stopAutomatedEmailCron() {
  task?.stop();
  task = null;
}
module.exports = { startAutomatedEmailCron, stopAutomatedEmailCron };
