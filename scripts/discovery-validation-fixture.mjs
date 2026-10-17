// Local-only actual-controller fixture. Never reads production configuration.
import { createRequire } from 'node:module';
import fs from 'node:fs/promises';
import path from 'node:path';
import { MongoMemoryServer } from 'mongodb-memory-server';
import mongoose from 'mongoose';
const require = createRequire(import.meta.url);
const express = require('express');
const jwt = require('jsonwebtoken');
const User = require('../src/legacy-src/models/User');
const Post = require('../src/legacy-src/models/Post');
const Exposure = require('../src/legacy-src/models/ContentExposure');
const Delivery = require('../src/legacy-src/models/RecommendationDelivery');
const State = require('../src/legacy-src/models/RecommendationState');
const controller = require('../src/legacy-src/controllers/postController');
require('../src/legacy-src/utils/logger').debug = () => {};

export async function createDiscoveryValidationFixture({ buildDir, mediaDir, port = 0 }) {
  const db = await MongoMemoryServer.create();
  await mongoose.connect(db.getUri());
  await Promise.all([Exposure.syncIndexes(), Delivery.syncIndexes(), State.syncIndexes()]);
  const [viewer, author] = await User.create(['viewer', 'author'].map(name => ({
    username: `discovery${name}`, email: `${name}@example.invalid`, password: 'fixture-password', userType: 'player',
    isActive: true, gender: 'other', dob: new Date('2000-01-01'),
    profile: { displayName: `Discovery QA ${name}`, gender: 'other', dob: new Date('2000-01-01') },
  })));
  const user = { ...viewer.toObject(), password: undefined, needsProfileCompletion: false, requiresPasswordSetup: false };
  const token = jwt.sign({ id: String(viewer._id) }, 'disposable-local-discovery-fixture', { expiresIn: '2h' });
  const app = express(); app.use(express.json());
  let requests = [], exposures = [];
  app.get('/health', (_req, res) => res.json({ status: 'ok' }));
  app.get('/api/health', (_req, res) => res.json({ status: 'ok', success: true }));
  app.post('/api/auth/login', (req, res) => {
    if (req.body.username !== 'discoveryviewer' || req.body.password !== 'fixture-password') return res.status(401).json({ success: false });
    res.json({ success: true, data: { token, user } });
  });
  app.use('/api', (req, res, next) => {
    if (req.headers.authorization !== `Bearer ${token}`) return res.status(401).json({ success: false });
    req.user = viewer; next();
  });
  app.get('/api/auth/me', (_req, res) => res.json({ success: true, data: { user } }));
  for (const [route, handler] of [['/api/posts', controller.getPosts], ['/api/posts/clips', controller.getClips], ['/api/posts/feed', controller.getPersonalizedFeed]]) {
    app.get(route, async (req, res) => {
      const json = res.json.bind(res);
      res.json = body => { requests.push({ route, at: Date.now(), cursor: Boolean(req.query.cursor), seed: req.query.sessionSeed,
        ids: (body.data?.posts || []).map(p => String(p._id)), rankingPolicy: body.data?.recommendation?.rankingPolicy,
        tiers: (body.data?.posts || []).map(p => p._ranking?.tier) }); return json(body); };
      await handler(req, res);
    });
  }
  app.post('/api/posts/:id/exposure', async (req, res) => {
    const json = res.json.bind(res);
    res.json = body => { exposures.push({ id: req.params.id, at: Date.now(), context: req.body.context, durationMs: req.body.durationMs, status: res.statusCode }); return json(body); };
    await controller.recordRecommendationExposure(req, res);
  });
  app.post('/api/posts/:id/view', controller.recordClipView);
  app.get('/api/posts/:id', controller.getPost);
  app.use('/api', (_req, res) => res.json({ success: true, data: { users: [], stories: [], notifications: [], tournaments: [], unreadCount: 0 } }));
  app.get('/__fixture__/video-:id.mp4', (_req, res) => res.sendFile(path.resolve(mediaDir, 'clip.mp4')));
  app.get('/__fixture__/image-:id.png', (_req, res) => res.sendFile(path.resolve(mediaDir, 'poster.png')));
  app.get('/__fixture__/poster.png', (_req, res) => res.sendFile(path.resolve(mediaDir, 'poster.png')));
  app.get('/__validation__/state', async (_req, res) => res.json({ requests, exposures,
    persisted: (await Exposure.find({ user: viewer._id }).lean()).map(r => ({ id: String(r.post), canonical: r._id === `${viewer._id}:${r.post}`, at: r.lastViewedAt })) }));
  if (buildDir) {
    app.use(express.static(path.resolve(buildDir), { index: false }));
    app.get('*', async (_req, res) => res.type('html').send((await fs.readFile(path.resolve(buildDir, 'index.html'), 'utf8'))
      .replace(/<meta http-equiv="Content-Security-Policy" content="upgrade-insecure-requests"\s*\/>/, '')));
  }
  const server = await new Promise(resolve => { const s = app.listen(port, '127.0.0.1', () => resolve(s)); });
  const origin = `http://127.0.0.1:${server.address().port}`;
  const catalog = await Post.insertMany(Array.from({ length: 320 }, (_, i) => {
    const _id = new mongoose.Types.ObjectId(); const type = i < 80 ? ['text', 'image', 'video', 'mixed'][i % 4] : 'video';
    const video = { type: 'video', publicId: String(_id), url: `${origin}/__fixture__/video-${_id}.mp4`, coverUrl: `${origin}/__fixture__/poster.png`, width: 360, height: 640 };
    const image = { type: 'image', publicId: `${_id}-image`, url: `${origin}/__fixture__/image-${_id}.png`, width: 360, height: 640 };
    return { _id, author: author._id, isActive: true, visibility: 'public', createdAt: new Date(Date.now() - (i % 7 === 6 ? 60 : 1) * 86400000),
      content: { text: `Fixture ${type} ${i + 1}${i % 13 === 0 ? ' long-caption'.repeat(25) : ''}`, media: type === 'text' ? [] : type === 'image' ? [image] : type === 'mixed' ? [image, video] : [video] } };
  }));
  return { origin, token, user, viewer, catalog, Post, Exposure,
    get requests() { return requests; }, get exposures() { return exposures; },
    async reset() { await Promise.all([Exposure.deleteMany({}), Delivery.deleteMany({}), State.deleteMany({})]); requests = []; exposures = []; },
    async stop() { await new Promise(resolve => server.close(resolve)); await mongoose.disconnect(); await db.stop(); } };
}

if (process.env.VALIDATION_NATIVE === '1') {
  const fixture = await createDiscoveryValidationFixture({ mediaDir: process.env.VALIDATION_MEDIA_DIR, port: Number(process.env.VALIDATION_PORT || 7312) });
  console.log(JSON.stringify({ origin: fixture.origin, catalog: fixture.catalog.length, ready: true }));
  process.once('SIGTERM', async () => { await fixture.stop(); process.exit(0); });
  process.once('SIGINT', async () => { await fixture.stop(); process.exit(0); });
}
