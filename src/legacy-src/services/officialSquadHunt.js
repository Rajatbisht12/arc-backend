const { randomBytes } = require('crypto');
const User = require('../models/User');
const { Message } = require('../models/Message');
const Broadcast = require('../models/Broadcast');
const BroadcastRecipient = require('../models/BroadcastRecipient');

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
        broadcastCta: {
          text: broadcast.cta?.text || '',
          url: broadcast.cta?.url || '',
          deepLink: broadcast.cta?.deepLink || '',
          type: broadcast.cta?.type || 'none'
        },
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

// Older broadcast DMs predate CTA snapshots. Enrich only the bounded history
// page being returned; no historical notification or message is mutated.
async function hydrateBroadcastMessageCtas(messages) {
  const missing = messages.filter((message) => message.broadcastRecipient && !message.broadcastCta?.text);
  if (!missing.length) return messages;
  const recipients = await BroadcastRecipient.find({
    _id: { $in: missing.map((message) => message.broadcastRecipient) }
  }).select('_id broadcast').lean();
  const broadcasts = await Broadcast.find({
    _id: { $in: recipients.map((recipient) => recipient.broadcast).filter(Boolean) }
  }).select('_id cta').lean();
  const ctaByBroadcast = new Map(broadcasts.map((broadcast) => [String(broadcast._id), broadcast.cta]));
  const ctaByRecipient = new Map(recipients.map((recipient) => [
    String(recipient._id), ctaByBroadcast.get(String(recipient.broadcast))
  ]));
  for (const message of missing) {
    const cta = ctaByRecipient.get(String(message.broadcastRecipient));
    if (cta?.text && (cta.url || cta.deepLink || cta.type !== 'none')) {
      message.broadcastCta = { text: cta.text, url: cta.url || '', deepLink: cta.deepLink || '', type: cta.type || 'none' };
    }
  }
  return messages;
}

module.exports = { getOfficialSquadHunt, deliverBroadcastDm, hydrateBroadcastMessageCtas };
