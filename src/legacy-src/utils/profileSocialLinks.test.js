const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const {
  normalizeProfileSocialLinksUpdate
} = require('./profileSocialLinks');

test('profile updates normalize structured links for both User and Team accounts', () => {
  const controller = readFileSync(path.join(__dirname, '../controllers/authController.js'), 'utf8');
  assert.match(controller, /req\.user\.userType !== 'guest' && updates\.socialLinks !== undefined/);
  assert.match(controller, /normalizeProfileSocialLinksUpdate\(/);
});

test('normalizes at most three structured social links and mirrors legacy titles', () => {
  const normalized = normalizeProfileSocialLinksUpdate({
    links: [
      { title: 'YouTube', url: 'youtube.com/@squad' },
      { title: 'Discord', url: 'https://discord.gg/squad' },
      { title: 'Website', url: 'https://squad.example' }
    ]
  });
  assert.equal(normalized.links.length, 3);
  assert.equal(normalized.links[0].url, 'https://youtube.com/@squad');
  assert.equal(normalized.discord, 'https://discord.gg/squad');
  assert.equal(normalized.steam, '');
});

test('rejects a fourth structured link', () => {
  assert.throws(() => normalizeProfileSocialLinksUpdate({
    links: [0, 1, 2, 3].map(index => ({ title: `Link ${index}`, url: `https://example.com/${index}` }))
  }), /up to 3/);
});

test('rejects invalid URLs and missing titles', () => {
  assert.throws(() => normalizeProfileSocialLinksUpdate({
    links: [{ title: 'Discord', url: 'not a url' }]
  }), /valid http or https/);
  assert.throws(() => normalizeProfileSocialLinksUpdate({
    links: [{ title: '', url: 'https://example.com' }]
  }), /must have a title/);
});

test('ignores empty rows and preserves order', () => {
  const normalized = normalizeProfileSocialLinksUpdate({
    links: [
      { title: 'YouTube', url: '' },
      { title: 'Instagram', url: 'https://instagram.com/squad' }
    ]
  });
  assert.deepEqual(normalized.links, [
    { title: 'Instagram', url: 'https://instagram.com/squad' }
  ]);
});

test('legacy clients preserve an existing structured list', () => {
  const normalized = normalizeProfileSocialLinksUpdate(
    { discord: 'https://discord.gg/new', steam: '', twitch: '' },
    { links: [{ title: 'YouTube', url: 'https://youtube.com/@squad' }] }
  );
  assert.deepEqual(normalized.links, [
    { title: 'YouTube', url: 'https://youtube.com/@squad' }
  ]);
  assert.equal(normalized.discord, 'https://discord.gg/new');
});
