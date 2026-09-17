#!/usr/bin/env node
require('dotenv').config();
const fs = require('node:fs');
const catalog = require('../src/legacy-src/services/appleIapCatalog');

const release = process.argv.includes('--release');
const errors = [];
const periods = ['monthly', 'quarterly', 'yearly'];
const requiredPlans = ['player_pro', 'team_pro'];
const frequencies = ['daily', 'weekly', 'monthly'];
const reaches = [1000, 5000, 10000, 25000, 50000];
const audiences = [
  { targetPlayers: true, targetTeams: false },
  { targetPlayers: false, targetTeams: true },
  { targetPlayers: true, targetTeams: true },
];

const required = (name) => {
  const value = String(process.env[name] || '').trim();
  if (!value) errors.push(`${name} is required`);
  return value;
};

try {
  for (const planKey of requiredPlans) {
    for (const period of periods) {
      if (!catalog.getSubscription(planKey, period)) {
        errors.push(`missing subscription mapping ${planKey}:${period}`);
      }
    }
  }
  for (const frequency of frequencies) {
    for (const targetReach of reaches) {
      for (const audience of audiences) {
        if (!catalog.getBoost({ frequency, targetReach, ...audience })) {
          errors.push(
            `missing Boost mapping ${frequency}:${targetReach}:${audience.targetPlayers ? 1 : 0}:${audience.targetTeams ? 1 : 0}`,
          );
        }
      }
    }
  }
} catch (error) {
  errors.push(error?.message || String(error));
}

if (release) {
  const bundleId = required('APPLE_IAP_BUNDLE_ID');
  if (bundleId && bundleId !== 'com.arcSquadHunt') {
    errors.push(`APPLE_IAP_BUNDLE_ID must match the current Expo bundle identifier com.arcSquadHunt (received ${bundleId})`);
  }
  const appAppleId = required('APPLE_IAP_APPLE_ID');
  if (appAppleId && (!/^\d+$/.test(appAppleId) || Number(appAppleId) <= 0)) {
    errors.push('APPLE_IAP_APPLE_ID must be the numeric App Store Connect app ID');
  }
  required('APPLE_IAP_ISSUER_ID');
  required('APPLE_IAP_KEY_ID');
  if (!String(process.env.APPLE_IAP_PRIVATE_KEY_PATH || '').trim()
    && !String(process.env.APPLE_IAP_PRIVATE_KEY_BASE64 || '').trim()) {
    errors.push('APPLE_IAP_PRIVATE_KEY_PATH or APPLE_IAP_PRIVATE_KEY_BASE64 is required');
  }
  const roots = required('APPLE_IAP_ROOT_CA_PATHS')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);
  for (const root of roots) {
    if (!fs.existsSync(root)) errors.push(`Apple root certificate is not readable: ${root}`);
  }
  if (String(process.env.APPLE_IAP_REQUIRE_SERVER_API || '').toLowerCase() !== 'true') {
    errors.push('APPLE_IAP_REQUIRE_SERVER_API must be true for release');
  }
  if (String(process.env.APPLE_IAP_ONLINE_CHECKS || '').toLowerCase() !== 'true') {
    errors.push('APPLE_IAP_ONLINE_CHECKS must be true for release');
  }
  let parsed;
  try { parsed = JSON.parse(process.env.APPLE_IAP_PRODUCT_CATALOG_JSON || '{}'); } catch (_error) { parsed = {}; }
  const productIds = [...(parsed.subscriptions || []), ...(parsed.boosts || [])]
    .map((entry) => String(entry.productId || ''));
  if (productIds.some((id) => /(?:example|placeholder|\btbd\b)/i.test(id))) {
    errors.push('release catalog contains a placeholder product ID');
  }
}

if (errors.length) {
  console.error(`Apple IAP configuration failed (${errors.length} issue${errors.length === 1 ? '' : 's'}):`);
  for (const error of errors) console.error(`- ${error}`);
  process.exit(1);
}

console.log(`Apple IAP configuration is complete for 6 subscription products and 45 Boost consumables${release ? ' (release credentials checked)' : ''}.`);
