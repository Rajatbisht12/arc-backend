const assert = require('node:assert/strict');
const { buildCommentDeletion, getCommentPermissions } = require('./commentModeration');

const owner = '507f1f77bcf86cd799439011';
const author = '507f1f77bcf86cd799439012';
const stranger = '507f1f77bcf86cd799439013';

assert.deepEqual(
  getCommentPermissions({ viewerId: author, contentOwnerId: owner, commentAuthorId: author }),
  { canDelete: true, canReport: false },
  'an author deletes, but never reports, their own comment'
);
assert.deepEqual(
  getCommentPermissions({ viewerId: owner, contentOwnerId: owner, commentAuthorId: author }),
  { canDelete: true, canReport: true },
  'the content owner can moderate another author'
);
assert.deepEqual(
  getCommentPermissions({ viewerId: stranger, contentOwnerId: owner, commentAuthorId: author }),
  { canDelete: false, canReport: true },
  'another authenticated user can report but cannot delete'
);

const root = '507f1f77bcf86cd799439021';
const reply = '507f1f77bcf86cd799439022';
const nested = '507f1f77bcf86cd799439023';
const otherRoot = '507f1f77bcf86cd799439024';
const comments = [
  { _id: root, parentComment: null, rootComment: null, replyCount: 2 },
  { _id: reply, parentComment: root, rootComment: root, replyCount: 0 },
  { _id: nested, parentComment: reply, rootComment: root, replyCount: 0 },
  { _id: otherRoot, parentComment: null, rootComment: null, replyCount: 0 },
];

const childPlan = buildCommentDeletion(comments, reply);
assert.deepEqual(new Set(childPlan.deletedCommentIds), new Set([reply, nested]));
assert.equal(childPlan.comments.find((comment) => comment._id === root).replyCount, 0);
assert.equal(childPlan.comments.length, 2);

const rootPlan = buildCommentDeletion(comments, root);
assert.deepEqual(new Set(rootPlan.deletedCommentIds), new Set([root, reply, nested]));
assert.equal(rootPlan.comments.length, 1);
assert.equal(rootPlan.comments[0]._id, otherRoot);

console.log('Comment moderation permission and deletion contracts passed');
