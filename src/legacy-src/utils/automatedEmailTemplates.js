const { CANONICAL_PUBLIC_WEB_ORIGIN } = require('./publicWebUrl');

const COMPANY_ADDRESS = `SquadHunt Private Limited
Flat No. 5, Madhuvanti Housing Society
Saubhagya Nagar, Gangapur Road
Nashik, Maharashtra - 422005
India`;
const SUPPORT = 'support@squadhunt.com';

const escapeHtml = (value) => String(value ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
const safeText = (value, max = 160) => String(value ?? '').replace(/[\r\n\u0000-\u001f]+/g, ' ').trim().slice(0, max);
const safeHttpsUrl = (value) => {
  try {
    const url = new URL(String(value || ''));
    return url.protocol === 'https:' && ['www.squadhunt.com', 'squadhunt.com'].includes(url.hostname.toLowerCase()) ? url.toString() : '';
  } catch { return ''; }
};
const firstName = (value) => safeText(value, 80).split(/\s+/)[0] || '';
const greeting = (value) => `Hey${firstName(value) ? ` ${firstName(value)}` : ''},`;
const otpCard = (otp, expiresAt) => {
  const code = safeText(otp, 16);
  const remainingMinutes = expiresAt ? Math.max(1, Math.ceil((new Date(expiresAt).getTime() - Date.now()) / 60000)) : null;
  return {
    text: `${code}${remainingMinutes ? `\nExpires in about ${remainingMinutes} minute${remainingMinutes === 1 ? '' : 's'}.` : ''}`,
    html: `<div style="margin:16px 0;padding:18px;border:1px solid #a5b4fc;border-radius:12px;background:#eef2ff;text-align:center"><span style="font-size:30px;letter-spacing:6px;font-weight:700;color:#1e1b4b">${escapeHtml(code)}</span>${remainingMinutes ? `<div style="margin-top:8px;font-size:12px;color:#475569">Expires in about ${remainingMinutes} minute${remainingMinutes === 1 ? '' : 's'}.</div>` : ''}</div>`
  };
};
const paragraph = (value) => `<p style="margin:0 0 16px;line-height:1.6;color:#172033">${escapeHtml(value)}</p>`;
const linkParagraph = (before, label, href, after = '') => `<p style="margin:0 0 16px;line-height:1.6;color:#172033">${escapeHtml(before)}<a href="${escapeHtml(href)}" style="color:#4338ca">${escapeHtml(label)}</a>${escapeHtml(after)}</p>`;
const button = (label, href) => `<a href="${escapeHtml(href)}" style="display:inline-block;padding:12px 20px;border-radius:10px;background:#4f46e5;color:#ffffff;text-decoration:none;font-weight:700">${escapeHtml(label)}</a>`;

const TEMPLATES = Object.freeze({
  signup_confirmation: { subject: 'Welcome to SquadHunt! 🎉 You + Us = Pure magic ✨', preview: 'Let’s find your people.', intent: 'account_lifecycle', eventType: 'account_created' },
  registration_otp: { subject: 'Shhh... here’s your secret code 🤫', preview: 'Use this code to complete your sign-up.', intent: 'security', eventType: 'otp_register' },
  login_verification: { subject: 'Welcome back! Here’s your login code 🔑', preview: 'Use this code to log back in.', intent: 'security', eventType: 'otp_login' },
  password_reset_otp: { subject: 'Let’s get you back in ⚡', preview: 'Your password reset code is inside.', intent: 'security', eventType: 'otp_forgot_password' },
  password_reset_confirmation: { subject: 'Mission accomplished 🎯 Your password is updated successfully! 🔒', preview: 'Safe, secure, and ready to scroll.', intent: 'security', eventType: 'password_reset' },
  account_disabled: { subject: 'Your SquadHunt account has been disabled! ⏸', preview: 'Your profile is currently offline.', intent: 'account_lifecycle', eventType: 'account_suspended' },
  inactive_user_reengagement: { subject: 'Things are happening without you 👀', preview: 'Catch up on what you missed.', intent: 'marketing', eventType: 'inactive_user_reengagement' }
});

function renderAutomatedEmail(templateId, data = {}) {
  const definition = TEMPLATES[templateId];
  if (!definition) throw new Error('Unknown automated email template');
  const hello = greeting(data.firstName);
  let lines;
  let blocks;
  let promotional = false;
  if (templateId === 'signup_confirmation') {
    lines = [hello, "You're in.", 'No more dead group chats or boring weekends. SquadHunt is here to connect you with real people doing what you actually love.', 'Set up your profile, pick your vibe, and jump in. 🎉', 'See you out there.', 'Team SquadHunt'];
  } else if (templateId === 'registration_otp' || templateId === 'login_verification' || templateId === 'password_reset_otp') {
    if (!/^\d{6}$/.test(String(data.otp || ''))) throw new Error('A six-digit OTP is required');
    const card = otpCard(data.otp, data.expiresAt);
    const intro = templateId === 'registration_otp'
      ? ['Hey,', 'Almost there.', 'Drop this code into the app to claim your username and get started:']
      : templateId === 'login_verification'
        ? [hello, 'Ready to dive back in?', 'Enter this code to log into your account:']
        : [hello, 'Locked out? Let’s fix that right now.', 'Drop this code to choose a new password:'];
    lines = [...intro, card.text];
    blocks = intro.map(paragraph).join('') + card.html;
  } else if (templateId === 'password_reset_confirmation') {
    lines = [hello, 'Out with the old, in with the new.', 'Your password reset went through smoothly. You’re good to go.', 'What? This wasn’t you? 😱', `Let us know immediately at ${SUPPORT} so we can secure your account.`, 'See you out there.', 'Team SquadHunt'];
    blocks = lines.slice(0, 4).map(paragraph).join('') + linkParagraph('Let us know immediately at ', SUPPORT, `mailto:${SUPPORT}`, ' so we can secure your account.') + lines.slice(5).map(paragraph).join('');
  } else if (templateId === 'account_disabled') {
    const username = safeText(data.username, 20);
    if (!username) throw new Error('Account username is required');
    const reason = data.actionSource === 'report_review'
      ? "Our systems flagged some activity on your profile that doesn't align with our community standards, so we had to cut the lights for now."
      : 'An administrator disabled your account after a review of your profile.';
    lines = [hello, `We've disabled your SquadHunt account ${username}.`, reason, 'Think we got it wrong?', `Mistakes happen. Reach out to us at ${SUPPORT} and we'll take another look together.`, 'Team SquadHunt'];
    blocks = lines.slice(0, 4).map(paragraph).join('') + linkParagraph('Mistakes happen. Reach out to us at ', SUPPORT, `mailto:${SUPPORT}`, " and we'll take another look together.") + paragraph(lines[5]);
  } else {
    promotional = true;
    const destination = safeHttpsUrl(data.ctaUrl) || `${CANONICAL_PUBLIC_WEB_ORIGIN}/`;
    const unsubscribeUrl = safeHttpsUrl(data.unsubscribeUrl);
    const preferencesUrl = safeHttpsUrl(data.preferencesUrl);
    if (!unsubscribeUrl || !preferencesUrl) throw new Error('Promotional email requires HTTPS preference links');
    lines = [hello, 'It’s been 5 days, and it feels too quiet without you here!', 'Things are still moving on SquadHunt:', 'Watch fun short videos in Clips\nSay hello to someone new in Random Chat\nCatch up on fresh posts in your Feed', "Tap below to come back and see what's new:", `Back to SquadHunt: ${destination}`, 'See you out there.', 'Team SquadHunt'];
    blocks = lines.slice(0, 3).map(paragraph).join('') + `<p style="margin:0 0 16px;line-height:1.6;color:#172033">Watch fun short videos in Clips<br>Say hello to someone new in Random Chat<br>Catch up on fresh posts in your Feed</p>` + paragraph(lines[4]) + `<p style="margin:0 0 18px">${button('Back to SquadHunt', destination)}</p>` + lines.slice(6).map(paragraph).join('');
    lines.push(`Unsubscribe: ${unsubscribeUrl}`, `Manage Email Preferences: ${preferencesUrl}`, COMPANY_ADDRESS);
    blocks += `<div style="border-top:1px solid #e2e8f0;margin-top:20px;padding-top:16px;font-size:12px;line-height:1.6;color:#475569"><a href="${escapeHtml(unsubscribeUrl)}">Unsubscribe</a> | <a href="${escapeHtml(preferencesUrl)}">Manage Email Preferences</a><br>${escapeHtml(COMPANY_ADDRESS).replace(/\n/g, '<br>')}</div>`;
  }
  const text = lines.join('\n\n');
  const body = blocks || lines.map(paragraph).join('');
  const preheader = `<div style="display:none!important;max-height:0;overflow:hidden;opacity:0;color:transparent;mso-hide:all">${escapeHtml(definition.preview)}</div>`;
  const html = `<!doctype html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="margin:0;background:#f4f6fb;font-family:Arial,Helvetica,sans-serif">${preheader}<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f6fb"><tr><td align="center" style="padding:24px 12px"><table role="presentation" width="560" cellpadding="0" cellspacing="0" style="width:100%;max-width:560px;background:#ffffff;border:1px solid #e2e8f0;border-radius:14px"><tr><td style="padding:24px 28px 12px"><a href="${CANONICAL_PUBLIC_WEB_ORIGIN}/" style="color:#312e81;text-decoration:none;font-size:23px;font-weight:700"><img src="${CANONICAL_PUBLIC_WEB_ORIGIN}/favicon-32x32.png" width="28" height="28" alt="" style="vertical-align:middle;margin-right:8px;border:0">SquadHunt</a></td></tr><tr><td style="padding:12px 28px 28px;font-size:15px">${body}</td></tr></table></td></tr></table></body></html>`;
  return { templateId, subject: definition.subject, preview: definition.preview, intent: definition.intent, eventType: definition.eventType, promotional, text, html };
}

module.exports = { TEMPLATES, COMPANY_ADDRESS, renderAutomatedEmail, safeHttpsUrl };
