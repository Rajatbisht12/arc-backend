const test = require('node:test');
const assert = require('node:assert/strict');
const {
  PUBLIC_MEDIA_PREFIXES,
  getPublicS3ObjectKey,
  normalizeCdnBase,
  publicMediaJsonReplacer,
  rewriteClipMediaUrl,
  rewritePublicMediaUrl,
  rewriteUserMediaDeliveryUrls,
  rewritePostMediaDeliveryUrls
} = require('./mediaDelivery');

const environment = {
  AWS_REGION: 'us-east-1',
  AWS_S3_BUCKET: 'arc-gaming-media-906446637180',
  AWS_S3_CDN_URL: 'https://media.example.cloudfront.net/'
};

test('normalizes only an HTTPS CDN base without credentials or query data', () => {
  assert.equal(normalizeCdnBase('https://media.example.cloudfront.net/'), 'https://media.example.cloudfront.net');
  assert.equal(normalizeCdnBase('http://media.example.test'), '');
  assert.equal(normalizeCdnBase('https://media.example.test?token=secret'), '');
});

test('recognizes all classified public media prefixes in the configured S3 bucket', () => {
  assert.deepEqual(PUBLIC_MEDIA_PREFIXES, [
    'gaming-social/avatars/',
    'gaming-social/banners/',
    'gaming-social/group-avatars/',
    'gaming-social/post-covers/',
    'gaming-social/posts/',
    'gaming-social/clips/',
    'gaming-social/tournaments/'
  ]);
  assert.equal(
    getPublicS3ObjectKey(
      'https://arc-gaming-media-906446637180.s3.us-east-1.amazonaws.com/gaming-social/posts/a.mp4',
      environment.AWS_S3_BUCKET,
      environment.AWS_REGION
    ),
    'gaming-social/posts/a.mp4'
  );
  assert.equal(
    getPublicS3ObjectKey(
      'https://s3.us-east-1.amazonaws.com/arc-gaming-media-906446637180/gaming-social/clips/post/version/master.m3u8',
      environment.AWS_S3_BUCKET,
      environment.AWS_REGION
    ),
    'gaming-social/clips/post/version/master.m3u8'
  );
  for (const objectKey of [
    'gaming-social/avatars/user.webp',
    'gaming-social/banners/banner.webp',
    'gaming-social/group-avatars/group.webp',
    'gaming-social/post-covers/cover.webp',
    'gaming-social/tournaments/tournament.webp'
  ]) {
    assert.equal(
      getPublicS3ObjectKey(
        `https://arc-gaming-media-906446637180.s3.us-east-1.amazonaws.com/${objectKey}`,
        environment.AWS_S3_BUCKET,
        environment.AWS_REGION
      ),
      objectKey
    );
  }
  assert.equal(
    getPublicS3ObjectKey(
      'https://arc-gaming-media-906446637180.s3.us-east-1.amazonaws.com/private/messages/a.mp4',
      environment.AWS_S3_BUCKET,
      environment.AWS_REGION
    ),
    ''
  );
  for (const privateOrMixedKey of [
    'gaming-social/messages/private.webp',
    'gaming-social/stories/followers-only.webp',
    'gaming-social/audio/user-upload.m4a',
    'gaming-social/private-analysis/output.webp'
  ]) {
    assert.equal(
      getPublicS3ObjectKey(
        `https://arc-gaming-media-906446637180.s3.us-east-1.amazonaws.com/${privateOrMixedKey}`,
        environment.AWS_S3_BUCKET,
        environment.AWS_REGION
      ),
      ''
    );
  }
});

test('rewrites legacy public Clip MP4/HLS URLs without touching signed or third-party URLs', () => {
  const direct = 'https://arc-gaming-media-906446637180.s3.us-east-1.amazonaws.com/gaming-social/posts/a.mp4';
  assert.equal(
    rewriteClipMediaUrl(direct, environment),
    'https://media.example.cloudfront.net/gaming-social/posts/a.mp4'
  );
  assert.equal(rewriteClipMediaUrl(`${direct}?X-Amz-Signature=keep-me`, environment), `${direct}?X-Amz-Signature=keep-me`);
  assert.equal(rewriteClipMediaUrl('https://video.example.org/a.mp4', environment), 'https://video.example.org/a.mp4');
});

test('rewrites all Clip playback fields in a post DTO consistently', () => {
  const origin = 'https://arc-gaming-media-906446637180.s3.us-east-1.amazonaws.com';
  const dto = {
    content: {
      media: [{
        type: 'video',
        url: `${origin}/gaming-social/posts/a.mp4`,
        coverUrl: `${origin}/gaming-social/posts/a.jpg`,
        playback: {
          hlsUrl: `${origin}/gaming-social/clips/post/version/master.m3u8`,
          fallbackMp4Url: `${origin}/gaming-social/clips/post/version/fallback.mp4`,
          renditions: [{ playlistUrl: `${origin}/gaming-social/clips/post/version/360p/index.m3u8` }]
        }
      }]
    }
  };
  rewritePostMediaDeliveryUrls(dto, environment);
  assert.equal(dto.content.media[0].url, 'https://media.example.cloudfront.net/gaming-social/posts/a.mp4');
  assert.equal(dto.content.media[0].coverUrl, 'https://media.example.cloudfront.net/gaming-social/posts/a.jpg');
  assert.equal(dto.content.media[0].playback.hlsUrl, 'https://media.example.cloudfront.net/gaming-social/clips/post/version/master.m3u8');
  assert.equal(dto.content.media[0].playback.fallbackMp4Url, 'https://media.example.cloudfront.net/gaming-social/clips/post/version/fallback.mp4');
  assert.equal(dto.content.media[0].playback.renditions[0].playlistUrl, 'https://media.example.cloudfront.net/gaming-social/clips/post/version/360p/index.m3u8');
});

test('rewrites legacy public user media without changing third-party avatars', () => {
  const origin = 'https://arc-gaming-media-906446637180.s3.us-east-1.amazonaws.com';
  const user = {
    profile: {
      avatar: `${origin}/gaming-social/avatars/user.webp`,
      banner: `${origin}/gaming-social/banners/user.webp`
    },
    profilePicture: `${origin}/gaming-social/avatars/user.webp`,
    picture: 'https://lh3.googleusercontent.com/avatar'
  };
  rewriteUserMediaDeliveryUrls(user, environment);
  assert.equal(user.profile.avatar, 'https://media.example.cloudfront.net/gaming-social/avatars/user.webp');
  assert.equal(user.profile.banner, 'https://media.example.cloudfront.net/gaming-social/banners/user.webp');
  assert.equal(user.profilePicture, 'https://media.example.cloudfront.net/gaming-social/avatars/user.webp');
  assert.equal(user.picture, 'https://lh3.googleusercontent.com/avatar');
});

test('JSON response replacer covers group avatars and post covers but preserves private and signed URLs', () => {
  const origin = 'https://arc-gaming-media-906446637180.s3.us-east-1.amazonaws.com';
  assert.equal(
    publicMediaJsonReplacer('avatar', `${origin}/gaming-social/group-avatars/group.webp`, environment),
    'https://media.example.cloudfront.net/gaming-social/group-avatars/group.webp'
  );
  assert.equal(
    rewritePublicMediaUrl(`${origin}/gaming-social/post-covers/cover.webp`, environment),
    'https://media.example.cloudfront.net/gaming-social/post-covers/cover.webp'
  );
  assert.equal(
    publicMediaJsonReplacer('attachment', `${origin}/gaming-social/messages/private.webp`, environment),
    `${origin}/gaming-social/messages/private.webp`
  );
  assert.equal(
    publicMediaJsonReplacer('uploadUrl', `${origin}/gaming-social/avatars/user.webp?X-Amz-Signature=keep`, environment),
    `${origin}/gaming-social/avatars/user.webp?X-Amz-Signature=keep`
  );
});
