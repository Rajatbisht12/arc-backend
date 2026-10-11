const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const source = readFileSync(path.join(__dirname, 'messageController.js'), 'utf8');

test('group profile shares use the existing structured message field and membership guard', () => {
  const group = source.slice(source.indexOf('const sendGroupMessage ='), source.indexOf('const getGroupMessages ='));
  assert.match(group, /const isMember = chatRoom\.members\.some/);
  assert.match(group, /memberPermissions\.sendMessages === false/);
  assert.match(group, /sharedProfileUsername/);
  assert.match(group, /resolvePrivacyAccess\(\{ viewer: member, targetUser: profileUser \}\)/);
  assert.match(group, /messageData\.sharedProfile = sharedProfileObj/);
  assert.match(group, /messageText\.trim\(\) === `https:\/\/www\.squadhunt\.com\/\$\{encodeURIComponent\(sharedProfileUsername\)\}`/);
  assert.match(group, /messageKind: getMessageKind|messageKind = getMessageKind/);
});

test('DM and group history populate stable profile ID, username, type and presentation', () => {
  assert.match(source, /populate\('sharedProfile', 'username userType profile\.displayName profile\.avatar'\)/);
  assert.match(source, /path: 'sharedProfile', select: 'username userType profile\.displayName profile\.avatar'/);
});
