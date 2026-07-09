const assert = require('assert');
const router = require('../routes/tournaments');
const {
  _private: { isTournamentCode }
} = require('./tournamentController');

const handler = router.params?.id?.[0];
assert.strictEqual(typeof handler, 'function');

const invoke = ({ method, path, value }) => {
  let nextCalls = 0;
  const response = {
    statusCode: 200,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; }
  };
  handler({ method, path }, response, () => { nextCalls += 1; }, value, 'id');
  return { response, nextCalls };
};

const freeFireCode = 'TRN-FF-A1B2C3D4';
assert.strictEqual(isTournamentCode(freeFireCode), true);
assert.strictEqual(
  invoke({ method: 'GET', path: `/${freeFireCode}`, value: freeFireCode }).nextCalls,
  1,
  'base public detail GET must accept flexible tournament codes'
);

for (const request of [
  { method: 'PUT', path: `/${freeFireCode}`, value: freeFireCode },
  { method: 'POST', path: `/${freeFireCode}/join`, value: freeFireCode },
  { method: 'GET', path: `/${freeFireCode}/schedule`, value: freeFireCode },
  { method: 'GET', path: '/not-a-code', value: 'not-a-code' }
]) {
  const result = invoke(request);
  assert.strictEqual(result.nextCalls, 0);
  assert.strictEqual(result.response.statusCode, 400);
  assert.strictEqual(result.response.body.code, 'INVALID_TOURNAMENT_ID');
}

const objectId = '507f1f77bcf86cd799439011';
assert.strictEqual(
  invoke({ method: 'POST', path: `/${objectId}/join`, value: objectId }).nextCalls,
  1,
  'nested and mutation routes must retain ObjectId support'
);

console.log('Legacy tournament route parameter contracts passed');
