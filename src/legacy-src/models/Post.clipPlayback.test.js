const assert = require('node:assert/strict');
const test = require('node:test');
const mongoose = require('mongoose');
const Post = require('./Post');
const { toPostMediaItem } = require('../utils/postMediaDimensions');

test('new videos retain progressive fallback while HLS is processing', () => {
  const media = toPostMediaItem({
    type: 'video',
    url: 'https://media.example/fallback.mp4',
    publicId: 'gaming-social/posts/fallback.mp4',
    width: 720,
    height: 1280,
    duration: 12.5,
  });
  assert.equal(media.url, media.playback.fallbackMp4Url);
  assert.equal(media.playback.status, 'processing');
  assert.equal(media.playback.width, 720);
  assert.equal(media.playback.height, 1280);
  assert.ok(media.playback.version);
});

test('ready HLS playback contract validates without changing legacy media URL', async () => {
  const post = new Post({
    author: new mongoose.Types.ObjectId(),
    content: {
      text: '',
      media: [{
        type: 'video',
        url: 'https://media.example/fallback.mp4',
        publicId: 'gaming-social/posts/fallback.mp4',
        playback: {
          status: 'ready',
          version: 'version-1',
          hlsUrl: 'https://media.example/clips/version-1/master.m3u8',
          fallbackMp4Url: 'https://media.example/fallback.mp4',
          renditions: [{
            name: '360p', width: 360, height: 640, bandwidth: 900000,
            averageBandwidth: 796000,
            playlistUrl: 'https://media.example/clips/version-1/360p/index.m3u8'
          }]
        }
      }]
    }
  });
  await post.validate();
  assert.equal(post.content.media[0].url, 'https://media.example/fallback.mp4');
  assert.equal(post.content.media[0].playback.renditions.length, 1);
});
