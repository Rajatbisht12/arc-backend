const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { normalizePagination } = require('./pagination');
const { normalizeQuerySearch, escapeRegex } = require('./searchQuery');

assert.deepStrictEqual(
  normalizePagination({}, { defaultLimit: 20, maxLimit: 50 }),
  { page: 1, limit: 20, skip: 0 }
);
assert.strictEqual(normalizeQuerySearch({ $ne: '' }), '');
assert.strictEqual(normalizeQuerySearch('x'.repeat(200)).length, 100);
const escapedLiteralPattern = new RegExp(`^${escapeRegex('a.*b')}$`);
assert.strictEqual(escapedLiteralPattern.test('a.*b'), true);
assert.strictEqual(escapedLiteralPattern.test('anything-between'), false);
assert.deepStrictEqual(
  normalizePagination({ page: '-5', limit: '999999' }, { defaultLimit: 20, maxLimit: 50 }),
  { page: 1, limit: 50, skip: 0 }
);
assert.deepStrictEqual(
  normalizePagination({ page: '3', limit: '10' }, { defaultLimit: 20, maxLimit: 50 }),
  { page: 3, limit: 10, skip: 20 }
);
assert.deepStrictEqual(
  normalizePagination({ page: { $gt: 0 }, limit: ['1000'] }, { defaultLimit: 20, maxLimit: 50 }),
  { page: 1, limit: 50, skip: 0 }
);
assert.deepStrictEqual(
  normalizePagination({ page: '999999999999999', limit: '10' }, { defaultLimit: 20, maxLimit: 50, maxPage: 1000 }),
  { page: 1000, limit: 10, skip: 9990 }
);
assert.deepStrictEqual(
  normalizePagination({ page: '999999999999999', limit: '10' }, { defaultLimit: 20, maxLimit: 50 }),
  { page: 10000, limit: 10, skip: 99990 }
);

const messageController = fs.readFileSync(
  path.join(__dirname, '..', 'controllers', 'messageController.js'),
  'utf8'
);
assert(messageController.includes('const [conversationUsers, followedUserIds, unreadRows] = await Promise.all(['));
assert(!messageController.includes('conversations.map(async (conv)'));

const adminController = fs.readFileSync(
  path.join(__dirname, '..', 'controllers', 'adminController.js'),
  'utf8'
);
assert(adminController.includes('const normalizePage ='));
assert(adminController.includes('const normalizeSearchPattern ='));
assert(!adminController.includes('.limit(parseInt(limit))'));
assert(!adminController.includes('const limit = parseInt(req.query.limit)'));
assert(!adminController.includes('{ $regex: req.query'));

console.log('Bounded pagination contracts passed');
