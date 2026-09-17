const assert = require('node:assert/strict');

const catalog = require('./appleIapCatalog');

const originalCatalog = process.env.APPLE_IAP_PRODUCT_CATALOG_JSON;
const configure = (value) => {
  if (value === undefined) delete process.env.APPLE_IAP_PRODUCT_CATALOG_JSON;
  else process.env.APPLE_IAP_PRODUCT_CATALOG_JSON = JSON.stringify(value);
  catalog.resetCatalogForTests();
};

try {
  configure({
    subscriptions: [
      { productId: 'test.premium.player.monthly', planKey: 'player_pro', billingPeriod: 'monthly' },
      { productId: 'test.premium.team.yearly', planKey: 'team_pro', billingPeriod: 'yearly' },
    ],
    boosts: [
      {
        productId: 'test.boost.players.5000.weekly',
        frequency: 'weekly',
        targetReach: 5000,
        targetPlayers: true,
        targetTeams: false,
      },
    ],
  });

  assert.deepEqual(catalog.getSubscription('player_pro', 'monthly'), {
    kind: 'subscription',
    productId: 'test.premium.player.monthly',
    planKey: 'player_pro',
    billingPeriod: 'monthly',
  });
  assert.equal(catalog.getProduct('test.premium.team.yearly').kind, 'subscription');
  assert.equal(catalog.getBoost({
    frequency: 'weekly',
    targetReach: 5000,
    targetPlayers: true,
    targetTeams: false,
  }).productId, 'test.boost.players.5000.weekly');
  assert.deepEqual(
    catalog.publicCatalogFor('player').subscriptions.map((entry) => entry.productId),
    ['test.premium.player.monthly'],
    'players must not receive Team subscription product mappings',
  );
  assert.deepEqual(
    catalog.publicCatalogFor('team').subscriptions.map((entry) => entry.productId),
    ['test.premium.team.yearly'],
    'teams must not receive Player subscription product mappings',
  );

  configure({
    subscriptions: [
      { productId: 'test.duplicate', planKey: 'player_pro', billingPeriod: 'monthly' },
    ],
    boosts: [
      {
        productId: 'test.duplicate',
        frequency: 'daily',
        targetReach: 1000,
        targetPlayers: true,
        targetTeams: false,
      },
    ],
  });
  assert.throws(() => catalog.publicCatalogFor('player'), /Duplicate Apple product ID/);

  configure({
    subscriptions: [],
    boosts: [{
      productId: 'test.invalid.boost',
      frequency: 'daily',
      targetReach: 1000,
      targetPlayers: false,
      targetTeams: false,
    }],
  });
  assert.throws(() => catalog.getProduct('test.invalid.boost'), /Invalid Apple Boost mapping/);

  configure(undefined);
  assert.throws(
    () => catalog.publicCatalogFor('player'),
    (error) => error.code === 'APPLE_IAP_NOT_CONFIGURED' && error.statusCode === 503,
  );

  console.log('Apple IAP catalog tests passed');
} finally {
  if (originalCatalog === undefined) delete process.env.APPLE_IAP_PRODUCT_CATALOG_JSON;
  else process.env.APPLE_IAP_PRODUCT_CATALOG_JSON = originalCatalog;
  catalog.resetCatalogForTests();
}
