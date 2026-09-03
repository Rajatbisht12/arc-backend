const assert = require('assert');
const fs = require('fs');
const path = require('path');

const controller = fs.readFileSync(path.resolve(__dirname, '../controllers/messageController.js'), 'utf8');
const createStart = controller.indexOf('const createChatRoom');
const createEnd = controller.indexOf('const getChatRooms', createStart);
const addStart = controller.indexOf('const addMemberToChatRoom');
const addEnd = controller.indexOf('const removeMemberFromChatRoom', addStart);
const joinStart = controller.indexOf('const joinGroupViaInvite');
const joinEnd = controller.indexOf('// POST /rooms/:chatRoomId/send-invite-dm', joinStart);

const createBody = controller.slice(createStart, createEnd);
const addBody = controller.slice(addStart, addEnd);
const joinBody = controller.slice(joinStart, joinEnd);

assert(createBody.includes('resolveGroupAddPrivacy({ actor: req.user, targets: validMembers })'));
assert(createBody.includes('blockedMembers.push'));
assert(createBody.includes('code: decision.code'));
assert(createBody.includes('message: decision.message'));
assert(addBody.includes('resolveGroupAddPrivacy({ actor: req.user, targets: [user] })'));
assert(addBody.includes("select('privacySettings username isActive profile blockedUsers')"));
assert(!addBody.includes("select('+privacySettings"), 'existing-group additions must load the real privacy subdocument');
assert(addBody.includes('code: decision.code'));
assert(addBody.includes('targetUsername: user.username'));
assert(!joinBody.includes('resolveGroupAddPrivacy'), 'explicit invite acceptance must remain user-consented and exempt');
assert(joinBody.includes('members.push({ user: userId'));

console.log('group add privacy controller contract tests passed');
