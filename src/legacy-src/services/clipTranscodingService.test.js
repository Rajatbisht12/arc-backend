const assert = require('node:assert/strict');
const fs = require('fs/promises');
const path = require('path');
const test = require('node:test');
const {
  processClipTranscodeJob,
  setClipTranscodingDependenciesForTests,
} = require('./clipTranscodingService');

const ids = { postId: 'post_1', mediaId: 'media_1', version: 'version_1' };
const claimedPost = {
  content: {
    media: [{
      _id: ids.mediaId,
      type: 'video',
      url: 'https://media.example/fallback.mp4',
      publicId: 'gaming-social/posts/fallback.mp4',
      playback: { status: 'processing', version: ids.version }
    }]
  }
};

const fakePostModel = ({ claim = claimedPost, current = claimedPost, updates = [] } = {}) => ({
  findOneAndUpdate: () => ({ select: async () => claim }),
  findById: () => ({ select: () => ({ lean: async () => current }) }),
  updateOne: async (...args) => {
    updates.push(args);
    return { modifiedCount: 1 };
  },
});

const makeStorage = () => {
  const uploads = [];
  const deleted = [];
  return {
    uploads,
    deleted,
    deletePrefix: async prefix => { deleted.push(prefix); return 0; },
    downloadFile: async (_key, destination) => fs.writeFile(destination, 'source'),
    uploadMediaFile: async (source, publicId) => {
      uploads.push(path.basename(source) === 'master.m3u8' ? 'master' : publicId);
      return { publicId, url: `https://media.example/${publicId}` };
    },
  };
};

const generateFixture = async ({ outputDir }) => {
  const variant = path.join(outputDir, '360p');
  await fs.mkdir(variant, { recursive: true });
  await Promise.all([
    fs.writeFile(path.join(outputDir, 'master.m3u8'), '#EXTM3U\n360p/index.m3u8\n'),
    fs.writeFile(path.join(variant, 'index.m3u8'), '#EXTM3U\n#EXT-X-ENDLIST\n'),
    fs.writeFile(path.join(variant, 'init.mp4'), 'init'),
    fs.writeFile(path.join(variant, 'segment_00000.m4s'), 'segment'),
    fs.writeFile(path.join(outputDir, 'fallback.mp4'), 'fallback'),
  ]);
  return {
    metadata: { width: 360, height: 640, duration: 5 },
    fallbackPath: path.join(outputDir, 'fallback.mp4'),
    renditions: [{
      name: '360p', width: 360, height: 640, videoBitrate: 700000,
      maxRate: 800000, audioBitrate: 96000, hasAudio: true
    }]
  };
};

test.afterEach(() => setClipTranscodingDependenciesForTests());

test('publishes master last and persists ready state while retaining MP4 fallback', async () => {
  const updates = [];
  const storage = makeStorage();
  setClipTranscodingDependenciesForTests({
    Post: fakePostModel({ updates }), storage, generateClipHls: generateFixture
  });
  const result = await processClipTranscodeJob(ids);
  assert.equal(result.ready, true);
  assert.equal(storage.uploads.at(-1), 'master');
  const readyUpdate = updates.find(([, update]) => update.$set?.['content.media.$[media].playback.status'] === 'ready');
  assert.ok(readyUpdate);
  assert.match(readyUpdate[1].$set['content.media.$[media].playback.fallbackMp4Url'], /fallback\.mp4$/);
});

test('failed processing cleans partial output, records a safe code, and remains retryable', async () => {
  const updates = [];
  const storage = makeStorage();
  let attempt = 0;
  setClipTranscodingDependenciesForTests({
    Post: fakePostModel({ updates }),
    storage,
    generateClipHls: async input => {
      attempt += 1;
      if (attempt === 1) {
        const error = new Error('encoder detail');
        error.code = 'CLIP_TRANSCODE_FAILED';
        throw error;
      }
      return generateFixture(input);
    }
  });
  await assert.rejects(processClipTranscodeJob(ids), /encoder detail/);
  const failedUpdate = updates.find(([, update]) => update.$set?.['content.media.$[media].playback.status'] === 'failed');
  assert.equal(failedUpdate[1].$set['content.media.$[media].playback.failureCode'], 'TRANSCODE_FAILED');
  assert.ok(storage.deleted.length >= 2);
  const retried = await processClipTranscodeJob(ids);
  assert.equal(retried.ready, true);
});

test('a completed duplicate is skipped before storage or FFmpeg work', async () => {
  const storage = makeStorage();
  const ready = JSON.parse(JSON.stringify(claimedPost));
  ready.content.media[0].playback.status = 'ready';
  setClipTranscodingDependenciesForTests({
    Post: fakePostModel({ claim: null, current: ready }), storage,
    generateClipHls: async () => { throw new Error('must not run'); }
  });
  const result = await processClipTranscodeJob(ids);
  assert.deepEqual(result, { skipped: true, reason: 'already_ready' });
  assert.equal(storage.uploads.length, 0);
  assert.equal(storage.deleted.length, 0);
});
