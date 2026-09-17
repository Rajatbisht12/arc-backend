const crypto = require('crypto');

const PLAN_KEYS = new Set(['player_pro', 'player_pro_plus', 'team_pro', 'team_org']);
const PERIODS = new Set(['monthly', 'quarterly', 'yearly']);
const FREQUENCIES = new Set(['daily', 'weekly', 'monthly']);
const REACH_OPTIONS = new Set([1000, 5000, 10000, 25000, 50000]);

let cachedRaw = null;
let cachedCatalog = null;

const configurationError = (message) => {
  const error = new Error(message);
  error.statusCode = 503;
  error.code = 'APPLE_IAP_NOT_CONFIGURED';
  return error;
};

const nonEmptyString = (value, field) => {
  if (typeof value !== 'string' || !value.trim() || value.length > 255) {
    throw configurationError(`Invalid Apple IAP catalog field: ${field}`);
  }
  return value.trim();
};

const parseCatalog = () => {
  const raw = process.env.APPLE_IAP_PRODUCT_CATALOG_JSON || '';
  if (raw === cachedRaw && cachedCatalog) return cachedCatalog;
  if (!raw) throw configurationError('APPLE_IAP_PRODUCT_CATALOG_JSON is not configured');

  let input;
  try {
    input = JSON.parse(raw);
  } catch (_error) {
    throw configurationError('APPLE_IAP_PRODUCT_CATALOG_JSON must be valid JSON');
  }

  const subscriptions = Array.isArray(input?.subscriptions) ? input.subscriptions : [];
  const boosts = Array.isArray(input?.boosts) ? input.boosts : [];
  const products = new Map();
  const subscriptionBySelection = new Map();
  const boostBySelection = new Map();

  const reserveProduct = (productId, entry) => {
    if (products.has(productId)) throw configurationError(`Duplicate Apple product ID: ${productId}`);
    products.set(productId, Object.freeze(entry));
  };

  subscriptions.forEach((candidate, index) => {
    const productId = nonEmptyString(candidate?.productId, `subscriptions[${index}].productId`);
    const planKey = nonEmptyString(candidate?.planKey, `subscriptions[${index}].planKey`).toLowerCase();
    const billingPeriod = nonEmptyString(candidate?.billingPeriod, `subscriptions[${index}].billingPeriod`).toLowerCase();
    if (!PLAN_KEYS.has(planKey) || !PERIODS.has(billingPeriod)) {
      throw configurationError(`Invalid Apple subscription mapping for ${productId}`);
    }
    const selectionKey = `${planKey}:${billingPeriod}`;
    if (subscriptionBySelection.has(selectionKey)) {
      throw configurationError(`Duplicate Apple subscription selection: ${selectionKey}`);
    }
    const entry = { kind: 'subscription', productId, planKey, billingPeriod };
    reserveProduct(productId, entry);
    subscriptionBySelection.set(selectionKey, entry);
  });

  boosts.forEach((candidate, index) => {
    const productId = nonEmptyString(candidate?.productId, `boosts[${index}].productId`);
    const frequency = nonEmptyString(candidate?.frequency, `boosts[${index}].frequency`).toLowerCase();
    const targetReach = Number(candidate?.targetReach);
    const targetPlayers = candidate?.targetPlayers === true;
    const targetTeams = candidate?.targetTeams === true;
    if (!FREQUENCIES.has(frequency) || !REACH_OPTIONS.has(targetReach) || (!targetPlayers && !targetTeams)) {
      throw configurationError(`Invalid Apple Boost mapping for ${productId}`);
    }
    const selectionKey = `${frequency}:${targetReach}:${targetPlayers ? 1 : 0}:${targetTeams ? 1 : 0}`;
    if (boostBySelection.has(selectionKey)) {
      throw configurationError(`Duplicate Apple Boost selection: ${selectionKey}`);
    }
    const entry = { kind: 'boost', productId, frequency, targetReach, targetPlayers, targetTeams };
    reserveProduct(productId, entry);
    boostBySelection.set(selectionKey, entry);
  });

  cachedRaw = raw;
  cachedCatalog = Object.freeze({ products, subscriptionBySelection, boostBySelection });
  return cachedCatalog;
};

const getProduct = (productId) => parseCatalog().products.get(String(productId || '')) || null;
const getSubscription = (planKey, billingPeriod) => (
  parseCatalog().subscriptionBySelection.get(`${String(planKey || '').toLowerCase()}:${String(billingPeriod || '').toLowerCase()}`) || null
);
const getBoost = ({ frequency, targetReach, targetPlayers, targetTeams }) => (
  parseCatalog().boostBySelection.get(
    `${String(frequency || '').toLowerCase()}:${Number(targetReach)}:${targetPlayers === true ? 1 : 0}:${targetTeams === true ? 1 : 0}`
  ) || null
);

const publicCatalogFor = (accountType) => {
  const expectedPrefix = accountType === 'team' ? 'team_' : 'player_';
  const catalog = parseCatalog();
  return {
    version: crypto.createHash('sha256').update(cachedRaw).digest('hex').slice(0, 16),
    subscriptions: [...catalog.subscriptionBySelection.values()]
      .filter((entry) => entry.planKey.startsWith(expectedPrefix)),
    boosts: [...catalog.boostBySelection.values()]
  };
};

const resetCatalogForTests = () => {
  cachedRaw = null;
  cachedCatalog = null;
};

module.exports = {
  getProduct,
  getSubscription,
  getBoost,
  publicCatalogFor,
  resetCatalogForTests
};
