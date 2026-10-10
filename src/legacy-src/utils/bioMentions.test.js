const test = require('node:test');
const assert = require('node:assert/strict');
const { resolveBioMentions } = require('./bioMentions');

const users = [
  { _id: 'zoro-id', username: 'zoro' },
  { _id: 'xyz-id', username: 'xyz' },
  { _id: 'new-id', username: 'oldzoro' },
];
const User = {
  find: ({ _id }) => ({
    select: () => ({
      lean: async () => users.filter((user) => _id.$in.includes(user._id)),
    }),
  }),
};
const resolveIds = async (names) => names.flatMap((name) => {
  const user = users.find((candidate) => candidate.username.toLowerCase() === name.toLowerCase());
  return user ? [user._id] : [];
});

test('bio mentions reuse comment boundaries and resolve multiple names in one batch', async () => {
  const mentions = await resolveBioMentions(
    'Hi @ZoRo and @xyz 😊\nmail test@zoro.com, unknown @missing', User, [], resolveIds
  );
  assert.deepEqual(mentions, [
    { user: 'zoro-id', username: 'ZoRo' },
    { user: 'xyz-id', username: 'xyz' },
  ]);
});

test('a saved stable ID survives username changes and takes priority over a recycled name', async () => {
  const mentions = await resolveBioMentions(
    'Thanks @oldzoro', User, [{ user: 'zoro-id', username: 'oldzoro' }], resolveIds
  );
  assert.deepEqual(mentions, [{ user: 'zoro-id', username: 'oldzoro' }]);
});

test('unavailable saved accounts remain plain text', async () => {
  const mentions = await resolveBioMentions(
    '@gone', User, [{ user: 'deleted-id', username: 'gone' }], resolveIds
  );
  assert.deepEqual(mentions, []);
});
