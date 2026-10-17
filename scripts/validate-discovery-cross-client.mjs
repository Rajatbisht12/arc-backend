// Fresh Web storage against the same disposable database/account used by native
// QA. Proxies only loopback traffic; never contacts production or clears history.
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
const require = createRequire(import.meta.url), express = require('express');
const [buildDir, output] = process.argv.slice(2);
if (!output) throw new Error('Provide <web-dist> <output.json>');
const upstream = 'http://127.0.0.1:7312';
const before = await (await fetch(`${upstream}/__validation__/state`)).json();
assert.ok(before.persisted.length >= 40, 'run native qualification first');
const auth = await (await fetch(`${upstream}/api/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: 'discoveryviewer', password: 'fixture-password' }) })).json();
const app = express(); app.use(express.json());
app.use('/api', async (req, res) => {
  const result = await fetch(`${upstream}${req.originalUrl}`, { method: req.method,
    headers: { Authorization: req.headers.authorization || '', 'content-type': 'application/json' },
    ...(['GET', 'HEAD'].includes(req.method) ? {} : { body: JSON.stringify(req.body) }) });
  res.status(result.status).type('json').send(await result.text());
});
app.get('/__fixture__/*', async (req, res) => { const result = await fetch(`${upstream}${req.originalUrl}`); res.type(result.headers.get('content-type')).send(Buffer.from(await result.arrayBuffer())); });
app.use(express.static(path.resolve(buildDir), { index: false }));
app.get('*', async (_req, res) => res.type('html').send((await fs.readFile(path.resolve(buildDir, 'index.html'), 'utf8')).replace(/<meta http-equiv="Content-Security-Policy" content="upgrade-insecure-requests"\s*\/>/, '')));
const server = await new Promise(resolve => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
const origin = `http://127.0.0.1:${server.address().port}`;
const { chromium } = await import(pathToFileURL(process.env.SQUADHUNT_PLAYWRIGHT_MODULE).href);
const browser = await chromium.launch({ channel: 'chrome' });
try {
  const page = await browser.newPage();
  await page.route('**/*', route => [origin, upstream].includes(new URL(route.request().url()).origin) ? route.continue() : route.abort());
  await page.addInitScript(({ token }) => localStorage.setItem('token', token), { token: auth.data.token });
  const response = page.waitForResponse(r => r.url().includes('/api/posts?') && r.status() === 200);
  await page.goto(origin);
  const posts = (await (await response).json()).data.posts;
  const prior = new Set(before.persisted.map(r => r.id));
  assert.ok(posts.length && posts.every(p => !prior.has(p._id)));
  const id = posts[0]._id, card = page.locator(`[data-feed-post-id="${id}"]`);
  const ack = page.waitForResponse(r => r.url().endsWith(`/api/posts/${id}/exposure`) && r.status() === 200);
  await card.scrollIntoViewIfNeeded(); await ack;
  const persisted = await (await fetch(`${upstream}/__validation__/state`)).json();
  assert.ok(persisted.persisted.some(r => r.id === id && r.canonical));
  const result = await (await fetch(`${upstream}/api/posts?sessionSeed=new-native-client`, { headers: { Authorization: `Bearer ${auth.data.token}` } })).json();
  const returned = result.data.posts.map(p => p._id);
  assert.ok(!returned.includes(id), 'Web exposure is excluded by a fresh native-compatible request');
  await fs.writeFile(output, JSON.stringify({ previouslyViewedNative: [...prior], returnedWeb: posts.map(p => p._id), webViewed: id, returnedNewNative: returned, repeats: [] }, null, 2));
  console.log(JSON.stringify({ nativeExposures: prior.size, webReturned: posts.length, newNativeReturned: returned.length, repeats: 0 }));
} finally { await browser.close(); await new Promise(resolve => server.close(resolve)); }
