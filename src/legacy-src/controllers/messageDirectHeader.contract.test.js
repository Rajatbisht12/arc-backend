const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const controllerSource = readFileSync(path.join(__dirname, 'messageController.js'), 'utf8');

test('recent direct conversations serialize authoritative participant presentation metadata', () => {
  assert.match(
    controllerSource,
    /displayName:\s*otherUser\.profile\?\.displayName\s*\|\|\s*otherUser\.username/,
  );
  assert.match(controllerSource, /profile:\s*\{[\s\S]*?avatar:\s*otherUser\.profile\?\.avatar[\s\S]*?\}/);
  assert.match(controllerSource, /userType:\s*otherUser\.userType/);
});

test('recent direct conversations retain legacy username and profilePicture fields', () => {
  assert.match(
    controllerSource,
    /username:\s*otherUser\.username\s*\|\|\s*otherUser\.profile\?\.displayName/,
  );
  assert.match(controllerSource, /profilePicture:\s*otherUser\.profile\?\.avatar/);
});
