const assert = require('assert');
const { resolveCommentRelation, countRepliesForRoot, isTopLevel } = require('./commentThreading');

const comments = [
  { _id: 'c1', user: 'u1', parentComment: null, rootComment: null },
  { _id: 'c2', user: 'u2', parentComment: 'c1', rootComment: 'c1' }, // reply to c1
  { _id: 'c3', user: 'u3', parentComment: null, rootComment: null },
];

// Top-level comment: no parent/root, no reply target.
assert.deepStrictEqual(
  resolveCommentRelation(comments, null),
  { ok: true, parentComment: null, rootComment: null, replyTargetUserId: null },
);

// Reply to a top-level comment: parent and root are that comment; notify its author.
assert.deepStrictEqual(
  resolveCommentRelation(comments, 'c1'),
  { ok: true, parentComment: 'c1', rootComment: 'c1', replyTargetUserId: 'u1' },
);

// Reply to a reply: flattens to the root thread (c1) but records the real parent (c2).
assert.deepStrictEqual(
  resolveCommentRelation(comments, 'c2'),
  { ok: true, parentComment: 'c2', rootComment: 'c1', replyTargetUserId: 'u2' },
);

// Invalid parent id → not ok (controller returns 404, never a 500).
assert.deepStrictEqual(resolveCommentRelation(comments, 'missing'), { ok: false, reason: 'parent_not_found' });

// Populated user/parent objects resolve by _id too.
const populated = [{ _id: { _id: 'c9' }, user: { _id: 'u9' }, parentComment: null, rootComment: null }];
assert.deepStrictEqual(
  resolveCommentRelation(populated, { _id: 'c9' }),
  { ok: true, parentComment: 'c9', rootComment: 'c9', replyTargetUserId: 'u9' },
);

// Reply counting for a root thread.
assert.strictEqual(countRepliesForRoot(comments, 'c1'), 1);
assert.strictEqual(countRepliesForRoot(comments, 'c3'), 0);

assert.strictEqual(isTopLevel(comments[0]), true);
assert.strictEqual(isTopLevel(comments[1]), false);

console.log('comment threading resolver tests passed');
