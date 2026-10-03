const assert = require('node:assert/strict');
const test = require('node:test');
const { extractCommentUsernames, resolveCommentMentions, mentionNotificationRecipients } = require('./commentMentions');

test('extracts distinct mid-sentence mentions but ignores email addresses and malformed tokens', () => {
  assert.deepEqual(extractCommentUsernames('Hey @Zoro @zoro and @Zoya; email a@zoro.com, @no'), ['zoro', 'Zoya']);
  assert.deepEqual(extractCommentUsernames('hello @doesnotexist123'), ['doesnotexist123']);
});

test('resolves names in one user lookup and stores stable user IDs', async () => {
  let lookups = 0;
  const users = [
    { _id: 'user-z', username: 'zoro' },
    { _id: 'user-y', username: 'Zoya' },
  ];
  const User = { find(query) {
    lookups += 1;
    return { select() { return { lean: async () => users.filter((user) => query.$or.some(({ username }) => username.test(user.username))) }; } };
  } };
  assert.deepEqual(await resolveCommentMentions('@zoro @Zoya @zoro @nobody', User), users);
  assert.equal(lookups, 1);
});

test('rejects more than five distinct mention targets before any query', async () => {
  const User = { find() { throw new Error('should not query'); } };
  await assert.rejects(resolveCommentMentions('@user1 @user2 @user3 @user4 @user5 @user6', User), {
    code: 'COMMENT_MENTION_LIMIT',
  });
});

test('one recipient gets one mention; self and normal reply/comment recipients are excluded', () => {
  const mentions = [{ _id: 'reply-author' }, { _id: 'other' }, { _id: 'other' }, { _id: 'sender' }];
  assert.deepEqual(mentionNotificationRecipients(mentions, 'sender', 'reply-author'), [{ _id: 'other' }]);
});
