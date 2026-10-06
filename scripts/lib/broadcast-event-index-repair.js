const mongoose = require('mongoose');

const ARCHIVE_COLLECTION = 'broadcasteventduplicatearchives';
const MAX_AUTOMATIC_REPAIR_ROWS = 10000;
const EVENT_TYPES = new Set(['delivered', 'open', 'click']);

const duplicatePipeline = [
  {
    $group: {
      _id: { broadcastRecipient: '$broadcastRecipient', eventType: '$eventType' },
      count: { $sum: 1 }
    }
  },
  { $match: { count: { $gt: 1 } } }
];

const validKey = (key) => (
  key?.broadcastRecipient instanceof mongoose.Types.ObjectId &&
  EVENT_TYPES.has(key?.eventType)
);

const eachDuplicateGroup = (collection) =>
  collection.aggregate(duplicatePipeline, { allowDiskUse: true });

const auditDuplicateEvents = async (collection) => {
  const report = { groups: 0, redundantRows: 0, invalidGroups: 0, samples: [] };
  for await (const group of eachDuplicateGroup(collection)) {
    report.groups += 1;
    report.redundantRows += group.count - 1;
    if (!validKey(group._id)) report.invalidGroups += 1;
    if (report.samples.length < 10) {
      report.samples.push({
        broadcastRecipient: group._id?.broadcastRecipient?.toString() ?? null,
        eventType: group._id?.eventType ?? null,
        count: group.count
      });
    }
  }
  return report;
};

const repairDuplicateEvents = async (database, eventCollection) => {
  const before = await auditDuplicateEvents(eventCollection);
  if (!before.groups) return { ...before, archivedRows: 0 };
  if (before.invalidGroups) {
    throw new Error(`BroadcastEvent has ${before.invalidGroups} duplicate group(s) with invalid/missing keys; manual review required`);
  }
  if (before.redundantRows > MAX_AUTOMATIC_REPAIR_ROWS) {
    throw new Error(`BroadcastEvent has ${before.redundantRows} redundant rows, above the ${MAX_AUTOMATIC_REPAIR_ROWS} automatic-repair limit`);
  }

  const archive = database.collection(ARCHIVE_COLLECTION);
  await archive.createIndex({ sourceEventId: 1 }, { unique: true });
  let archivedRows = 0;

  for await (const group of eachDuplicateGroup(eventCollection)) {
    if (!validKey(group._id)) throw new Error('BroadcastEvent duplicate key changed during repair; manual review required');
    const rows = await eventCollection.find({
      broadcastRecipient: group._id.broadcastRecipient,
      eventType: group._id.eventType
    }).sort({ createdAt: 1, _id: 1 }).toArray();
    if (rows.length < 2) continue;
    const keeper = rows[0];

    for (const redundant of rows.slice(1)) {
      await archive.updateOne(
        { sourceEventId: redundant._id },
        {
          $setOnInsert: {
            sourceEventId: redundant._id,
            keptEventId: keeper._id,
            reason: 'duplicate_broadcast_recipient_event_type',
            archivedAt: new Date(),
            originalEvent: redundant
          }
        },
        { upsert: true }
      );
      const saved = await archive.findOne({ sourceEventId: redundant._id });
      if (!saved?.originalEvent?._id?.equals(redundant._id) ||
          !saved?.keptEventId?.equals(keeper._id)) {
        throw new Error(`BroadcastEvent archive verification failed for ${redundant._id}`);
      }
      const deleted = await eventCollection.deleteOne({
        _id: redundant._id,
        broadcastRecipient: group._id.broadcastRecipient,
        eventType: group._id.eventType
      });
      if (deleted.deletedCount !== 1) {
        throw new Error(`BroadcastEvent changed while archiving ${redundant._id}; retry after auditing`);
      }
      archivedRows += 1;
    }
  }

  const after = await auditDuplicateEvents(eventCollection);
  if (after.groups) throw new Error(`BroadcastEvent still has ${after.groups} duplicate group(s) after repair`);
  return { ...before, archivedRows };
};

module.exports = {
  ARCHIVE_COLLECTION,
  MAX_AUTOMATIC_REPAIR_ROWS,
  auditDuplicateEvents,
  repairDuplicateEvents
};
