const assert = require('assert');
const fs = require('fs');
const path = require('path');

const legacyRoot = path.resolve(__dirname, '..');
const backendRoot = path.resolve(legacyRoot, '..');
const read = (relativePath) => fs.readFileSync(path.join(backendRoot, relativePath), 'utf8');

const routes = read('modules/notifications/notifications.routes.ts');
const model = read('legacy-src/models/Notification.js');
const privacy = read('legacy-src/utils/notificationPrivacy.js');
const emitter = read('legacy-src/utils/notificationEmitter.js');
const notificationService = read('legacy-src/utils/notificationService.js');
const postController = read('legacy-src/controllers/postController.js');
const adminController = read('legacy-src/controllers/adminController.js');
const recruitmentController = read('legacy-src/controllers/recruitmentController.js');
const scrimController = read('legacy-src/controllers/scrimController.js');
const storyController = read('legacy-src/controllers/storyController.js');
const tournamentDeletionService = read('legacy-src/services/tournamentDeletionService.js');

const listRoute = routes.slice(routes.indexOf('router.get("/", protect'), routes.indexOf('router.put("/:id/read"'));
assert(listRoute.indexOf('repairNotificationHistory({ recipientId: userId })') < listRoute.indexOf('.skip(skip)'));
assert(listRoute.includes('getRestrictedNotificationIdsForViewer(visibilityCandidates, req.user)'));
assert(!privacy.includes('Activity unavailable'));
assert(!privacy.includes('This notification refers to content that is no longer available'));
assert(privacy.includes('return visibleRows.flatMap'));

assert(model.includes("name: 'unique_like_notification_per_actor_target'"));
assert(model.includes("{ recipient: 1, sender: 1, type: 1, 'data.postId': 1 }"));
assert(model.includes("notificationSchema.index({ 'data.recruitmentId': 1 })"));
assert(model.includes("notificationSchema.index({ 'data.scrimId': 1 })"));

assert(notificationService.includes('buildLikeNotificationDedupeKey'));
assert(notificationService.includes("dedupeBehavior: 'refresh'"));
assert(emitter.includes("normalizedNotificationData.dedupeBehavior === 'refresh'"));
assert(emitter.includes('Notification.findOneAndUpdate'));
assert(postController.includes('likeRelationshipCreated = Number(likeResult?.modifiedCount || 0) === 1'));
assert(postController.includes('isLiked && likeRelationshipCreated'));

for (const source of [
  postController,
  adminController,
  recruitmentController,
  scrimController,
  storyController,
  tournamentDeletionService
]) {
  assert(source.includes('deleteNotificationsForTarget'));
}

console.log('Notification history lifecycle contracts passed');
