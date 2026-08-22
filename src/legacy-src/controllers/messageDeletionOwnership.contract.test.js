const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { test } = require('node:test');

const source = readFileSync(require.resolve('./messageController.js'), 'utf8');
const directStart = source.indexOf('const deleteDirectMessage = async');
const groupStart = source.indexOf('const deleteGroupMessage = async');
const groupEnd = source.indexOf('// Leave a group chat room', groupStart);
const directDelete = source.slice(directStart, groupStart);
const groupDelete = source.slice(groupStart, groupEnd);

test('direct delete-for-everyone is restricted to the canonical sender', () => {
  assert.match(directDelete, /if \(deleteType === 'forEveryone'\)[\s\S]*?if \(!isSender\)/);
  assert.match(directDelete, /'deletedForUsers\.user': \{ \$ne: currentUserId \}/);
});

test('group members may delete another participant message for themselves', () => {
  assert.match(groupDelete, /if \(!isMember\)/);
  assert.match(groupDelete, /message\.deletedForUsers\.push\(/);
  assert.doesNotMatch(groupDelete, /if \(!isSender && !isAdmin\)/);
});

test('group delete-for-everyone is sender-only, including for admins', () => {
  assert.match(groupDelete, /if \(deleteType === 'forEveryone'\)[\s\S]*?if \(!isSender\)/);
  assert.match(groupDelete, /Only the sender can delete message for everyone/);
  assert.doesNotMatch(groupDelete, /Only the sender or admin/);
});

test('global group deletes retain the existing realtime event contract', () => {
  assert.match(groupDelete, /io\.to\(`chat-\$\{chatRoomId\}`\)\.emit\('message_deleted'/);
  assert.match(groupDelete, /deleteType: 'forEveryone'/);
});
