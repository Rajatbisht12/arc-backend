const mongoose = require('mongoose');

const DEFAULT_MESSAGE_WINDOW_LIMIT = 40;
const MAX_MESSAGE_WINDOW_LIMIT = 100;

const idString = (value) => String(value?._id || value || '');

const normalizeMessageWindowLimit = (value) => {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_MESSAGE_WINDOW_LIMIT;
  return Math.min(parsed, MAX_MESSAGE_WINDOW_LIMIT);
};

const andFilter = (...filters) => ({
  $and: filters.filter(Boolean),
});

const cursorBoundary = (anchor, direction, inclusive = false) => {
  const createdAtOperator = direction === 'before' ? '$lt' : '$gt';
  const idOperator = direction === 'before'
    ? (inclusive ? '$lte' : '$lt')
    : (inclusive ? '$gte' : '$gt');
  return {
    $or: [
      { createdAt: { [createdAtOperator]: anchor.createdAt } },
      { createdAt: anchor.createdAt, _id: { [idOperator]: anchor._id } },
    ],
  };
};

const createMongooseMessageHistoryRepository = ({ Message, baseFilter, viewerId }) => {
  const summary = '_id createdAt';
  const first = async (filter, sort) => Message.findOne(andFilter(baseFilter, filter))
    .sort(sort)
    .select(summary)
    .lean();
  const many = async (filter, sort, limit) => Message.find(andFilter(baseFilter, filter))
    .sort(sort)
    .limit(limit)
    .select(summary)
    .lean();
  const exists = async (filter) => Boolean(await Message.exists(andFilter(baseFilter, filter)));
  const unreadFilter = {
    sender: { $ne: viewerId },
    'readBy.user': { $ne: viewerId },
  };

  return {
    findAnchor: (messageId) => mongoose.Types.ObjectId.isValid(messageId)
      ? first({ _id: messageId }, { createdAt: 1, _id: 1 })
      : Promise.resolve(null),
    findFirstUnread: () => first(unreadFilter, { createdAt: 1, _id: 1 }),
    findLatest: () => first(null, { createdAt: -1, _id: -1 }),
    countUnread: () => Message.countDocuments(andFilter(baseFilter, unreadFilter)),
    pageBefore: (anchor, limit) => many(cursorBoundary(anchor, 'before'), { createdAt: -1, _id: -1 }, limit),
    pageAfter: (anchor, limit) => many(cursorBoundary(anchor, 'after'), { createdAt: 1, _id: 1 }, limit),
    pageFrom: (anchor, limit) => many(cursorBoundary(anchor, 'after', true), { createdAt: 1, _id: 1 }, limit),
    latestPage: (limit) => many(null, { createdAt: -1, _id: -1 }, limit),
    hasBefore: (anchor) => exists(cursorBoundary(anchor, 'before')),
    hasAfter: (anchor) => exists(cursorBoundary(anchor, 'after')),
  };
};

/**
 * Resolve a bounded, chronological message window. Initial unread windows
 * include one preceding message for context and put the first unread message
 * at index 0 or 1. Cursor requests page independently in either direction.
 */
const resolveMessageHistoryWindow = async ({ repository, limit, before, after }) => {
  const pageLimit = normalizeMessageWindowLimit(limit);
  if (before && after) {
    const error = new Error('Only one message cursor may be supplied');
    error.statusCode = 400;
    throw error;
  }

  let messages = [];
  let firstUnread = null;
  let latest = null;
  let unreadCount = 0;
  let mode = 'latest';

  if (before || after) {
    const anchor = await repository.findAnchor(before || after);
    if (!anchor) {
      const error = new Error('Message cursor is invalid for this conversation');
      error.statusCode = 400;
      throw error;
    }
    messages = before
      ? (await repository.pageBefore(anchor, pageLimit)).reverse()
      : await repository.pageAfter(anchor, pageLimit);
    mode = before ? 'older' : 'newer';
  } else {
    [firstUnread, latest, unreadCount] = await Promise.all([
      repository.findFirstUnread(),
      repository.findLatest(),
      repository.countUnread(),
    ]);
    if (firstUnread) {
      const preceding = await repository.pageBefore(firstUnread, 1);
      const fromUnread = await repository.pageFrom(
        firstUnread,
        Math.max(1, pageLimit - preceding.length),
      );
      messages = [...preceding.reverse(), ...fromUnread];
      mode = 'first_unread';
    } else {
      messages = (await repository.latestPage(pageLimit)).reverse();
    }
  }

  const oldest = messages[0] || null;
  const newest = messages[messages.length - 1] || null;
  const [hasOlder, hasNewer] = await Promise.all([
    oldest ? repository.hasBefore(oldest) : Promise.resolve(false),
    newest ? repository.hasAfter(newest) : Promise.resolve(false),
  ]);

  return {
    messageIds: messages.map(idString),
    initialPosition: before || after ? null : {
      mode,
      unreadCount,
      firstUnreadMessageId: firstUnread ? idString(firstUnread) : null,
      latestMessageId: latest ? idString(latest) : null,
      targetMessageId: firstUnread ? idString(firstUnread) : (latest ? idString(latest) : null),
    },
    pagination: {
      limit: pageLimit,
      oldestCursor: oldest ? idString(oldest) : null,
      newestCursor: newest ? idString(newest) : null,
      hasOlder,
      hasNewer,
      direction: mode === 'older' || mode === 'newer' ? mode : 'initial',
    },
  };
};

module.exports = {
  DEFAULT_MESSAGE_WINDOW_LIMIT,
  MAX_MESSAGE_WINDOW_LIMIT,
  normalizeMessageWindowLimit,
  cursorBoundary,
  createMongooseMessageHistoryRepository,
  resolveMessageHistoryWindow,
};
