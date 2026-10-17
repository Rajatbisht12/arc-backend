const test = require('node:test');
const assert = require('node:assert/strict');
const { sampleSuggestedUsers } = require('./userSuggestionService');

const id = (number) => number.toString(16).padStart(24, '0');
const fixtures = Array.from({ length: 30 }, (_, index) => ({ _id: id(index + 1), username: `user${index + 1}` }));

const fakeUserModel = (rows = fixtures) => {
  const requests = [];
  const findOne = () => ({
    select() { return this; },
    sort(direction) { this.direction = direction._id; return this; },
    async lean() { return rows[this.direction === 1 ? 0 : rows.length - 1] || null; },
  });
  const find = (filter) => {
    requests.push(filter);
    return {
      select() { return this; },
      sort(direction) { this.direction = direction._id; return this; },
      limit(limit) {
        const range = filter.$and.at(-1)._id;
        const excluded = new Set((filter.$and[0]?._id?.$nin || []).map(String));
        const matchesRange = row => (
          (!range.$gte || row._id >= String(range.$gte))
          && (!range.$gt || row._id > String(range.$gt))
          && (!range.$lte || row._id <= String(range.$lte))
          && (!range.$lt || row._id < String(range.$lt))
        );
        const ordered = rows.filter(row => !excluded.has(row._id) && matchesRange(row));
        if (this.direction === -1) ordered.reverse();
        return Promise.resolve(ordered.slice(0, limit));
      },
    };
  };
  return { findOne, find, requests };
};

test('a bounded random seek rotates candidates across old and new accounts', async () => {
  const model = fakeUserModel();
  const filter = { isActive: true, $and: [{ _id: { $nin: [id(5)] } }] };
  const start = await sampleSuggestedUsers(model, filter, 8, '_id username', () => Buffer.alloc(12, 0), () => 0);
  const later = await sampleSuggestedUsers(model, filter, 8, '_id username', () => Buffer.from(id(19), 'hex'), () => 0);
  assert.notDeepEqual(start.map(user => user._id), later.map(user => user._id));
  assert.ok(start.some(user => user._id === id(1)));
  assert.ok(later.some(user => user._id === id(25)));
  assert.ok(!start.concat(later).some(user => user._id === id(5)));
  assert.ok(model.requests.every(request => request.isActive && request.$and.length === 2));
  assert.ok(model.requests.length <= 4); // At most two bounded range reads per request.
});

test('short tails wrap once and small or empty pools are safe', async () => {
  const model = fakeUserModel(fixtures.slice(0, 3));
  const users = await sampleSuggestedUsers(model, { isActive: true }, 12, '_id', () => Buffer.from(id(2), 'hex'), () => 0);
  assert.equal(users.length, 3);
  assert.equal(new Set(users.map(user => user._id)).size, 3);
  assert.equal(model.requests.length, 2);
  assert.deepEqual(await sampleSuggestedUsers(fakeUserModel([]), {}, 12, '_id'), []);
});

test('reverse seeks reach different nearby candidates without scanning the catalog', async () => {
  const model = fakeUserModel();
  const users = await sampleSuggestedUsers(model, { isActive: true }, 5, '_id',
    () => Buffer.from(id(19), 'hex'), () => 0.9);
  assert.equal(users.length, 5);
  assert.ok(users.some(user => user._id === id(20)));
  assert.ok(users.some(user => user._id === id(16)));
  assert.equal(model.requests.length, 1);
});
