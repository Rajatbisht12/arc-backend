const TeamRecruitment = require('../models/TeamRecruitment');
const PlayerProfile = require('../models/PlayerProfile');
const RecruitmentApplication = require('../models/RecruitmentApplication');
const RecruitmentPostingQuota = require('../models/RecruitmentPostingQuota');

// Amazon DocumentDB drops EVERY input document from a `$lookup` whose `from`
// collection does not exist, instead of returning each row with an empty array
// like MongoDB. The recruitment listing joins `teamrecruitments` to
// `recruitmentapplications` to compute applicantCount, so on a database where
// nobody has applied yet — the applications collection is created lazily on the
// first insert — every listing silently returns zero rows (HTTP 200, empty).
//
// Mongoose is configured with autoCreate:false, so we materialize the canonical
// recruitment collections explicitly. createCollection is idempotent; a
// NamespaceExists race is the success case. This runs once at startup and makes
// a fresh environment behave like a seeded one.
const CANONICAL_MODELS = [
  TeamRecruitment,
  PlayerProfile,
  RecruitmentApplication,
  RecruitmentPostingQuota
];

const isAlreadyExists = (error) => error?.code === 48 || error?.codeName === 'NamespaceExists';

const ensureRecruitmentCollections = async ({ logger } = {}) => {
  const db = CANONICAL_MODELS[0]?.db?.db || CANONICAL_MODELS[0]?.collection?.conn?.db;
  // List existing collections once so we create only what is missing and report
  // accurately. createCollection alone is unreliable for detecting presence:
  // Mongoose does not consistently surface NamespaceExists across drivers.
  let existing = new Set();
  try {
    const names = await db.listCollections({}, { nameOnly: true }).toArray();
    existing = new Set(names.map((entry) => entry.name));
  } catch (error) {
    logger?.warn?.('Could not list collections; will attempt creation blindly', { error: String(error) });
  }

  const created = [];
  for (const model of CANONICAL_MODELS) {
    const name = model.collection.name;
    if (existing.has(name)) continue;
    try {
      await model.createCollection();
      created.push(name);
    } catch (error) {
      if (isAlreadyExists(error)) continue;
      // Do not abort startup for one collection; a broken join is recoverable
      // once ops runs the recruitment index migration, and crashing the process
      // would take down every unrelated route.
      logger?.warn?.('Failed to ensure recruitment collection', { collection: name, error: String(error) });
    }
  }
  if (created.length) {
    logger?.info?.('Materialized missing recruitment collections', { created });
  }
  return created;
};

module.exports = { ensureRecruitmentCollections, CANONICAL_MODELS };
