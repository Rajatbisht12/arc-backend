// Local end-to-end regression: production Web bundle -> real post controllers
// -> disposable MongoDB -> recommendation responses. Never uses production
// credentials, database configuration or media. Requires a fixture MP4/poster.
// node scripts/validate-discovery-browser.mjs <web-dist> <media-dir> <output.json>
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import { MongoMemoryServer } from 'mongodb-memory-server';
import mongoose from 'mongoose';
const require = createRequire(import.meta.url);
const express = require('express');
const jwt = require('jsonwebtoken');
const [buildDir, mediaDir, output] = process.argv.slice(2);
if (!buildDir || !mediaDir || !output) throw new Error('Provide web-dist, fixture-media-dir and output.json');
const { chromium, webkit } = await import(process.env.SQUADHUNT_PLAYWRIGHT_MODULE
  ? pathToFileURL(process.env.SQUADHUNT_PLAYWRIGHT_MODULE).href : 'playwright');
const User = require('../src/legacy-src/models/User');
const Post = require('../src/legacy-src/models/Post');
const Exposure = require('../src/legacy-src/models/ContentExposure');
const Delivery = require('../src/legacy-src/models/RecommendationDelivery');
const State = require('../src/legacy-src/models/RecommendationState');
const controller = require('../src/legacy-src/controllers/postController');
require('../src/legacy-src/utils/logger').debug = () => {};
const db = await MongoMemoryServer.create();
await mongoose.connect(db.getUri());
await Promise.all([Exposure.syncIndexes(), Delivery.syncIndexes(), State.syncIndexes()]);
const [viewer, author] = await User.create(['viewer', 'author'].map(name => ({
  username: `browser${name}`, email: `${name}@example.invalid`, password: 'fixture-password',
  userType: 'player', isActive: true, profile: { displayName: name },
})));
const token = jwt.sign({ id: String(viewer._id) }, 'disposable-local-browser-fixture', { expiresIn: '1h' });
const app = express();
app.use(express.json());
let requests = [], exposures = [];
app.use('/api', async (req, res, next) => {
  try {
    if (req.headers.authorization !== `Bearer ${token}`) return res.status(401).json({ success: false });
    req.user = viewer;
    next();
  } catch { res.status(401).json({ success: false }); }
});
app.get('/api/auth/me', (_req, res) => res.json({ success: true, data: { user: viewer } }));
for (const [route, handler] of [['/api/posts', controller.getPosts], ['/api/posts/clips', controller.getClips]]) {
  app.get(route, async (req, res) => {
    const json = res.json.bind(res);
    res.json = body => { requests.push({ route, cursor: Boolean(req.query.cursor), ids: (body.data?.posts || []).map(p => String(p._id)),
      rankingPolicy: body.data?.recommendation?.rankingPolicy,
      tiers: (body.data?.posts || []).map(p => p._ranking?.tier),
      uploadDays: (body.data?.posts || []).map(p => Math.floor((Date.now() - new Date(p.createdAt).getTime()) / 86400000)) }); return json(body); };
    await handler(req, res);
  });
}
app.post('/api/posts/:id/exposure', async (req, res) => {
  const json = res.json.bind(res);
  res.json = body => { exposures.push({ id: req.params.id, context: req.body.context, durationMs: req.body.durationMs, status: res.statusCode }); return json(body); };
  await controller.recordRecommendationExposure(req, res);
});
app.post('/api/posts/:id/view', controller.recordClipView);
app.get('/api/posts/:id', controller.getPost);
app.use('/api', (_req, res) => res.json({ success: true, data: { users: [], stories: [], notifications: [], tournaments: [], unreadCount: 0 } }));
app.get('/__fixture__/video-:id.mp4', (_req, res) => res.sendFile(path.resolve(mediaDir, 'clip.mp4')));
app.get('/__fixture__/poster.png', (_req, res) => res.sendFile(path.resolve(mediaDir, 'poster.png')));
app.use(express.static(path.resolve(buildDir), { index: false }));
app.get('*', async (_req, res) => res.type('html').send((await fs.readFile(path.resolve(buildDir, 'index.html'), 'utf8'))
  .replace(/<meta http-equiv="Content-Security-Policy" content="upgrade-insecure-requests"\s*\/>/, '')));
const server = await new Promise(resolve => { const s = app.listen(Number(process.env.VALIDATION_PORT) || 0, '127.0.0.1', () => resolve(s)); });
const origin = `http://127.0.0.1:${server.address().port}`;
const catalog = await Post.insertMany(Array.from({ length: 231 }, (_, index) => {
  const _id = new mongoose.Types.ObjectId();
  return { _id, author: author._id, visibility: 'public', isActive: true,
    createdAt: new Date(Date.now() - (index % 2 ? 30 * 86400000 : 0) - index * 1000),
    // An older, higher-quality unseen item must compete in the same tier.
    ...(index === 1 ? { views: 1_000_000 } : {}),
    content: { text: `Video ${index + 1}`, media: [{ type: 'video', publicId: String(_id),
      url: `${origin}/__fixture__/video-${_id}.mp4`, coverUrl: `${origin}/__fixture__/poster.png`, width: 360, height: 640 }] } };
}));
const engine = process.env.VALIDATION_BROWSER === 'webkit' ? webkit : chromium;
const externalBrowser = Boolean(process.env.VALIDATION_CDP);
const browser = externalBrowser ? await chromium.connectOverCDP(process.env.VALIDATION_CDP)
  : await engine.launch(engine === chromium ? { channel: 'chrome' } : {});
const results = [];
try {
  for (const mobile of externalBrowser ? [true] : [false, true]) {
    await Promise.all([Exposure.deleteMany({}), Delivery.deleteMany({}), State.deleteMany({})]);
    requests = []; exposures = [];
    const context = externalBrowser ? browser.contexts()[0]
      : await browser.newContext({ viewport: mobile ? { width: 390, height: 844 } : { width: 1440, height: 900 }, isMobile: mobile });
    const page = await context.newPage();
    await page.route('**/*', route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort());
    await page.addInitScript(({ token, origin }) => { if (location.origin === origin) localStorage.setItem('token', token); }, { token, origin });
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.goto(origin);
    await page.locator('video').first().waitFor();
    const initial = requests.find(r => r.route === '/api/posts' && r.ids.length);
    assert.equal(initial.rankingPolicy, 'unseen-age-neutral-v1');
    assert.ok(initial.tiers.every(tier => tier === 1));
    assert.ok(initial.uploadDays.some(days => days >= 30), 'older unseen video reaches the same initial tier as recent uploads');
    const watched = new Set();
    for (let index = 0; index < 5; index++) {
      const card = page.locator('[data-feed-post-id]').nth(index);
      const canonicalId = await card.getAttribute('data-feed-post-id');
      await card.scrollIntoViewIfNeeded();
      const video = card.locator('video');
      await video.waitFor();
      const src = await video.getAttribute('src');
      const id = /video-([a-f\d]{24})\.mp4/.exec(src || '')?.[1];
      assert.ok(id, 'visible video retains its canonical post source');
      try {
        await page.waitForFunction(id => { const v = document.querySelector(`[data-feed-post-id="${id}"] video`); return v && !v.paused && v.currentTime >= 3; }, canonicalId, { timeout: 20000 });
      } catch (error) {
        console.log('Feed playback diagnostic', index, await page.locator('video').evaluateAll(videos => videos.slice(0, 6).map(v => ({ src: v.currentSrc, paused: v.paused, time: v.currentTime, error: v.error?.message, rect: { top: v.getBoundingClientRect().top, height: v.getBoundingClientRect().height } }))), errors);
        await page.screenshot({ path: `${output}.failure.png` });
        throw error;
      }
      if (!exposures.some(e => e.id === id && e.status === 200)) {
        await page.waitForResponse(r => r.url().endsWith(`/api/posts/${id}/exposure`) && r.status() === 200, { timeout: 10000 });
      }
      assert.ok(await Exposure.findOne({ user: viewer._id, post: id }).lean(), 'exposure must persist, not merely be attempted');
      watched.add(id);
    }
    await page.screenshot({ path: `${output}.${mobile ? 'mobile' : 'desktop'}-feed.png` });
    const refreshChecks = [];
    const checkNewSession = async (surface, refresh) => {
      const response = await context.request.get(`${origin}/api/posts${surface === 'clips' ? '/clips' : ''}?limit=30&sessionSeed=${mobile}-${surface}-${refresh}`, { headers: { Authorization: `Bearer ${token}` } });
      assert.equal(response.status(), 200);
      const data = (await response.json()).data;
      assert.equal(data.recommendation.algorithm, 'discovery-v3');
      assert.equal(data.recommendation.rankingPolicy, 'unseen-age-neutral-v1');
      assert.ok(data.posts.every(p => p._ranking.tier === 1));
      const repeats = data.posts.filter(p => watched.has(p._id));
      assert.equal(repeats.length, 0, `watched video repeated after ${surface} refresh ${refresh}`);
      refreshChecks.push({ surface, refresh, checked: data.posts.length, repeats: 0 });
    };
    for (let refresh = 0; refresh < 6; refresh++) {
      await page.reload();
      await page.locator('video').first().waitFor();
      for (const surface of ['feed', 'clips']) await checkNewSession(surface, refresh);
    }
    await page.goto(`${origin}/clips`);
    for (let index = 0; index < 5; index++) {
      await page.waitForFunction(() => Boolean(document.querySelector('video[data-load-role="active"]')));
      const video = page.locator('video[data-load-role="active"]');
      const id = /video-([a-f\d]{24})\.mp4/.exec(await video.getAttribute('src') || '')?.[1];
      assert.ok(id);
      assert.equal(watched.has(id), false, 'Home watches stay excluded from Clips');
      await page.waitForFunction(() => { const v = document.querySelector('video[data-load-role="active"]'); return v && !v.paused && v.currentTime >= 3; }, null, { timeout: 20000 });
      assert.ok(await Exposure.findOne({ user: viewer._id, post: id }).lean(), 'Clip exposure must persist');
      watched.add(id);
      await page.locator(`[data-clip-index="${index + 1}"]`).scrollIntoViewIfNeeded();
      await page.waitForFunction(old => document.querySelector('video[data-load-role="active"]')?.getAttribute('src')?.includes(old) === false, id);
    }
    await page.screenshot({ path: `${output}.${mobile ? 'mobile' : 'desktop'}-clips.png` });
    for (let refresh = 6; refresh < 12; refresh++) for (const surface of ['feed', 'clips']) await checkNewSession(surface, refresh);
    results.push({ platform: `${mobile ? 'mobile' : 'desktop'}-${process.env.VALIDATION_BROWSER || 'chrome'}`, rankingPolicy: initial.rankingPolicy,
      initialUploadDays: initial.uploadDays, watched: [...watched], exposures, refreshChecks, errors });
    if (externalBrowser) await page.close();
    else await context.close();
  }
  await fs.writeFile(output, JSON.stringify({ catalog: catalog.length, results }, null, 2));
  console.log(JSON.stringify({ catalog: catalog.length, results: results.map(r => ({ platform: r.platform, watched: r.watched.length, freshSessionChecks: r.refreshChecks.length, repeats: 0, errors: r.errors })) }, null, 2));
} finally {
  await browser.close();
  await new Promise(resolve => server.close(resolve));
  await mongoose.disconnect();
  await db.stop();
}
