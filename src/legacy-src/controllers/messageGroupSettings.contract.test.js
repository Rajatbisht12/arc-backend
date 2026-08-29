const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(path.join(__dirname, 'messageController.js'), 'utf8');

assert.match(
  source,
  /const isMember = isAdmin[\s\S]*?if \(!isMember\)[\s\S]*?You are not a member of this group/,
  'group-info endpoint must reject unrelated users',
);

assert.match(
  source,
  /const editAllowed = chatRoom\.memberPermissions\?\.editGroupSettings !== false;[\s\S]*?if \(!isAdmin && !editAllowed\)[\s\S]*?status\(403\)/,
  'group-info endpoint must preserve member permission authorization',
);

assert.match(
  source,
  /const updateGroupPermissions[\s\S]*?if \(!isAdmin\)[\s\S]*?status\(403\)/,
  'permission mutations must remain admin-only',
);

assert.match(
  source,
  /avatar-only save previously succeeded[\s\S]*?emit\('groupInfoUpdated', groupInfoPayload\)/,
  'avatar-only updates must emit group metadata changes',
);

assert.match(
  source,
  /io\.to\(`user-\$\{memberUserId\}`\)\.emit\('groupInfoUpdated', groupInfoPayload\)/,
  'group metadata must reach member devices outside the open chat room',
);

assert.match(
  source,
  /emit\('groupMemberRoleUpdated', rolePayload\)/,
  'role changes must be emitted for live authorization UI',
);

console.log('message group-settings authorization/realtime contract passed');
