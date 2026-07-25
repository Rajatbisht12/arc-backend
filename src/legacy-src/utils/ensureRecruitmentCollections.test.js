const assert = require('assert');
const { CANONICAL_MODELS, ensureRecruitmentCollections } = require('./ensureRecruitmentCollections');

// The canonical set must include the applications collection — the join target
// whose absence empties the recruitment listing on DocumentDB.
const names = CANONICAL_MODELS.map((m) => m.collection.name).sort();
assert.deepStrictEqual(
  names,
  ['playerprofiles', 'recruitmentapplications', 'recruitmentpostingquotas', 'teamrecruitments'],
  'ensure list must cover every collection the recruitment aggregations $lookup from'
);

// A createCollection race (NamespaceExists) is the success case, not an error.
(async () => {
  const attempted = [];
  const fakeModels = ['teamrecruitments', 'recruitmentapplications'].map((name) => ({
    collection: { name },
    async createCollection() {
      attempted.push(name);
      if (name === 'recruitmentapplications') {
        const err = new Error('ns exists');
        err.codeName = 'NamespaceExists';
        throw err;
      }
    }
  }));

  // Exercise the real loop by temporarily swapping the module's model list.
  const mod = require('./ensureRecruitmentCollections');
  const original = mod.CANONICAL_MODELS.slice();
  mod.CANONICAL_MODELS.length = 0;
  mod.CANONICAL_MODELS.push(...fakeModels);
  try {
    const created = await ensureRecruitmentCollections({ logger: { warn() {}, info() {} } });
    assert.deepStrictEqual(attempted.sort(), ['recruitmentapplications', 'teamrecruitments']);
    assert.deepStrictEqual(created, ['teamrecruitments'], 'NamespaceExists must count as already-present, not created');
  } finally {
    mod.CANONICAL_MODELS.length = 0;
    mod.CANONICAL_MODELS.push(...original);
  }

  // A genuine failure must be swallowed (logged) so one collection cannot abort startup.
  let warned = false;
  const boomModels = [{
    collection: { name: 'teamrecruitments' },
    async createCollection() { throw new Error('permission denied'); }
  }];
  mod.CANONICAL_MODELS.length = 0;
  mod.CANONICAL_MODELS.push(...boomModels);
  try {
    const created = await ensureRecruitmentCollections({ logger: { warn() { warned = true; }, info() {} } });
    assert.deepStrictEqual(created, [], 'a failed ensure returns nothing created');
    assert.strictEqual(warned, true, 'a real failure must be logged, not thrown');
  } finally {
    mod.CANONICAL_MODELS.length = 0;
    mod.CANONICAL_MODELS.push(...original);
  }

  console.log('Recruitment collection-ensure contracts passed');
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
