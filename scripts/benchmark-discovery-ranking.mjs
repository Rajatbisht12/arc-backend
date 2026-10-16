// Local synthetic benchmark only. Both revisions share the exact same catalog
// and database process. No production URI is read and no remote API is called.
import { MongoMemoryServer } from 'mongodb-memory-server';
import mongoose from 'mongoose';
import Module, { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';
import { performance } from 'node:perf_hooks';
const require = createRequire(import.meta.url);
const User = require('../src/legacy-src/models/User');
const Post = require('../src/legacy-src/models/Post');
const Exposure = require('../src/legacy-src/models/ContentExposure');
const Delivery = require('../src/legacy-src/models/RecommendationDelivery');
const State = require('../src/legacy-src/models/RecommendationState');
const Engagement = require('../src/legacy-src/models/PostEngagement');
const logger = require('../src/legacy-src/utils/logger');
logger.info = () => {}; logger.debug = () => {};
const current = require('../src/legacy-src/services/recommendationService');
const servicePath = fileURLToPath(new URL('../src/legacy-src/services/recommendationService.js', import.meta.url));
const baselineRef = process.env.DISCOVERY_BASELINE_REF || 'HEAD';
const baselineSource = execFileSync('git', ['show', `${baselineRef}:src/legacy-src/services/recommendationService.js`], { cwd: dirname(servicePath), encoding: 'utf8' });
const baseline = new Module(servicePath);
baseline.filename = servicePath;
baseline.paths = Module._nodeModulePaths(dirname(servicePath));
baseline._compile(baselineSource, servicePath);
const median = values => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];
const db = await MongoMemoryServer.create();
await mongoose.connect(db.getUri());
try {
  await Promise.all([Exposure.syncIndexes(), Delivery.syncIndexes(), State.syncIndexes(), Post.syncIndexes()]);
  const user = await User.create({ username: 'benchmarkviewer', email: 'viewer@example.invalid', password: 'fixture-password', userType: 'player', isActive: true, profile: { displayName: 'Fixture viewer' } });
  const authors = await User.insertMany(Array.from({ length: 5 }, (_, i) => ({
    username: `benchmarkauthor${i}`, email: `author${i}@example.invalid`, password: 'fixture-only', userType: 'player', isActive: true, profile: { displayName: `Fixture ${i}` }
  })));
  const now = Date.now();
  await Post.insertMany(Array.from({ length: 231 }, (_, i) => ({
    _id: new mongoose.Types.ObjectId((i + 1).toString(16).padStart(24, '0')),
    author: authors[i % 5]._id, visibility: 'public', isActive: true,
    content: { text: `Synthetic ${i}`, media: [{ type: 'video', url: `https://example.invalid/${i}.mp4`, publicId: `fixture/${i}` }] },
    createdAt: new Date(now - i * 60_000)
  })));
  const results = [];
  for (const mode of ['feed', 'clips']) {
    for (const [revision, service] of [['before', baseline.exports], ['after', current]]) {
      await Promise.all([Exposure.deleteMany({}), Delivery.deleteMany({}), State.deleteMany({}), Engagement.deleteMany({})]);
      const ids = new Set(); const recent = []; const times = [];
      let cursor;
      do {
        const start = performance.now();
        const page = await service.getRecommendedPosts({ user, mode, query: {
          limit: 10, sessionSeed: `equivalent-benchmark-${mode}`,
          ...(cursor ? { cursor } : {}), ...(recent.length ? { exclude: recent.slice(-100).join(',') } : {})
        } });
        times.push(performance.now() - start);
        for (const post of page.posts) { ids.add(String(post._id)); recent.push(String(post._id)); }
        cursor = page.pagination.nextCursor;
        if (times.length > 60) throw new Error('Finite benchmark catalog did not terminate');
      } while (cursor);
      const sorted = [...times].sort((a, b) => a - b);
      results.push({ revision, mode, unique: ids.size, delivered: recent.length, pages: times.length,
        firstMs: +times[0].toFixed(2), medianMs: +median(times).toFixed(2),
        p95Ms: +sorted[Math.floor(sorted.length * 0.95)].toFixed(2), totalMs: +times.reduce((a, b) => a + b, 0).toFixed(2) });
    }
  }
  console.log(JSON.stringify({ catalogSize: 231, authors: 5, pageSize: 10, baselineRef, database: 'local MongoMemoryServer; no network or production load', results }, null, 2));
} finally { await mongoose.disconnect(); await db.stop(); }
