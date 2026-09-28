const test = require('node:test');
const assert = require('node:assert/strict');
const {
  getPublicS3ObjectKey,
  normalizeCdnBase,
  rewriteClipMediaUrl,
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

test('recognizes only public post and clip objects in the configured S3 bucket', () => {
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
  assert.equal(
    getPublicS3ObjectKey(
      'https://arc-gaming-media-906446637180.s3.us-east-1.amazonaws.com/private/messages/a.mp4',
      environment.AWS_S3_BUCKET,
      environment.AWS_REGION
    ),
    ''
  );
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
