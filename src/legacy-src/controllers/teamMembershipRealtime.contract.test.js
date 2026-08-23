const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const source = fs.readFileSync(path.join(__dirname, 'messageController.js'), 'utf8');

test('accepted direct team invitations invalidate auth and populated profile caches', () => {
  assert.match(source, /const \{ invalidateUserCache \} = require\('\.\.\/middleware\/auth'\)/);
  assert.match(source, /const \{ invalidateProfileCache \} = require\('\.\.\/utils\/profileCache'\)/);
  assert.match(source, /if \(outcome\.status === 'accepted'\) \{[\s\S]*?invalidateUserCache\(outcome\.invite\.team\)[\s\S]*?invalidateUserCache\(userId\)[\s\S]*?invalidateProfileCache\(/);
});

test('accepted roster and staff invitations publish one refetch-only membership invalidation', () => {
  assert.match(source, /membershipType: inviteType/);
  assert.match(source, /role: outcome\.invite\.role/);
  assert.match(source, /joinedAt: membershipEntry\?\.joinedAt \|\| outcome\.invite\.respondedAt/);
  assert.match(source, /status: 'active'/);
  assert.match(source, /io\.to\(`user-\$\{outcome\.invite\.team\}`\)\.emit\('team_membership_updated', membershipUpdate\)/);
  assert.match(source, /io\.to\(`user-\$\{userId\}`\)\.emit\('team_membership_updated', membershipUpdate\)/);
});
