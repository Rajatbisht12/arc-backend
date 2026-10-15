const nodemailer = require('nodemailer');
const log = require('./logger');
const { EMAIL_INTENTS, evaluateEmailPolicy } = require('./notificationChannelPolicy');
const { canonicalizePublicWebUrl } = require('./publicWebUrl');
const {
  buildEmailAuditContext,
  captureEmailCallStack,
  hashEmailAuditValue,
  sanitizeEmailAuditError
} = require('./emailAudit');

let transporter = null;

const EMAIL_BRAND = 'SquadHunt';
const DEFAULT_FROM_ADDRESS = 'noreply@squadhunt.com';

const resolveEmailFrom = () => {
  const configured = String(process.env.SMTP_FROM || process.env.SMTP_USER || '').trim();
  const bracketedAddress = configured.match(/<\s*([^<>]+)\s*>$/)?.[1];
  const bareAddress = /^[^\s<>@]+@[^\s<>@]+$/.test(configured) ? configured : '';
  const candidate = String(bracketedAddress || bareAddress).trim();
  const address = /^[^\s<>@]+@[^\s<>@]+$/.test(candidate) ? candidate : DEFAULT_FROM_ADDRESS;
  return `${EMAIL_BRAND} <${address}>`;
};

function getTransporter() {
  if (transporter) return transporter;
  const host = process.env.SMTP_HOST || 'smtp.gmail.com';
  const port = parseInt(process.env.SMTP_PORT || '587', 10);
  const secure = process.env.SMTP_SECURE === 'true';
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;
  if (!user || !pass) {
    console.warn('Email: SMTP_USER or SMTP_PASS not set. Emails will not be sent.');
    return null;
  }
  transporter = nodemailer.createTransport({
    host,
    port,
    secure,
    auth: { user, pass }
  });
  return transporter;
}

/**
 * Send a generic email
 */
async function sendMail({
  to,
  subject,
  text,
  html,
  intent,
  eventType,
  notificationType,
  templateKey,
  triggerSource,
  producerStack,
  headers,
  list,
  replyTo,
  marketingAuthorized = false
}) {
  const policy = marketingAuthorized && intent === 'marketing' && eventType === 'inactive_user_reengagement' && templateKey === 'inactive_user_reengagement'
    ? { allowed: true, intent, eventType, reason: 'verified_marketing_event' }
    : evaluateEmailPolicy({ intent, eventType, notificationType });
  const audit = buildEmailAuditContext({
    to,
    intent: policy.intent || intent,
    eventType: policy.eventType || eventType,
    notificationType,
    templateKey,
    triggerSource,
    producerStack,
    callStack: captureEmailCallStack()
  });
  if (!policy.allowed) {
    log.info('Email suppressed by channel policy', {
      ...audit,
      reason: policy.reason,
      routineEventType: policy.routineEventType || ''
    });
    return { sent: false, blocked: true, reason: policy.reason };
  }
  const trans = getTransporter();
  if (!trans) {
    log.warn('Email transport unavailable', audit);
    return { sent: false, error: 'Email not configured', code: 'EMAIL_NOT_CONFIGURED' };
  }
  try {
    // The SMTP mailbox is deployment-configurable, but the public sender name
    // is canonical so stale infrastructure values cannot reintroduce legacy
    // branding in a recipient's inbox.
    const from = resolveEmailFrom();
    log.info('Email dispatch authorized', audit);
    const info = await trans.sendMail({
      from,
      to: Array.isArray(to) ? to.join(', ') : to,
      subject: subject || EMAIL_BRAND,
      text: text || '',
      html: html || text,
      ...(replyTo ? { replyTo } : {}),
      ...(headers ? { headers } : {}),
      ...(list ? { list } : {})
    });
    log.info('Email provider accepted', {
      ...audit,
      providerMessageHash: hashEmailAuditValue(info.messageId)
    });
    return { sent: true, messageId: info.messageId };
  } catch (err) {
    const sanitizedError = sanitizeEmailAuditError(err);
    log.error('Email provider rejected dispatch', { ...audit, error: sanitizedError });
    return { sent: false, error: sanitizedError, code: String(err?.code || 'PROVIDER_REJECTED') };
  }
}

async function sendTransactionalEmail(options) {
  return sendMail(options);
}

/**
 * Send OTP email for login/register/forgot_password
 */
async function sendOTPEmail(to, otp, purpose = 'login', options = {}) {
  const templateIds = { login: 'login_verification', register: 'registration_otp', forgot_password: 'password_reset_otp' };
  const templateId = templateIds[purpose];
  if (!templateId) throw new Error('Unsupported OTP purpose');
  const { renderAutomatedEmail } = require('./automatedEmailTemplates');
  const rendered = renderAutomatedEmail(templateId, { otp, firstName: options.firstName, expiresAt: options.expiresAt });

  return sendTransactionalEmail({
    to,
    subject: rendered.subject,
    text: rendered.text,
    html: rendered.html,
    intent: EMAIL_INTENTS.SECURITY,
    eventType: `otp_${purpose}`,
    templateKey: templateId,
    triggerSource: 'auth.otp',
    producerStack: captureEmailCallStack()
  });
}

async function sendAutomatedEmail(to, templateId, data = {}) {
  const { renderAutomatedEmail } = require('./automatedEmailTemplates');
  if (templateId === 'inactive_user_reengagement') {
    const User = require('../models/User');
    const { marketingEnabled, marketingEligibility, tokenForUser, hashToken, unsubscribeUrlForUser } = require('../services/marketingEmailService');
    if (!marketingEnabled() || !data.userId) return { sent: false, blocked: true, reason: 'marketing_not_ready' };
    const user = await User.findById(data.userId).select('+emailPreferences.unsubscribeTokenHash');
    const token = tokenForUser(user);
    if (!marketingEligibility(user) || !token || user.email !== to || user.emailPreferences?.unsubscribeTokenHash !== hashToken(token)) {
      return { sent: false, blocked: true, reason: 'marketing_ineligible' };
    }
    data = {
      ...data,
      unsubscribeUrl: unsubscribeUrlForUser(user),
      preferencesUrl: 'https://www.squadhunt.com/settings/notifications'
    };
  }
  const rendered = renderAutomatedEmail(templateId, data);
  const unsubscribeUrl = rendered.promotional ? data.unsubscribeUrl : '';
  return sendMail({
    to,
    subject: rendered.subject,
    text: rendered.text,
    html: rendered.html,
    intent: rendered.intent,
    eventType: rendered.eventType,
    templateKey: templateId,
    triggerSource: 'automated_email',
    marketingAuthorized: rendered.promotional,
    ...(rendered.promotional ? {
      list: { unsubscribe: unsubscribeUrl },
      headers: { 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click' }
    } : {}),
    replyTo: process.env.SMTP_REPLY_TO || 'support@squadhunt.com'
  });
}

/**
 * Send a policy-approved notification-shaped transactional email.
 */
const escapeHtml = (value) => String(value ?? '')
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;')
  .replace(/'/g, '&#39;');

const sanitizeEmailLink = (value) => {
  if (typeof value !== 'string' || !value.trim()) return '';
  try {
    const url = new URL(value.trim());
    return ['http:', 'https:'].includes(url.protocol)
      ? canonicalizePublicWebUrl(url.toString())
      : '';
  } catch {
    return '';
  }
};

async function sendNotificationEmail(to, title, message, link, context = {}) {
  const subject = `SquadHunt: ${title}`;
  const safeLink = sanitizeEmailLink(link);
  const text = `${title}\n\n${message}${safeLink ? `\n\nView in SquadHunt: ${safeLink}` : ''}\n\n- SquadHunt`;
  const html = `
    <div style="font-family: sans-serif;">
      <h3>${escapeHtml(title)}</h3>
      <p>${escapeHtml(message)}</p>
      ${safeLink ? `<p><a href="${escapeHtml(safeLink)}">View in SquadHunt</a></p>` : ''}
      <p style="margin:8px 0 2px;color: #999; font-size: 12px;">Need help? Email <a href="mailto:support@squadhunt.com" style="color:#9ca3af;text-decoration:none;">support@squadhunt.com</a>.</p>
      <p style="margin:0;color: #999; font-size: 12px;">- SquadHunt</p>
    </div>
  `;
  return sendTransactionalEmail({
    to,
    subject,
    text,
    html,
    intent: context.intent,
    eventType: context.eventType,
    notificationType: context.notificationType,
    templateKey: context.templateKey || 'transactional_notification',
    triggerSource: context.triggerSource,
    producerStack: context.producerStack
  });
}

module.exports = {
  sendOTPEmail,
  sendAutomatedEmail,
  sendNotificationEmail,
  escapeHtml,
  sanitizeEmailLink,
  resolveEmailFrom
};
