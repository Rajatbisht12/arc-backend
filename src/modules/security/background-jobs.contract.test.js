const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const socketSource = fs.readFileSync(path.resolve(__dirname, '../legacy/legacy.socket.ts'), 'utf8');
const serverSource = fs.readFileSync(path.resolve(__dirname, '../../server.ts'), 'utf8');
assert.match(socketSource, /if \(randomMatchTickRunning\) return/);
assert.match(socketSource, /finally \{\s*randomMatchTickRunning = false/);
assert.match(socketSource, /export const stopLegacyBackgroundJobs/);
assert.match(serverSource, /stopLegacyBackgroundJobs\(\)/);

console.log('Background job overlap and shutdown contracts passed');
