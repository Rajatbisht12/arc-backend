const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const source = readFileSync(path.join(__dirname, 'controllers/messageController.js'), 'utf8');

test('shared-post serializer exposes the ORIGINAL author username and media (not the sharer)', () => {
  // The populated shared post carries the original author + media/type/caption.
  assert.match(source, /sharedPostSelect = '[^']*content\.media[^']*author[^']*postType/);
  assert.match(source, /sharedPostAuthorSelect = '[^']*username/);
  assert.match(source, /path: 'sharedPost'[\s\S]*populate: \{ path: 'author'/);
});

test('unavailable shared posts are nulled but flagged so the client shows a compact state', () => {
  // Deleted (isActive:false), admin-hidden, private, or blocked posts are hidden.
  assert.match(source, /sp\.isActive === false \|\| sp\.hiddenByAdmin === true/);
  assert.match(source, /message\.sharedPost = null/);
  assert.match(source, /message\.sharedPostCaption = ''/);
  assert.match(source, /message\.sharedPostUnavailable = true/);
});
