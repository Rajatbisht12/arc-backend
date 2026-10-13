// Every authenticated socket joins its own user room, whether or not a chat is
// open. Fan out only to current members: a former member's stale chat-room
// subscription must not keep receiving messages after removal.
const groupMessageDeliveryRooms = (members = []) => {
  const rooms = [];
  const memberIds = new Set();
  for (const member of members) {
    if (!member?.user) continue;
    memberIds.add(String(member.user));
  }
  for (const memberId of memberIds) rooms.push(`user-${memberId}`);
  return rooms;
};

module.exports = { groupMessageDeliveryRooms };
