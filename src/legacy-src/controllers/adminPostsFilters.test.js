const test = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');
const User = require('../models/User');
const Post = require('../models/Post');
const { getPosts } = require('./adminController');

let mongo;
test.before(async () => {
  mongo = await MongoMemoryServer.create();
  await mongoose.connect(mongo.getUri());
});
test.after(async () => {
  await mongoose.disconnect();
  await mongo?.stop();
});
test.beforeEach(async () => {
  await Promise.all([Post.deleteMany({}), User.deleteMany({})]);
});

const response = () => ({
  statusCode: 200,
  body: null,
  status(code) { this.statusCode = code; return this; },
  json(body) { this.body = body; return this; },
});

const list = async (query = {}) => {
  const res = response();
  await getPosts({ query }, res);
  return res;
};

test('Admin Posts filters referenced author fields and caption text before pagination', async () => {
  const [sarcasm, zoro, clan] = [
    { username: 'sarcasm_only', displayName: 'Sarcasm', userType: 'player' },
    { username: 'zoro', displayName: 'Zoro', userType: 'player' },
    { username: 'clan_one', displayName: 'Clan One', userType: 'team' },
  ].map((user) => ({ ...user, _id: new mongoose.Types.ObjectId() }));
  await User.collection.insertMany([sarcasm, zoro, clan].map((user) => ({
    _id: user._id, username: user.username, email: `${user.username}@example.test`,
    userType: user.userType, isActive: true, profile: { displayName: user.displayName },
  })));
  const records = [
    [sarcasm, 'Slow down and walk', true],
    [sarcasm, 'Old joke', false],
    [zoro, 'Gaming with friends', true],
    [clan, 'Team recruitment', true],
    [clan, 'Archived team post', false],
    [zoro, 'Literal a.b match', true],
    [zoro, 'Literal acb should not match', true],
  ];
  await Post.collection.insertMany(records.map(([author, text, isActive], index) => ({
    _id: new mongoose.Types.ObjectId(), author: author._id,
    content: { text }, isActive,
    createdAt: new Date(Date.UTC(2026, 9, 10, 0, index)),
  })));

  const expectTotal = async (query, total) => {
    const res = await list(query);
    assert.equal(res.statusCode, 200, JSON.stringify(res.body));
    assert.equal(res.body.data.pagination.total, total, JSON.stringify(query));
    assert.equal(res.body.data.posts.length, total);
    return res.body.data.posts;
  };

  await expectTotal({}, 7);
  await expectTotal({ author: 'player' }, 5);
  await expectTotal({ author: 'team' }, 2);
  await expectTotal({ author: 'player', isActive: 'true' }, 4);
  await expectTotal({ author: 'team', isActive: 'false' }, 1);
  await expectTotal({ search: '  SARCASM  ' }, 2);
  await expectTotal({ search: 'sarcasm_only' }, 2);
  await expectTotal({ search: 'arcas' }, 2);
  await expectTotal({ search: 'recruitment' }, 1);
  await expectTotal({ search: 'ruit' }, 1);
  await expectTotal({ search: 'slow down' }, 1);
  await expectTotal({ author: 'team', search: 'CLAN' }, 2);
  await expectTotal({ author: 'player', search: 'sarcasm', isActive: 'false' }, 1);
  const literal = await expectTotal({ search: 'a.b' }, 1);
  assert.equal(literal[0].content.text, 'Literal a.b match');
  const page = await list({ author: 'player', page: '2', limit: '1' });
  assert.equal(page.body.data.pagination.total, 5);
  assert.equal(page.body.data.pagination.pages, 5);
  assert.equal(page.body.data.posts.length, 1);
  assert.equal(page.body.data.posts[0].author.userType, 'player');
});

test('Admin Posts rejects unsupported filter values', async () => {
  assert.equal((await list({ author: 'user' })).statusCode, 400);
  assert.equal((await list({ isActive: 'active' })).statusCode, 400);
});
