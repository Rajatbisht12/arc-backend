const assert = require('node:assert/strict');
const { getPrivateS3ObjectKey, resolveClientMediaPayload } = require('./privateMediaDelivery');

const environment = {
  AWS_REGION: 'us-east-1',
  AWS_S3_BUCKET: 'arc-media-test',
  AWS_S3_CDN_URL: 'https://media.example.test'
};
const s3 = 'https://arc-media-test.s3.us-east-1.amazonaws.com';

assert.equal(
  getPrivateS3ObjectKey(`${s3}/gaming-social/messages/private.webp`, environment),
  'gaming-social/messages/private.webp'
);
assert.equal(getPrivateS3ObjectKey(`${s3}/gaming-social/avatars/public.webp`, environment), '');
assert.equal(getPrivateS3ObjectKey(`${s3}/gaming-social/messages/private.webp?X-Amz-Signature=x`, environment), '');

(async () => {
  const signedKeys = [];
  const payload = {
    message: {
      content: {
        media: [{
          url: `${s3}/gaming-social/messages/private.webp`,
          publicId: 'gaming-social/messages/private.webp'
        }]
      },
      sender: { profile: { avatar: `${s3}/gaming-social/avatars/avatar.webp` } }
    },
    story: {
      media: {
        url: `${s3}/gaming-social/stories/story.mp4`,
        publicId: 'gaming-social/stories/story.mp4'
      }
    }
  };
  await resolveClientMediaPayload(payload, environment, async (key) => {
    signedKeys.push(key);
    return `https://signed.example.test/${key}?signature=test`;
  });
  assert.match(payload.message.content.media[0].url, /^https:\/\/signed\.example\.test\//);
  assert.equal(payload.message.sender.profile.avatar, 'https://media.example.test/gaming-social/avatars/avatar.webp');
  assert.match(payload.story.media.url, /^https:\/\/signed\.example\.test\//);
  assert.deepEqual(signedKeys.sort(), [
    'gaming-social/messages/private.webp',
    'gaming-social/stories/story.mp4'
  ]);
  console.log('Private media delivery contracts passed');
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
