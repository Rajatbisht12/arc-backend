const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const read = (rel) => readFileSync(path.join(__dirname, rel), 'utf8');

const controller = read('./audioUploadController.js');
const postController = read('./postController.js');
const userAudioModel = read('../models/UserAudio.js');
const postModel = read('../models/Post.js');
const routes = read('../../modules/music/music.routes.ts');
const adapters = read('../../modules/music/music.legacy-adapters.ts');

test('UserAudio model records ownership + server-observed metadata + status', () => {
  assert.match(userAudioModel, /owner:\s*\{[\s\S]*?ref:\s*'User'[\s\S]*?required:/);
  assert.match(userAudioModel, /sourceType:\s*\{\s*type:\s*String,\s*enum:\s*\['user_upload'\]/);
  assert.match(userAudioModel, /status:\s*\{[\s\S]*?enum:\s*\['ready',\s*'processing',\s*'failed'\]/);
  assert.match(userAudioModel, /copyrightConfirmedAt:\s*\{\s*type:\s*Date/);
  assert.match(userAudioModel, /removed:\s*\{\s*type:\s*Boolean/); // takedown/removal path
});

test('Post.attachedMusic distinguishes library vs user_upload and references audioId', () => {
  assert.match(postModel, /sourceType:\s*\{[\s\S]*?enum:\s*\['library',\s*'user_upload'\][\s\S]*?default:\s*'library'/);
  assert.match(postModel, /audioId:\s*\{\s*type:\s*mongoose\.Schema\.Types\.ObjectId,\s*ref:\s*'UserAudio'/);
  assert.match(postModel, /copyrightConfirmedAt:\s*\{\s*type:\s*Date/);
});

test('upload controller enforces server-side validation and never trusts the extension', () => {
  // MIME + size validated from the multer-parsed upload, not the client's word.
  assert.match(controller, /validateAudioUpload\(\{[\s\S]*?mimeType:\s*file\.mimetype/);
  assert.match(controller, /size:\s*file\.size\s*\?\?\s*file\.buffer\.length/);
  // No file received -> explicit error, not a crash.
  assert.match(controller, /code:\s*'no_file'/);
});

test('upload is storage-first and cannot orphan a DB row or a stored object', () => {
  // Upload to storage inside try/catch; on failure return before creating a row.
  assert.match(controller, /await uploadAudio\(/);
  assert.match(controller, /code:\s*'storage_failed'/);
  // If persisting fails AFTER storage succeeded, the stored object is cleaned up.
  assert.match(controller, /deleteFile\(stored\.publicId\)/);
});

test('canonical payload carries the full audio contract', () => {
  for (const key of ['id:', 'url:', 'streamUrl:', 'title:', 'duration:', 'mimeType:', 'fileSize:', 'sourceType:', 'status:', 'waveformUrl:', 'copyrightConfirmedAt:']) {
    assert.match(controller, new RegExp(key), `payload must expose ${key}`);
  }
});

test('removal is owner-only (moderation/takedown path)', () => {
  assert.match(controller, /String\(doc\.owner\)\s*!==\s*String\(req\.user\._id\)/);
  assert.match(controller, /doc\.removed\s*=\s*true/);
});

test('createPost resolves user_upload server-side and never publishes the client URL', () => {
  // Ownership-checked lookup of the uploaded record.
  assert.match(postController, /UserAudio\.findOne\(\{\s*_id:\s*parsed\.audioId,\s*owner:\s*req\.user\._id/);
  // The published url is the trusted record url, not parsed.url.
  assert.match(postController, /url:\s*audioDoc\.url,\s*\/\/ trusted server URL/);
  // audioId is persisted on the post's attachedMusic.
  assert.match(postController, /audioId:\s*audioDoc\._id/);
});

test('createPost requires copyright affirmation before publishing a user upload', () => {
  assert.match(postController, /copyrightConfirmedAt[\s\S]*?parsed\.copyrightConfirmed\s*\?\s*new Date\(\)\s*:\s*null/);
  // Attach only when BOTH the record resolved AND confirmation exists.
  assert.match(postController, /if\s*\(audioDoc\s*&&\s*confirmedAt\)\s*\{/);
});

test('library picks keep their existing behavior (sourceType defaults to library)', () => {
  assert.match(postController, /sourceType\s*=\s*parsed\.sourceType === 'user_upload'\s*\?\s*'user_upload'\s*:\s*'library'/);
  assert.match(postController, /sourceType:\s*'library'/);
});

test('routes require auth and reuse the multer music field', () => {
  assert.match(routes, /router\.post\(\s*["']\/upload["'],\s*protect,\s*uploadSingle\(\s*["']music["']\s*\),\s*uploadUserAudio\s*\)/);
  assert.match(routes, /router\.get\(\s*["']\/upload\/mine["'],\s*protect,\s*listMyAudio\s*\)/);
  assert.match(routes, /router\.delete\(\s*["']\/upload\/:id["'],\s*protect,\s*removeUserAudio\s*\)/);
  // The bridge exposes protect + multer + controller from the legacy source.
  assert.match(adapters, /protect/);
  assert.match(adapters, /uploadSingle/);
  assert.match(adapters, /uploadUserAudio,\s*listMyAudio,\s*removeUserAudio/);
});
