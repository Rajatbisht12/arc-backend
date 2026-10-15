const AutomatedEmailEvent = require('../models/AutomatedEmailEvent');
const User = require('../models/User');
const log = require('../utils/logger');
const { TEMPLATES } = require('../utils/automatedEmailTemplates');
const { marketingEligibility, marketingEnabled } = require('./marketingEmailService');

async function queueAutomatedEmail({ userId, eventKey, templateId, payload = {} }) {
  if (!TEMPLATES[templateId] || !userId || !eventKey) throw new Error('Invalid automated email event');
  let event;
  try {
    event = await AutomatedEmailEvent.findOneAndUpdate(
      { eventKey },
      { $setOnInsert: { user: userId, eventKey, templateId, payload, status: 'pending' } },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );
  } catch (error) {
    if (error?.code !== 11000) throw error;
    event = await AutomatedEmailEvent.findOne({ eventKey });
    if (!event) throw error;
  }
  if (event.status === 'pending' || event.status === 'failed') {
    const { enqueueAutomatedEmail } = require('../utils/jobQueue');
    await enqueueAutomatedEmail(String(event._id));
  }
  return event;
}

async function deliverAutomatedEmail(eventId) {
  const event = await AutomatedEmailEvent.findOneAndUpdate(
    { _id: eventId, status: { $in: ['pending', 'failed'] } },
    { $set: { status: 'sending', lastError: '' }, $inc: { attempts: 1 } },
    { new: true }
  );
  if (!event) return { skipped: true };
  const user = await User.findById(event.user).select('email username profile.displayName isActive moderationStatus adminControls isSystemAccount userType needsProfileCompletion lastSeen emailPreferences');
  if (!user || !user.email || (event.templateId === 'signup_confirmation' && (user.needsProfileCompletion || !user.isActive))) {
    await AutomatedEmailEvent.updateOne({ _id: event._id, status: 'sending' }, { $set: { status: 'suppressed' } });
    return { suppressed: true };
  }
  if (event.templateId === 'inactive_user_reengagement' && (!marketingEnabled() || !marketingEligibility(user) || new Date(user.lastSeen).getTime() !== Number(event.payload.activityAt))) {
    await AutomatedEmailEvent.updateOne({ _id: event._id, status: 'sending' }, { $set: { status: 'suppressed' } });
    return { suppressed: true };
  }
  const firstName = String(user.profile?.displayName || '').trim().split(/\s+/)[0];
  const data = { ...event.payload, userId: String(user._id), firstName, username: user.username };
  try {
    const { sendAutomatedEmail } = require('../utils/email');
    const result = await sendAutomatedEmail(user.email, event.templateId, data);
    if (result?.blocked) {
      await AutomatedEmailEvent.updateOne({ _id: event._id, status: 'sending' }, { $set: { status: 'suppressed' } });
      return { suppressed: true };
    }
    if (!result?.sent) {
      const failure = new Error('Email transport did not confirm delivery');
      failure.code = result?.code || 'PROVIDER_REJECTED';
      throw failure;
    }
    const now = new Date();
    await AutomatedEmailEvent.updateOne({ _id: event._id, status: 'sending' }, { $set: { status: 'sent', sentAt: now } });
    if (event.templateId === 'inactive_user_reengagement') {
      await User.updateOne({ _id: user._id, 'emailPreferences.promotionalEnabled': true }, { $set: { 'emailPreferences.lastReengagementAt': now } });
    }
    return { sent: true };
  } catch (error) {
    // Only mark a known provider rejection retryable. An ambiguous failure
    // while SMTP accepted the message must not trigger a duplicate send.
    const definitelyRejected = ['EAUTH', 'EENVELOPE', 'ECONNECTION', 'EMAIL_NOT_CONFIGURED'].includes(error?.code);
    await AutomatedEmailEvent.updateOne({ _id: event._id, status: 'sending' }, {
      $set: { status: definitelyRejected ? 'failed' : 'sending', lastError: String(error?.code || 'delivery_uncertain') }
    }).catch(() => undefined);
    log.error('Automated email delivery failed', { templateId: event.templateId, eventId: String(event._id), code: String(error?.code || 'delivery_uncertain') });
    if (definitelyRejected) throw error;
    return { unresolved: true };
  }
}

async function scheduleInactiveUserEmails({ now = new Date(), limit = 100 } = {}) {
  if (!marketingEnabled()) return { queued: 0, disabled: true };
  const cutoff = new Date(now.getTime() - 5 * 24 * 60 * 60 * 1000);
  const cursor = User.find({
    isActive: true,
    moderationStatus: { $in: ['active', null] },
    'adminControls.loginDisabled': { $ne: true },
    'emailPreferences.promotionalEnabled': true,
    'emailPreferences.marketingConsentAt': { $ne: null },
    'emailPreferences.withdrawnAt': null,
    'emailPreferences.suppressedAt': null,
    'emailPreferences.lastReengagementAt': null,
    lastSeen: { $lte: cutoff }
  }).select('_id lastSeen').sort({ lastSeen: 1, _id: 1 }).limit(Math.min(500, limit)).lean().cursor();
  let queued = 0;
  for await (const user of cursor) {
    const activityAt = new Date(user.lastSeen).getTime();
    await queueAutomatedEmail({ userId: user._id, templateId: 'inactive_user_reengagement', eventKey: `reengagement:${user._id}:${activityAt}`, payload: { activityAt } });
    queued++;
  }
  return { queued };
}

async function recoverPendingAutomatedEmails(limit = 100) {
  const events = await AutomatedEmailEvent.find({ status: { $in: ['pending', 'failed'] } }).select('_id').sort({ createdAt: 1 }).limit(limit).lean();
  const { enqueueAutomatedEmail } = require('../utils/jobQueue');
  for (const event of events) await enqueueAutomatedEmail(String(event._id));
  return events.length;
}

module.exports = { queueAutomatedEmail, deliverAutomatedEmail, scheduleInactiveUserEmails, recoverPendingAutomatedEmails };
