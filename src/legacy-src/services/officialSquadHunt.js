const { randomBytes } = require('crypto');
const User = require('../models/User');
const { Message } = require('../models/Message');

const OFFICIAL_USERNAME = 'SquadHunt';

let officialIdentityPromise;

async function resolveOfficialSquadHunt() {
  const matchingAccounts = await User.find({ username: /^squadhunt$/i }).limit(2);
  if (matchingAccounts.length > 1) {
    throw new Error('Reserved SquadHunt username conflicts with an existing account; manual review required');
  }
  const existing = matchingAccounts[0];
  if (existing) {
    if (existing.username !== OFFICIAL_USERNAME || existing.isSystemAccount !== true || existing.userType !== 'system') {
      throw new Error('Reserved SquadHunt username conflicts with an existing account; manual review required');
    }
    return existing;
  }
  try {
    return await User.create({
      username: OFFICIAL_USERNAME,
      email: 'official-system@squadhunt.invalid',
      password: randomBytes(48).toString('hex'),
      userType: 'system',
      isSystemAccount: true,
      isActive: true,
      profile: { displayName: OFFICIAL_USERNAME, avatar: 'https://www.squadhunt.com/logo192.png' }
    });
  } catch (error) {
    if (error?.code !== 11000) throw error;
    const concurrentAccounts = await User.find({ username: /^squadhunt$/i }).limit(2);
    const winner = concurrentAccounts[0];
    if (concurrentAccounts.length === 1 && winner?.username === OFFICIAL_USERNAME && winner.isSystemAccount === true && winner.userType === 'system') return winner;
    throw new Error('Reserved SquadHunt username conflicts with an existing account; manual review required');
  }
}

function getOfficialSquadHunt() {
  if (!officialIdentityPromise) {
    officialIdentityPromise = resolveOfficialSquadHunt().catch((error) => {
      officialIdentityPromise = undefined;
      throw error;
    });
  }
  return officialIdentityPromise;
}

async function deliverBroadcastDm({ recipientLog, broadcast, recipientId }) {
  const official = await getOfficialSquadHunt();
  let message = await Message.findOne({ broadcastRecipient: recipientLog._id });
  let created = false;
  if (!message) {
    try {
      message = await Message.create({
        sender: official._id,
        recipient: recipientId,
        messageType: 'direct',
        broadcastRecipient: recipientLog._id,
        content: { text: broadcast.message, media: [] },
        readBy: [{ user: official._id, readAt: new Date() }]
      });
      created = true;
    } catch (error) {
      if (error?.code !== 11000) throw error;
      message = await Message.findOne({ broadcastRecipient: recipientLog._id });
      if (!message) throw error;
    }
  }
  return { official, message, created };
}

module.exports = { getOfficialSquadHunt, deliverBroadcastDm };
