const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const read = file => fs.readFileSync(path.join(__dirname, file), 'utf8');
const createAdmin = read('create-admin.js');
const checkUsers = read('check-users.js');
const createTeams = read('create-teams.js');
const updateAdmin = read('update-admin.js');
const destructiveScripts = [
  'clear-team-history.js',
  'clear-tournaments.js',
  'seed-premium-user.js',
  'assign-premium.js',
  'remove-premium.js',
  'batchLearn.js',
  'addInitialKnowledge.js',
  'fix-verified-hosts.js',
  'do-test-payment.js'
].map(read);

assert.match(createAdmin, /ADMIN_USERNAME/);
assert.match(createAdmin, /ADMIN_EMAIL/);
assert.match(createAdmin, /ADMIN_PASSWORD/);
assert.match(createAdmin, /--apply/);
assert.doesNotMatch(createAdmin, /admin123/);
assert.doesNotMatch(createAdmin, /admin@arcgaming\.com/);
assert.doesNotMatch(createAdmin, /mongodb:\/\/localhost/);

assert.doesNotMatch(checkUsers, /test1234/);
assert.doesNotMatch(checkUsers, /test@test\.com/);
assert.doesNotMatch(checkUsers, /User\.create|\.password\s*=/);

for (const source of [createTeams, updateAdmin]) {
  assert.match(source, /--apply/);
  assert.doesNotMatch(source, /admin123|123456|mongodb:\/\/localhost/);
}
assert.match(createTeams, /TEAM_SEED_PASSWORD/);
assert.match(createTeams, /ALLOW_TEST_DATA_SEED/);
assert.match(updateAdmin, /ADMIN_PASSWORD/);

for (const source of destructiveScripts) {
  assert.match(source, /--apply/);
  assert.doesNotMatch(source, /mongodb:\/\/localhost/);
}
assert.match(read('clear-team-history.js'), /CONFIRM_DESTRUCTIVE_OPERATION=CLEAR_TEAM_HISTORY/);
assert.match(read('clear-tournaments.js'), /CONFIRM_DESTRUCTIVE_OPERATION=CLEAR_TOURNAMENTS/);
assert.doesNotMatch(read('testLlama.js'), /GROQ_API_KEY\.substring|mongoose\.connect/);
assert.match(read('do-test-payment.js'), /rzp_test_/);

console.log('Operator scripts are explicit, credential-free, and read-only where expected');
