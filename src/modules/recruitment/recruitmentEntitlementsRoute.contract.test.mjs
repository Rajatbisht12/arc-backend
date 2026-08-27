// Contract: the canonical monthly Recruitment entitlements read endpoint is
// registered on the MODULAR router (the one actually mounted at /api/recruitment
// in production), not only on the legacy JS router. It must be auth-protected and
// resolve to the controller's getRecruitmentEntitlements handler. The enforcement
// (create/apply) already flows through the shared legacy controller handlers.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const routes = await readFile(new URL('./recruitment.routes.ts', import.meta.url), 'utf8');
const controller = await readFile(new URL('../../legacy-src/controllers/recruitmentController.js', import.meta.url), 'utf8');

test('modular router exposes GET /entitlements (auth-protected) → getRecruitmentEntitlements', () => {
  assert.match(routes, /router\.get\("\/entitlements", protect, recruitmentController\.getRecruitmentEntitlements\)/);
});

test('the daily-limit alias stays and points at the (now monthly) player-card handler', () => {
  assert.match(routes, /router\.get\("\/player-profiles\/daily-limit", protect, recruitmentController\.getPlayerCardLimit\)/);
});

test('the controller exports the new entitlements handler', () => {
  assert.match(controller, /getRecruitmentEntitlements,/);
  assert.match(controller, /const getRecruitmentEntitlements = safeAsyncHandler/);
});

test('creation handlers reserve monthly slots (enforcement is server-side, not client)', () => {
  assert.match(controller, /reservePlayerCard\(\{ userId: playerId \}\)/);
  assert.match(controller, /reserveApplication\(\{ userId: applicantId \}\)/);
  assert.match(controller, /reserveTeamRecruitment\(\{ teamId \}\)/);
});
