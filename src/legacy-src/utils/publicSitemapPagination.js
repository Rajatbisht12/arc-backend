const { getJson, setJson } = require('./redisCache');

// Page boundaries are keyed by immutable Mongo IDs, rather than deep skip()
// offsets. Each response re-reads live records and rechecks SEO eligibility.
// A short boundary lifetime lets newly public older records enter the sitemap
// without retaining withdrawn records in a public response cache.
const PAGE_SIZE = 10000;
const CURSOR_TTL_SECONDS = 60;
const COUNT_TTL_SECONDS = 30;
const localCursors = new Map();
const localCounts = new Map();
const countFlights = new Map();
const validCursor = value => typeof value === 'string' && /^[a-f0-9]{24}$/i.test(value);
const cacheKey = (kind, page) => `public-seo:sitemap:${kind}:cursor:${page}`;
const countKey = kind => `public-seo:sitemap:${kind}:candidate-count`;

const candidateCount = async (Model, filter, kind) => {
  const key = countKey(kind);
  const local = localCounts.get(key);
  if (local && local.expires > Date.now()) return local.value;
  const shared = await getJson(key);
  if (Number.isSafeInteger(shared) && shared >= 0) {
    localCounts.set(key, { value: shared, expires: Date.now() + COUNT_TTL_SECONDS * 1000 });
    return shared;
  }
  if (countFlights.has(key)) return countFlights.get(key);
  const task = (async () => {
    const count = await Model.countDocuments(filter);
    if (!Number.isSafeInteger(count) || count < 0) throw new Error('Invalid sitemap count');
    localCounts.set(key, { value: count, expires: Date.now() + COUNT_TTL_SECONDS * 1000 });
    await setJson(key, count, COUNT_TTL_SECONDS);
    return count;
  })();
  countFlights.set(key, task);
  try { return await task; } finally { countFlights.delete(key); }
};

const readCursor = async (kind, page) => {
  const key = cacheKey(kind, page);
  const local = localCursors.get(key);
  if (local && local.expires > Date.now() && validCursor(local.value)) return local.value;
  localCursors.delete(key);
  const shared = await getJson(key);
  if (!validCursor(shared)) return null;
  localCursors.set(key, { value: shared, expires: Date.now() + CURSOR_TTL_SECONDS * 1000 });
  return shared;
};

const writeCursor = async (kind, page, value) => {
  if (!validCursor(value)) return;
  const key = cacheKey(kind, page);
  localCursors.set(key, { value, expires: Date.now() + CURSOR_TTL_SECONDS * 1000 });
  if (localCursors.size > 50000) {
    for (const [entry, cached] of localCursors) if (cached.expires <= Date.now()) localCursors.delete(entry);
  }
  await setJson(key, value, CURSOR_TTL_SECONDS);
};

const afterFilter = (filter, cursor) => cursor ? { ...filter, _id: { $gt: cursor } } : filter;

const startCursorForPage = async (Model, filter, kind, page) => {
  if (page === 1) return '';
  const direct = await readCursor(kind, page);
  if (direct) return direct;

  let startPage = 1;
  let cursor = '';
  for (let previous = page - 1; previous > 1; previous--) {
    const cached = await readCursor(kind, previous);
    if (cached) { startPage = previous; cursor = cached; break; }
  }
  for (let current = startPage; current < page; current++) {
    const ids = await Model.find(afterFilter(filter, cursor))
      .sort({ _id: 1 }).limit(PAGE_SIZE).select('_id').lean();
    if (ids.length < PAGE_SIZE) return null;
    cursor = String(ids[ids.length - 1]._id);
    if (!validCursor(cursor)) throw new Error('Invalid sitemap cursor');
    await writeCursor(kind, current + 1, cursor);
  }
  return cursor;
};

const rememberNextPage = async (kind, page, records) => {
  if (records.length === PAGE_SIZE) await writeCursor(kind, page + 1, String(records[records.length - 1]._id));
};

module.exports = {
  PAGE_SIZE, CURSOR_TTL_SECONDS, candidateCount, afterFilter, startCursorForPage, rememberNextPage,
  clearLocalCursors: () => { localCursors.clear(); localCounts.clear(); countFlights.clear(); }
};
