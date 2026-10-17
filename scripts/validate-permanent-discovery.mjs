// Browser UI -> actual controllers -> persistent fixture DB, three real reload
// cycles of ten mixed posts, then Clips and cross-browser account checks.
import { pathToFileURL } from 'node:url';
import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import { createDiscoveryValidationFixture } from './discovery-validation-fixture.mjs';
const [buildDir, mediaDir, output] = process.argv.slice(2);
if (!output) throw new Error('Provide <web-dist> <media-dir> <output.json>');
const { chromium, webkit } = await import(process.env.SQUADHUNT_PLAYWRIGHT_MODULE ? pathToFileURL(process.env.SQUADHUNT_PLAYWRIGHT_MODULE).href : 'playwright');
const fixture = await createDiscoveryValidationFixture({ buildDir, mediaDir, port: Number(process.env.VALIDATION_PORT || 0) });
const external = Boolean(process.env.VALIDATION_CDP);
const engine = process.env.VALIDATION_BROWSER === 'webkit' ? webkit : chromium;
const browser = external ? await chromium.connectOverCDP(process.env.VALIDATION_CDP) : await engine.launch(engine === chromium ? { channel: 'chrome' } : {});
const results = [];
try {
  for (const mobile of external ? [true] : [false, true]) {
    await fixture.reset();
    const context = external ? browser.contexts()[0] : await browser.newContext({ viewport: mobile ? { width: 390, height: 844 } : { width: 1440, height: 900 }, isMobile: mobile });
    const page = await context.newPage(); const errors = []; page.on('pageerror', e => errors.push(e.message));
    await page.route('**/*', route => new URL(route.request().url()).origin === fixture.origin ? route.continue() : route.abort());
    await page.addInitScript(({ origin, token }) => { if (location.origin === origin) localStorage.setItem('token', token); }, { origin: fixture.origin, token: fixture.token });
    const consumed = new Set(); const checks = [];
    const check = async (surface, cycle) => {
      const response = await context.request.get(`${fixture.origin}/api/posts${surface === 'clips' ? '/clips' : ''}?limit=10&sessionSeed=validation-${mobile}-${surface}-${cycle}`, { headers: { Authorization: `Bearer ${fixture.token}` } });
      const data = (await response.json()).data;
      assert.equal(response.status(), 200); assert.equal(data.recommendation.rankingPolicy, 'unseen-only-45d-v1');
      const ids = data.posts.map(p => String(p._id)); const repeats = ids.filter(id => consumed.has(id));
      assert.deepEqual(repeats, []); checks.push({ surface, cycle, previouslyViewed: [...consumed], returned: ids, repeats });
    };
    for (let cycle = 0; cycle < 3; cycle++) {
      const before = fixture.requests.length;
      await page.goto(fixture.origin);
      await page.locator('[data-feed-post-id]').first().waitFor();
      const ids = fixture.requests.slice(before).find(r => r.route === '/api/posts' && r.ids.length)?.ids;
      assert.equal(ids?.length, 10); assert.ok(ids.every(id => !consumed.has(id)));
      for (const id of ids) {
        const card = page.locator(`[data-feed-post-id="${id}"]`);
        const ack = () => fixture.exposures.some(e => e.id === id && e.status === 200);
        // Listen before scrolling so an immediate already-running timer cannot
        // race the network assertion. Verify the actual acknowledged response.
        const acknowledged = ack() ? Promise.resolve() : page.waitForResponse(r => r.url().endsWith(`/api/posts/${id}/exposure`) && r.status() === 200, { timeout: 20000 });
        await card.scrollIntoViewIfNeeded();
        await acknowledged;
        assert.ok(ack(), JSON.stringify({ id, exposures: fixture.exposures })); assert.ok(await fixture.Exposure.findOne({ user: fixture.viewer._id, post: id }).lean()); consumed.add(id);
      }
      await check('feed', cycle); await check('clips', cycle);
      await page.screenshot({ path: `${output}.${mobile ? 'mobile' : 'desktop'}-cycle-${cycle}.png` });
      await page.reload();
      await page.locator('[data-feed-post-id]').first().waitFor();
      assert.ok(fixture.requests.at(-1).ids.every(id => !consumed.has(id)));
    }
    await page.goto(`${fixture.origin}/clips`);
    for (let index = 0; index < 10; index++) {
      const video = page.locator('video[data-load-role="active"]'); await video.waitFor();
      const id = /video-([a-f\d]{24})\.mp4/.exec(await video.getAttribute('src') || '')?.[1]; assert.ok(id); assert.equal(consumed.has(id), false);
      await page.waitForFunction(() => { const v = document.querySelector('video[data-load-role="active"]'); return v && !v.paused && v.currentTime >= 3; }, null, { timeout: 20000 });
      assert.ok(await fixture.Exposure.findOne({ user: fixture.viewer._id, post: id }).lean()); consumed.add(id);
      await page.locator(`[data-clip-index="${index + 1}"]`).scrollIntoViewIfNeeded();
      await page.waitForFunction(old => !document.querySelector('video[data-load-role="active"]')?.getAttribute('src')?.includes(old), id);
    }
    for (let cycle = 3; cycle < 6; cycle++) { await check('feed', cycle); await check('clips', cycle); }
    // New browser storage/context, same server account: no local history hints.
    if (!external) {
      const second = await browser.newContext();
      const response = await second.request.get(`${fixture.origin}/api/posts?sessionSeed=new-device-${mobile}`, { headers: { Authorization: `Bearer ${fixture.token}` } });
      const ids = (await response.json()).data.posts.map(p => p._id); assert.ok(ids.every(id => !consumed.has(id))); await second.close();
    }
    results.push({ platform: `${external ? 'physical-android' : mobile ? 'mobile' : 'desktop'}-${process.env.VALIDATION_BROWSER || 'chrome'}`, consumed: [...consumed], checks, errors });
    if (external) await page.close(); else await context.close();
  }
  await fs.writeFile(output, JSON.stringify({ catalog: fixture.catalog.length, results }, null, 2));
  console.log(JSON.stringify(results.map(r => ({ platform: r.platform, consumed: r.consumed.length, cycles: 3, responseChecks: r.checks.length, repeats: 0, errors: r.errors })), null, 2));
} finally { await browser.close(); await fixture.stop(); }
