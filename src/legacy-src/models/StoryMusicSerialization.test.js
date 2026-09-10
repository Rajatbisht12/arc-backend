// Contract: the API must not claim a story has music when it does not.
//
// `Story.music` is a nested path with defaults (sourceType 'library', title '',
// artist '', coverUrl '', startTime 0), so Mongoose materialises it for EVERY
// story. Serialised, that is a truthy object carrying no url. Both clients read
// "does this story have music?" as truthiness (shouldMuteStoryVideo -> the
// composer holds null until a track is picked, so truthiness is right THERE),
// which meant a video story posted with no music had its original audio muted
// at playback because the API said a track existed.
//
// The video file itself is untouched — processStoryVideo re-encodes audio with
// `-c:a aac` and never strips it. This was only ever a playback-layer mute.
const assert = require('node:assert/strict');
const test = require('node:test');
const mongoose = require('mongoose');
const Story = require('./Story.js');

const makeStory = (music) => new Story({
  user: new mongoose.Types.ObjectId(),
  mediaType: 'video',
  mediaUrl: 'https://cdn.example/v.mp4',
  ...(music ? { music } : {}),
});

test('THE BUG: a story posted without music reports no music', () => {
  const json = JSON.parse(JSON.stringify(makeStory(null)));
  assert.equal('music' in json, false);
  assert.equal(Boolean(json.music), false, 'clients read this as truthiness');
});

test('a story with a real track still reports it', () => {
  const json = JSON.parse(JSON.stringify(makeStory({ url: 'https://cdn.example/t.mp3', title: 'T' })));
  assert.equal(Boolean(json.music), true);
  assert.equal(json.music.url, 'https://cdn.example/t.mp3');
  assert.equal(json.music.title, 'T');
});

test('a music object whose url never landed is not a track', () => {
  for (const music of [{ title: 'T' }, { url: '' }, { url: '   ' }]) {
    const json = JSON.parse(JSON.stringify(makeStory(music)));
    assert.equal('music' in json, false, `expected no music for ${JSON.stringify(music)}`);
  }
});

test('lean reads are covered too, since the read paths use .lean()', () => {
  // toJSON/toObject transforms do NOT run for lean queries, so the schema also
  // registers query post-hooks. Assert they are registered rather than silently
  // relying on the transform alone.
  const hooked = ['find', 'findOne', 'findOneAndUpdate'];
  const registered = Story.schema.s.hooks._posts;
  hooked.forEach((name) => {
    assert.ok(registered.get(name)?.length, `expected a post('${name}') hook for lean results`);
  });
});
