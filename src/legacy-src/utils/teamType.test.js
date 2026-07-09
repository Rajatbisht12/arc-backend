const assert = require('assert');
const fs = require('fs');
const path = require('path');
const User = require('../models/User');
const { TEAM_TYPES, normalizeTeamType } = require('./teamType');

assert.deepStrictEqual(TEAM_TYPES, ['casual', 'competitive', 'professional', 'semi-pro']);
assert.strictEqual(normalizeTeamType('Casual'), 'casual');
assert.strictEqual(normalizeTeamType(' Competitive '), 'competitive');
assert.strictEqual(normalizeTeamType('Professional'), 'professional');
assert.strictEqual(normalizeTeamType('Semi-Pro'), 'semi-pro');
assert.strictEqual(normalizeTeamType('semi pro'), 'semi-pro');
assert.strictEqual(normalizeTeamType('semi_pro'), 'semi-pro');
assert.strictEqual(normalizeTeamType('invalid'), null);

const schemaPath = User.schema.path('teamInfo.teamType');
assert.strictEqual(schemaPath.applySetters('Semi-Pro', {}), 'semi-pro');
assert.strictEqual(schemaPath.enumValues.includes('semi-pro'), true);

const authControllerSource = fs.readFileSync(
  path.join(__dirname, '..', 'controllers', 'authController.js'),
  'utf8'
);
assert(authControllerSource.includes("updates.teamInfo.teamType = normalizedTeamType"));
assert(authControllerSource.includes("code: 'INVALID_TEAM_TYPE'"));

console.log('Team type normalization contract tests passed');
