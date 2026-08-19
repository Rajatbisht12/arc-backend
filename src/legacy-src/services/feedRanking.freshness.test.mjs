// REAL-DB proof that the Home Feed ranking does NOT pin a boosted post to #1
// and does NOT return a frozen sequence across refreshes — while still giving
// the paid boost genuine distribution. Contrasts the OLD naive ordering
// (boost-first) that reproduces the reported bug against the real
// getRecommendedPosts pipeline. Uses the real models + service, in-memory Mongo.
import { MongoMemoryServer } from 'mongodb-memory-server';
import mongoose from 'mongoose';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);

const User = require('../models/User');
const Post = require('../models/Post');
const { getRecommendedPosts } = require('./recommendationService');
const { isActiveBoost } = require('./boostService');

const mem = await MongoMemoryServer.create();
await mongoose.connect(mem.getUri());

try {
  const now = Date.now();
  const hoursAgo = (h) => new Date(now - h * 3600e3);
  const viewer = await User.create({ username: 'viewer', email: 'v@v.com', password: 'x'.repeat(8), userType: 'player', isActive: true, profile: { displayName: 'Viewer' } });
  const authors = [];
  for (let i = 0; i < 5; i++) authors.push(await User.create({ username: `auth${i}`, email: `a${i}@a.com`, password: 'x'.repeat(8), userType: 'player', isActive: true, profile: { displayName: `A${i}` } }));

  const label = new Map();
  const makePost = async (name, { author, ageH, likes = 0, comments = 0, boost = false }) => {
    const doc = {
      author: author._id, visibility: 'public', isActive: true,
      content: { text: name }, createdAt: hoursAgo(ageH), updatedAt: hoursAgo(ageH),
      likes: Array.from({ length: likes }, () => ({ user: new mongoose.Types.ObjectId(), createdAt: hoursAgo(ageH) })),
      comments: Array.from({ length: comments }, () => ({ user: new mongoose.Types.ObjectId(), text: 'c', createdAt: hoursAgo(ageH) })),
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

  await makePost('BOOST-X', { author: authors[0], ageH: 10, likes: 6, comments: 2, boost: true });
  for (let i = 0; i < 20; i++) await makePost(`ORG-${i}`, { author: authors[i % 5], ageH: 1 + i * 2, likes: (i * 3) % 11, comments: i % 4 });

  const boostPos = (r) => r.posts.findIndex((p) => label.get(String(p._id)) === 'BOOST-X');
  const top10 = (r) => new Set(r.posts.slice(0, 10).map((p) => String(p._id)));
  const overlap = (a, b) => { const A = top10(a); return [...top10(b)].filter((id) => A.has(id)).length; };

  // ---- BEFORE (naive ordering that reproduces the bug): boost-first, then newest. ----
  const all = await Post.find({ isActive: true }).lean();
  const naive = [...all].sort((a, b) => {
    const ba = isActiveBoost(a, now) ? 1 : 0, bb = isActiveBoost(b, now) ? 1 : 0;
    if (ba !== bb) return bb - ba;
    return new Date(b.createdAt) - new Date(a.createdAt);
  });
  const naiveTop = naive.map((p) => label.get(String(p._id)));
  // The naive ordering is deterministic → identical every refresh, boost always #1.
  assert.equal(naiveTop[0], 'BOOST-X', 'BEFORE: naive ordering pins the boost at #1');
  const naiveAgain = [...all].sort((a, b) => {
    const ba = isActiveBoost(a, now) ? 1 : 0, bb = isActiveBoost(b, now) ? 1 : 0;
    if (ba !== bb) return bb - ba; return new Date(b.createdAt) - new Date(a.createdAt);
  }).map((p) => String(p._id));
  assert.deepEqual(naiveAgain, naive.map((p) => String(p._id)), 'BEFORE: naive ordering is frozen across refreshes');

  // ---- AFTER (real pipeline): 3 refreshes with rotating session seeds. ----
  const r1 = await getRecommendedPosts({ user: viewer, query: { sessionSeed: 's1', limit: 15 }, mode: 'feed' });
  const r2 = await getRecommendedPosts({ user: viewer, query: { sessionSeed: 's2', limit: 15 }, mode: 'feed' });
  const r3 = await getRecommendedPosts({ user: viewer, query: { sessionSeed: 's3', limit: 15 }, mode: 'feed' });

  const positions = [boostPos(r1), boostPos(r2), boostPos(r3)];
  // 1) The boosted post is NEVER pinned to position #1.
  assert.ok(positions.every((p) => p !== 0), `AFTER: BOOST-X must never be #1 (was ${positions})`);
  // 2) Boost still gets genuine distribution (appears in the feed).
  assert.ok(positions.some((p) => p >= 0), 'AFTER: boost must still be delivered');
  // 3) The sequence changes meaningfully across refreshes (not frozen).
  assert.ok(overlap(r1, r2) <= 8 && overlap(r2, r3) <= 8, `AFTER: sequence must change (overlaps ${overlap(r1, r2)}, ${overlap(r2, r3)})`);
  // 4) Fresh/unseen organic content surfaces at the very top.
  assert.notEqual(label.get(String(r1.posts[0]._id)), 'BOOST-X');

  // ---- Pagination within ONE session must not duplicate posts. ----
  const p1 = await getRecommendedPosts({ user: viewer, query: { sessionSeed: 'pg', limit: 8 }, mode: 'feed' });
  const p2 = await getRecommendedPosts({ user: viewer, query: { sessionSeed: 'pg', limit: 8, cursor: p1.nextCursor, exclude: p1.posts.map((p) => String(p._id)).join(',') }, mode: 'feed' });
  const p1ids = new Set(p1.posts.map((p) => String(p._id)));
  const dupes = p2.posts.filter((p) => p1ids.has(String(p._id)));
  assert.equal(dupes.length, 0, 'pagination page 2 must not duplicate page 1');

  console.log('feed ranking freshness test passed ✅', { boostPositions: positions, overlaps: [overlap(r1, r2), overlap(r2, r3)] });
} finally {
  await mongoose.disconnect();
  await mem.stop();
}
