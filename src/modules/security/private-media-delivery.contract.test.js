const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..', '..');
const read = (relative) => fs.readFileSync(path.join(root, relative), 'utf8');
const storage = read('infrastructure/storage/s3.ts');
const resolver = read('legacy-src/utils/privateMediaDelivery.js');
const messages = read('legacy-src/controllers/messageController.js');
const stories = read('legacy-src/controllers/storyController.js');
const audio = read('legacy-src/controllers/audioUploadController.js');
const recommendations = read('legacy-src/services/recommendationService.js');
const profiles = read('legacy-src/controllers/userController.js');
const notificationEmitter = read('legacy-src/utils/notificationEmitter.js');
const modularSocket = read('modules/chat/chat.socket.ts');
const legacySocket = read('modules/legacy/legacy.socket.ts');
const randomConnect = read('legacy-src/controllers/randomConnectController.js');
const tournaments = read('legacy-src/controllers/tournamentController.js');
const calls = read('legacy-src/services/callSessionService.js');

for (const prefix of [
  'gaming-social/messages/',
  'gaming-social/stories/',
  'gaming-social/audio/user-uploads/'
]) {
  assert(resolver.includes(`'${prefix}'`), `${prefix} must remain private`);
  assert(storage.includes(`"${prefix}"`), `${prefix} must receive private cache headers`);
}
assert(storage.includes('ResponseCacheControl: PRIVATE_MEDIA_CACHE_CONTROL'));
assert(storage.includes('getSignedUrl('));
assert(messages.includes('messages: await resolveClientMediaPayload(messages)'));
assert(messages.includes('const clientMessages = await resolveClientMediaPayload(messages.reverse())'));
assert(messages.includes('const clientPayload = await resolveClientMediaPayload({'));
assert(messages.includes('res.status(200).json(clientPayload);'));
assert.equal((messages.match(/\.emit\('newMessage'/g) || []).length, 1,
  'all legacy message emits must flow through the signed-media helper');
assert(stories.includes('const safeStory = await resolveClientMediaPayload'));
assert(stories.includes('finalUsers = await resolveClientMediaPayload(finalUsers)'));
assert(audio.includes('toAuthorizedAudioPayload'));
assert(recommendations.includes('const deliveredMedia = await resolveClientMediaPayload'));
assert(profiles.includes('deliveredRecentPosts'));
assert(notificationEmitter.includes("emit('new-notification', rewritePublicMediaPayload(notification))"));
assert(modularSocket.includes('await resolveClientMediaPayload({ chatId, message })'));
assert(legacySocket.includes('emit("newMessage", rewritePublicMediaPayload'));
assert(legacySocket.includes('emit("call-request", rewriteSocketPublicMedia'));
assert(messages.includes("emit('groupInfoUpdated', deliveredGroupInfo)"));
assert(randomConnect.includes('return rewritePublicMediaPayload({'));
assert(tournaments.includes('const payload = rewritePublicMediaPayload('));
assert(calls.includes('const serializeCallSession = (session) => session ? rewritePublicMediaPayload({'));

console.log('Private REST and Socket.IO media delivery contracts passed');
