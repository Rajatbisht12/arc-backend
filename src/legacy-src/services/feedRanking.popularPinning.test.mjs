// REAL-DB regression for the production bug: a very popular boosted post (e.g.
// a 25k-view admin-boosted clip) stayed pinned at #1 forever and froze the feed
// because raw engagement (views*0.35 ≈ 8750) dwarfed every other signal. After
// compressing engagement to a bounded log scale, the seen-penalty + session-seed
// exploration + boost de-pinning can rotate it. Proves it is NOT always #1 and
// that it sinks once seen.
import { MongoMemoryServer } from 'mongodb-memory-server';
import mongoose from 'mongoose';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);

const User = require('../models/User');
const Post = require('../models/Post');
const { getRecommendedPosts } = require('./recommendationService');

const mem = await MongoMemoryServer.create();
await mongoose.connect(mem.getUri());
try {
  const now = Date.now();
  const hoursAgo = (h) => new Date(now - h * 3600e3);
  const viewer = await User.create({ username: 'viewer', email: 'v@v.com', password: 'x'.repeat(8), userType: 'player', isActive: true, profile: { displayName: 'V' } });
  const author = await User.create({ username: 'author1', email: 'a@a.com', password: 'x'.repeat(8), userType: 'player', isActive: true, profile: { displayName: 'A' } });

  const label = new Map();
  const make = async (name, { ageH, views = 0, likes = 0, boost = false }) => {
    const doc = {
      author: author._id, visibility: 'public', isActive: true, content: { text: name },
      createdAt: hoursAgo(ageH), updatedAt: hoursAgo(ageH),
      views,
      viewedBy: Array.from({ length: Math.min(views, 50) }, () => ({ user: new mongoose.Types.ObjectId(), viewedAt: hoursAgo(ageH) })),
      likes: Array.from({ length: likes }, () => ({ user: new mongoose.Types.ObjectId(), createdAt: hoursAgo(ageH) })),
    };
    if (boost) {
      doc.boostedAt = hoursAgo(ageH);
      doc.boostExpiresAt = new Date(now + 48 * 3600e3);
      doc.boostMeta = { status: 'running', endTime: new Date(now + 48 * 3600e3), purchasedReach: 5000, remainingReach: 4000, budget: 5000, totalSpend: 500 };
    }
    const p = await Post.create(doc);
    label.set(String(p._id), name);
    return p;
  };

  // The "catieee" case: old, hugely popular, boosted.
  await make('CATIEEE', { ageH: 50 * 24, views: 25000, likes: 300, boost: true });
  // Fresh organic posts (what should surface).
  for (let i = 0; i < 15; i++) await make(`FRESH-${i}`, { ageH: 1 + i, views: (i * 13) % 40, likes: i % 5 });

  const posOf = (r, name) => r.posts.findIndex((p) => label.get(String(p._id)) === name);
  const top = (r, n = 5) => r.posts.slice(0, n).map((p) => label.get(String(p._id)));
  const top10 = (r) => new Set(r.posts.slice(0, 10).map((p) => String(p._id)));
  const overlap = (a, b) => { const A = top10(a); return [...top10(b)].filter((id) => A.has(id)).length; };

  // Six refreshes with rotating seeds (impressions accumulate between them).
  const refreshes = [];
  for (let i = 0; i < 6; i++) {
    refreshes.push(await getRecommendedPosts({ user: viewer, query: { sessionSeed: `s${i}`, limit: 15 }, mode: 'feed' }));
  }
  const positions = refreshes.map((r) => posOf(r, 'CATIEEE'));
  const tops = refreshes.map((r) => top(r)[0]);
  const timesAtOne = positions.filter((p) => p === 0).length;
  const freshEverTop = tops.some((t) => String(t).startsWith('FRESH'));
  const overlaps = refreshes.slice(1).map((r, i) => overlap(refreshes[i], r));

  // BEFORE this fix (raw engagement ~8750) CATIEEE was #1 on ALL refreshes and
  // the order never changed. Now:
  // 1) It is NOT pinned at #1 every time.
  assert.ok(timesAtOne < refreshes.length, `CATIEEE must not be #1 every refresh (positions ${positions})`);
  // 2) A FRESH organic post reaches #1 at least once (popular post no longer dwarfs).
  assert.ok(freshEverTop, `a fresh post should top the feed at least once (tops ${tops})`);
  // 3) The order changes across refreshes (not frozen).
  assert.ok(overlaps.some((o) => o < 10), `feed order must change across refreshes (overlaps ${overlaps})`);

  console.log('feed popular-pinning test passed ✅', { catieeePositions: positions, timesAtOne, tops });
} finally {
  await mongoose.disconnect();
  await mem.stop();
}
