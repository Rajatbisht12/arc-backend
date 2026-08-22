const assert = require('node:assert/strict');
const test = require('node:test');

const {
  ClashRoyaleAPI,
  CLASH_ROYALE_API_BASE_URL,
  normalizeApiToken,
  normalizePlayerTag
} = require('./clashRoyaleAPI');

test('uses the official API with an encoded player tag and server token', async () => {
  let captured;
  const api = new ClashRoyaleAPI({
    env: { CLASH_ROYALE_API_TOKEN: '  Bearer server-secret  ' },
    httpClient: {
      get: async (url, config) => {
        captured = { url, config };
        return { data: { tag: '#ABC123DEF', name: 'Player' } };
      }
    }
  });

  const result = await api.getPlayer('  #abc123def ');

  assert.equal(result.success, true);
  assert.equal(captured.url, `${CLASH_ROYALE_API_BASE_URL}/players/%23ABC123DEF`);
  assert.equal(captured.config.headers.Authorization, 'Bearer server-secret');
  assert.equal(captured.config.headers.Accept, 'application/json');
  assert.equal(captured.config.timeout, 12000);
});

test('supports the legacy KEY environment name without exposing it to the client', async () => {
  let authorization;
  const api = new ClashRoyaleAPI({
    env: { CLASH_ROYALE_API_KEY: 'legacy-server-secret' },
    httpClient: {
      get: async (_url, config) => {
        authorization = config.headers.Authorization;
        return { data: {} };
      }
    }
  });

  await api.getCards();
  assert.equal(authorization, 'Bearer legacy-server-secret');
});

test('does not call upstream when the server token is missing', async () => {
  let requested = false;
  const api = new ClashRoyaleAPI({
    env: {},
    httpClient: { get: async () => { requested = true; } }
  });

  const result = await api.getPlayer('#ABC123DEF');

  assert.equal(requested, false);
  assert.deepEqual(result, {
    success: false,
    error: 'Clash Royale sync is temporarily unavailable.',
    code: 'CLASH_ROYALE_NOT_CONFIGURED',
    statusCode: 503
  });
});

test('maps an allowlist or credential rejection to a server configuration error', async () => {
  const api = new ClashRoyaleAPI({
    env: { CLASH_ROYALE_API_TOKEN: 'server-secret' },
    httpClient: {
      get: async () => {
        const error = new Error('Forbidden');
        error.response = { status: 403, data: { reason: 'accessDenied.invalidIp' } };
        throw error;
      }
    }
  });

  const result = await api.getPlayer('#ABC123DEF');

  assert.equal(result.success, false);
  assert.equal(result.code, 'CLASH_ROYALE_AUTH_FAILED');
  assert.equal(result.statusCode, 503);
  assert.doesNotMatch(result.error, /check your api key/i);
});

test('keeps an unknown player tag as a player-facing 404', async () => {
  const api = new ClashRoyaleAPI({
    env: { CLASH_ROYALE_API_TOKEN: 'server-secret' },
    httpClient: {
      get: async () => {
        const error = new Error('Not found');
        error.response = { status: 404 };
        throw error;
      }
    }
  });

  const result = await api.getPlayer('#ABC123DEF');
  assert.equal(result.code, 'PLAYER_NOT_FOUND');
  assert.equal(result.statusCode, 404);
});

test('normalizes token and tag input without accepting malformed tags', () => {
  assert.equal(normalizeApiToken(' Bearer abc.def.ghi '), 'abc.def.ghi');
  assert.equal(normalizePlayerTag(' #abc123def '), '#ABC123DEF');
  assert.equal(normalizePlayerTag('##abc123def'), '#ABC123DEF');
  assert.equal(normalizePlayerTag('bad/tag'), null);
  assert.equal(normalizePlayerTag('a'), null);
});
