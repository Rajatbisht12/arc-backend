const assert = require('node:assert/strict');
const { test } = require('node:test');
const mongoose = require('mongoose');
const {
  MAX_AUTOMATIC_REPAIR_ROWS,
  auditDuplicateEvents,
  repairDuplicateEvents
} = require('./broadcast-event-index-repair');

const makeCollections = (initialRows) => {
  const rows = [...initialRows];
  const archived = new Map();
  let archiveIndexCreated = false;
  const events = {
    aggregate: () => ({
      async *[Symbol.asyncIterator]() {
        const groups = new Map();
        for (const row of rows) {
          const key = JSON.stringify([
            row.broadcastRecipient?.toString() ?? null,
            row.eventType ?? null
          ]);
          if (!groups.has(key)) groups.set(key, { _id: {
            broadcastRecipient: row.broadcastRecipient ?? null,
            eventType: row.eventType ?? null
          }, count: 0 });
          groups.get(key).count += 1;
        }
        for (const group of groups.values()) if (group.count > 1) yield group;
      }
    }),
    find: (filter) => ({
      sort: () => ({
        toArray: async () => rows.filter((row) =>
          row.broadcastRecipient?.equals(filter.broadcastRecipient) && row.eventType === filter.eventType
        ).sort((a, b) => a.createdAt - b.createdAt ||
          a._id.toString().localeCompare(b._id.toString()))
      })
    }),
    deleteOne: async (filter) => {
      const index = rows.findIndex((row) => row._id.equals(filter._id) &&
        row.broadcastRecipient.equals(filter.broadcastRecipient) && row.eventType === filter.eventType);
      if (index < 0) return { deletedCount: 0 };
      rows.splice(index, 1);
      return { deletedCount: 1 };
    }
  };
  const archive = {
    createIndex: async () => { archiveIndexCreated = true; },
    updateOne: async (filter, update) => {
      const key = filter.sourceEventId.toString();
      if (!archived.has(key)) archived.set(key, update.$setOnInsert);
    },
    findOne: async (filter) => archived.get(filter.sourceEventId.toString()) ?? null
  };
  return {
    rows,
    archived,
    events,
    database: { collection: (name) => {
      assert.equal(name, 'broadcasteventduplicatearchives');
      return archive;
    } },
    archiveIndexCreated: () => archiveIndexCreated
  };
};

test('audits and archives duplicate broadcast events before deleting source rows', async () => {
  const broadcastRecipient = new mongoose.Types.ObjectId();
  const [firstId, secondId, thirdId] = [1, 2, 3].map(() => new mongoose.Types.ObjectId());
  const fixture = makeCollections([
    { _id: firstId, broadcastRecipient, eventType: 'open', createdAt: new Date('2026-01-01'), metadata: { source: 'first' } },
    { _id: secondId, broadcastRecipient, eventType: 'open', createdAt: new Date('2026-01-02'), metadata: { source: 'second' } },
    { _id: thirdId, broadcastRecipient, eventType: 'click', createdAt: new Date('2026-01-03') }
  ]);
  const audit = await auditDuplicateEvents(fixture.events);
  assert.equal(audit.groups, 1);
  assert.equal(audit.redundantRows, 1);
  assert.equal(audit.invalidGroups, 0);
  assert.equal(fixture.archiveIndexCreated(), false, 'audit must remain read-only');

  const result = await repairDuplicateEvents(fixture.database, fixture.events);
  assert.equal(result.archivedRows, 1);
  assert.equal(fixture.rows.length, 2);
  assert(fixture.rows.some((row) => row._id.equals(firstId)));
  assert.equal(fixture.archived.get(secondId.toString()).originalEvent.metadata.source, 'second');
  assert.equal(fixture.archiveIndexCreated(), true);
  assert.equal((await repairDuplicateEvents(fixture.database, fixture.events)).archivedRows, 0);
});

test('refuses malformed duplicate keys without creating an archive or deleting events', async () => {
  const broadcastRecipient = new mongoose.Types.ObjectId();
  const fixture = makeCollections([
    { _id: new mongoose.Types.ObjectId(), broadcastRecipient },
    { _id: new mongoose.Types.ObjectId(), broadcastRecipient }
  ]);
  const audit = await auditDuplicateEvents(fixture.events);
  assert.equal(audit.invalidGroups, 1);
  await assert.rejects(repairDuplicateEvents(fixture.database, fixture.events), /manual review required/);
  assert.equal(fixture.rows.length, 2);
  assert.equal(fixture.archiveIndexCreated(), false);
});

test('refuses to delete a row when the archive copy cannot be verified', async () => {
  const broadcastRecipient = new mongoose.Types.ObjectId();
  const keeper = { _id: new mongoose.Types.ObjectId(), broadcastRecipient, eventType: 'open', createdAt: new Date('2026-01-01') };
  const redundant = { _id: new mongoose.Types.ObjectId(), broadcastRecipient, eventType: 'open', createdAt: new Date('2026-01-02') };
  const fixture = makeCollections([keeper, redundant]);
  fixture.archived.set(redundant._id.toString(), {
    originalEvent: { _id: new mongoose.Types.ObjectId() },
    keptEventId: keeper._id
  });
  await assert.rejects(repairDuplicateEvents(fixture.database, fixture.events), /archive verification failed/);
  assert.equal(fixture.rows.length, 2);
});

test('resumes after an archive write succeeded but source deletion did not', async () => {
  const broadcastRecipient = new mongoose.Types.ObjectId();
  const keeper = { _id: new mongoose.Types.ObjectId(), broadcastRecipient, eventType: 'click', createdAt: new Date('2026-01-01') };
  const redundant = { _id: new mongoose.Types.ObjectId(), broadcastRecipient, eventType: 'click', createdAt: new Date('2026-01-02'), url: 'https://squadhunt.com' };
  const fixture = makeCollections([keeper, redundant]);
  fixture.archived.set(redundant._id.toString(), {
    sourceEventId: redundant._id,
    keptEventId: keeper._id,
    originalEvent: redundant
  });
  const result = await repairDuplicateEvents(fixture.database, fixture.events);
  assert.equal(result.archivedRows, 1);
  assert.deepEqual(fixture.rows.map((row) => row._id.toString()), [keeper._id.toString()]);
  assert.equal(fixture.archived.get(redundant._id.toString()).originalEvent.url, 'https://squadhunt.com');
});

test('refuses unexpectedly large repairs before creating the archive', async () => {
  const fixture = {
    aggregate: () => ({
      async *[Symbol.asyncIterator]() {
        yield {
          _id: { broadcastRecipient: new mongoose.Types.ObjectId(), eventType: 'open' },
          count: MAX_AUTOMATIC_REPAIR_ROWS + 2
        };
      }
    })
  };
  await assert.rejects(repairDuplicateEvents({ collection: () => {
    throw new Error('archive must not be created');
  } }, fixture), /automatic-repair limit/);
});
