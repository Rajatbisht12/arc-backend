const assert = require('node:assert/strict');
const { test } = require('node:test');
const { TEMPLATES, COMPANY_ADDRESS, renderAutomatedEmail } = require('./automatedEmailTemplates');

const fixture = {
  firstName: 'Ava', username: 'Ava_One', otp: '123456',
  expiresAt: new Date(Date.now() + 9 * 60 * 1000),
  actionSource: 'report_review',
  ctaUrl: 'https://www.squadhunt.com/',
  unsubscribeUrl: 'https://www.squadhunt.com/api/email/unsubscribe/abc',
  preferencesUrl: 'https://www.squadhunt.com/settings/notifications'
};

test('all seven templates render exact approved subjects and hidden previews', () => {
  assert.equal(Object.keys(TEMPLATES).length, 7);
  for (const templateId of Object.keys(TEMPLATES)) {
    const result = renderAutomatedEmail(templateId, fixture);
    assert.equal(result.subject, TEMPLATES[templateId].subject);
    assert.equal(result.preview, TEMPLATES[templateId].preview);
    assert.match(result.html, /display:none!important/);
    assert.match(result.html, /SquadHunt/);
    assert.doesNotMatch(`${result.subject}${result.preview}${result.text}${result.html}`, /—/);
    assert.match(result.html, /<html lang="en">/);
  }
});

test('OTP templates reuse the card and do not hardcode expiration', () => {
  for (const templateId of ['registration_otp', 'login_verification', 'password_reset_otp']) {
    const result = renderAutomatedEmail(templateId, fixture);
    assert.match(result.text, /123456/);
    assert.match(result.html, /letter-spacing:6px/);
    assert.match(result.html, /Expires in about 9 minutes/);
    assert.doesNotMatch(result.html, /Valid for 10 minutes/);
  }
});

test('untrusted personalization is escaped in HTML and fallback greeting works', () => {
  const result = renderAutomatedEmail('account_disabled', { ...fixture, firstName: '<img src=x>', username: '<script>' });
  assert.match(result.html, /&lt;img/);
  assert.doesNotMatch(result.html, /<script>/);
  assert.match(renderAutomatedEmail('signup_confirmation', {}).text, /^Hey,/);
});

test('promotional template has functional text links and exact postal address', () => {
  const result = renderAutomatedEmail('inactive_user_reengagement', fixture);
  assert.match(result.text, /Back to SquadHunt: https:\/\/www.squadhunt.com\//);
  assert.match(result.text, /Unsubscribe: https:\/\/www.squadhunt.com/);
  assert.ok(result.text.includes(COMPANY_ADDRESS));
  assert.ok(result.html.includes(COMPANY_ADDRESS.replace(/\n/g, '<br>')));
  assert.throws(() => renderAutomatedEmail('inactive_user_reengagement', { ...fixture, unsubscribeUrl: 'http://example.com' }));
});

test('manual disablement does not claim automated systems flagged the account', () => {
  const result = renderAutomatedEmail('account_disabled', { ...fixture, actionSource: 'manual_admin' });
  assert.doesNotMatch(result.text, /Our systems flagged/);
  assert.match(result.text, /administrator disabled/);
});
