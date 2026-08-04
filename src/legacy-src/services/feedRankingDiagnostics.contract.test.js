const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const source = readFileSync(path.join(__dirname, 'recommendationService.js'), 'utf8');

test('per-post ranking diagnostics are attached but development-gated', () => {
  // Never emitted in production (keeps internal scoring private).
  assert.match(source, /includeRankingDebug = process\.env\.NODE_ENV !== 'production'/);
  assert.match(source, /if \(includeRankingDebug\) \{/);
  // The Phase 4 feed-contract fields are present on the debug block.
  for (const field of [
    'position',
    'rankingScore',
    'isBoosted',
    'boostWeight',
    'isPreviouslySeen',
    'seenPenalty',
    'freshness',
    'newPostKicker',
    'createdAt',
    'rankingReason',
  ]) {
    assert.match(source, new RegExp(`${field}[,:]`), `debug block must expose ${field}`);
  }
  assert.match(source, /dto\._ranking = \{/);
});

test('a per-request ranking summary is logged (returned IDs, seed, boosted/seen counts)', () => {
  assert.match(source, /log\.info\('feed-ranking', \{/);
  for (const field of ['sessionSeed', 'cursor', 'nextCursor', 'boostedCount', 'seenCount', 'returnedIds']) {
    assert.match(source, new RegExp(`${field}[,:]`), `log summary must include ${field}`);
  }
});

test('the existing anti-repetition guarantees are still in place (unchanged)', () => {
  // A shown post is penalised next session; boosts damp to zero after per-user
  // delivery; the session seed rotates ordering. These are the mechanisms that
  // prevent a boosted post from being permanently pinned.
  assert.match(source, /const seenPenalty = getSeenPenalty\(/);
  assert.match(source, /const boostScore = getDampedBoostScore\(/);
  assert.match(source, /function applyBoostPlacement/);
  assert.match(source, /const seed = `\$\{relationship\.currentUserId \|\| 'guest'\}:\$\{mode\}:\$\{sessionSeed\}`/);
});
