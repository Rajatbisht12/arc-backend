// Requires an already installed/logged-in side-by-side QA app and the loopback
// discovery-validation-fixture server. Never signs out or clears the real app.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs/promises';
const origin = process.env.VALIDATION_ORIGIN || 'http://127.0.0.1:7312';
assert.equal(new URL(origin).hostname, '127.0.0.1');
const output = process.argv[2];
if (!output) throw new Error('Provide an output JSON path');
const adb = (...args) => execFileSync('adb', args, { encoding: 'utf8', timeout: 20000 });
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
const state = async () => (await fetch(`${origin}/__validation__/state`)).json();
const checks = [];
const bounds = text => [...text.matchAll(/\d+/g)].map(m => Number(m[0]));
function layout() {
  adb('shell', 'uiautomator', 'dump', '/sdcard/squadhunt-qa.xml');
  const xml = adb('shell', 'cat', '/sdcard/squadhunt-qa.xml');
  assert.ok(xml.includes('package="com.arcSquadHunt.recommendationqa"'), 'QA app must be unlocked and foreground');
  return [...xml.matchAll(/<node\s+([^>]+)>?/g)].map(match => Object.fromEntries([...match[1].matchAll(/([\w-]+)="([^"]*)"/g)].map(m => [m[1], m[2]])));
}
function tab(name) {
  const node = layout().find(n => n['content-desc'] === name && n.clickable === 'true');
  assert.ok(node, `${name} tab is present`);
  const [x1, y1, x2, y2] = bounds(node.bounds);
  adb('shell', 'input', 'tap', String((x1 + x2) >> 1), String((y1 + y2) >> 1));
}
function swipe() {
  const node = layout().find(n => n.scrollable === 'true' && n.class === 'android.widget.ScrollView');
  assert.ok(node, 'Home scroll view is present');
  const [x1, y1, x2, y2] = bounds(node.bounds);
  const x = String((x1 + x2) >> 1), height = y2 - y1;
  adb('shell', 'input', 'swipe', x, String(Math.round(y1 + height * .8)), x, String(Math.round(y1 + height * .3)), '650');
}
async function until(predicate, label, timeout = 20000) {
  const end = Date.now() + timeout;
  do { const current = await state(); if (predicate(current)) return current; await wait(250); } while (Date.now() < end);
  throw new Error(`Timed out: ${label}`);
}
async function verifyResponse(label, requestStart, prior) {
  const current = await until(s => s.requests.length > requestStart, label);
  const responses = current.requests.slice(requestStart).filter(r => !r.cursor && r.ids.length);
  assert.ok(responses.length, `new initial response: ${label}`);
  for (const r of responses) {
    assert.equal(r.rankingPolicy, 'unseen-only-45d-v1');
    const repeats = r.ids.filter(id => prior.has(id));
    assert.deepEqual(repeats, [], label);
    checks.push({ label, previouslyViewed: [...prior], returned: r.ids, repeats });
  }
  return current;
}
for (let cycle = 0; cycle < 3; cycle++) {
  const before = await state(), initial = new Set(before.persisted.map(r => r.id));
  for (let step = 0; step < 45; step++) {
    const current = await state();
    const added = current.persisted.filter(r => !initial.has(r.id));
    if (added.length >= 10) break;
    await wait(1800); swipe();
    if (step === 44) throw new Error('Could not qualify ten distinct Home posts');
  }
  const viewed = await state();
  const prior = new Set(viewed.persisted.map(r => r.id));
  assert.ok(viewed.persisted.every(r => r.canonical), 'canonical user:post identities persisted');
  tab('Home');
  await verifyResponse(`Home refresh cycle ${cycle + 1}`, viewed.requests.length, prior);
  console.log(JSON.stringify({ cycle: cycle + 1, totalPersisted: prior.size, repeats: 0 }));
}
const beforeClips = await state(), prior = new Set(beforeClips.persisted.map(r => r.id));
tab('Clips');
await verifyResponse('Home to Clips', beforeClips.requests.length, prior);
for (let step = 0; step < 10; step++) {
  await wait(2400);
  const nodes = layout();
  const scroll = nodes.find(n => n.scrollable === 'true' && n.class !== 'android.widget.HorizontalScrollView');
  assert.ok(scroll, 'Clips list is scrollable');
  const [x1, y1, x2, y2] = bounds(scroll.bounds), x = String((x1 + x2) >> 1);
  adb('shell', 'input', 'swipe', x, String(Math.round(y1 + (y2 - y1) * .8)), x, String(Math.round(y1 + (y2 - y1) * .2)), '550');
}
const watched = await state();
assert.ok(watched.exposures.filter(e => e.context === 'clips' && e.status === 200).length >= 10, 'ten actual Clips exposures acknowledged');
tab('Home'); await wait(500); tab('Home');
await verifyResponse('Clips to Home', watched.requests.length, new Set(watched.persisted.map(r => r.id)));
const beforeRestart = await state();
adb('shell', 'am', 'force-stop', 'com.arcSquadHunt.recommendationqa');
adb('shell', 'am', 'start', '-W', '-n', 'com.arcSquadHunt.recommendationqa/com.arcSquadHunt.MainActivity');
await verifyResponse('QA app restart', beforeRestart.requests.length, new Set(beforeRestart.persisted.map(r => r.id)));
const final = await state();
await fs.writeFile(output, JSON.stringify({ platform: 'Samsung SM-S928B native Android QA', checks, ...final }, null, 2));
console.log(JSON.stringify({ checks: checks.length, persisted: final.persisted.length, repeats: 0 }));
