const fs = require('fs');
const { AppStoreServerAPIClient, Environment } = require('@apple/app-store-server-library');
const verifier = require('./appleSignedDataVerifier');

let cachedKey = '';
let cachedClients = null;

const fail = (message, statusCode = 503, code = 'APPLE_SERVER_API_UNAVAILABLE') => {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.code = code;
  return error;
};

const loadPrivateKey = () => {
  const encoded = String(process.env.APPLE_IAP_PRIVATE_KEY_BASE64 || '').trim();
  if (encoded) {
    try { return Buffer.from(encoded, 'base64').toString('utf8'); } catch (_error) { return ''; }
  }
  const path = String(process.env.APPLE_IAP_PRIVATE_KEY_PATH || '').trim();
  if (!path) return '';
  try { return fs.readFileSync(path, 'utf8'); } catch (_error) { return ''; }
};

const getClients = () => {
  const keyId = String(process.env.APPLE_IAP_KEY_ID || '').trim();
  const issuerId = String(process.env.APPLE_IAP_ISSUER_ID || '').trim();
  const bundleId = String(process.env.APPLE_IAP_BUNDLE_ID || '').trim();
  const privateKey = loadPrivateKey();
  const cacheKey = `${keyId}:${issuerId}:${bundleId}:${privateKey.length}`;
  if (cachedClients && cachedKey === cacheKey) return cachedClients;
  if (!keyId || !issuerId || !bundleId || !privateKey) return null;
  cachedClients = {
    production: new AppStoreServerAPIClient(privateKey, keyId, issuerId, bundleId, Environment.PRODUCTION),
    sandbox: new AppStoreServerAPIClient(privateKey, keyId, issuerId, bundleId, Environment.SANDBOX)
  };
  cachedKey = cacheKey;
  return cachedClients;
};

const serverApiRequired = () => {
  const configured = String(process.env.APPLE_IAP_REQUIRE_SERVER_API || '').trim().toLowerCase();
  if (configured) return configured === 'true';
  return process.env.NODE_ENV === 'production';
};

const getCurrentTransaction = async (transaction) => {
  const clients = getClients();
  if (!clients) {
    if (serverApiRequired()) throw fail('Apple App Store Server API credentials are not configured');
    return transaction;
  }
  const environment = String(transaction?.environment || '').toLowerCase();
  const client = environment === 'sandbox' || environment === 'xcode' ? clients.sandbox : clients.production;
  try {
    const response = await client.getTransactionInfo(String(transaction.transactionId));
    if (!response?.signedTransactionInfo) throw new Error('Missing signed transaction');
    const current = await verifier.verifyTransaction(response.signedTransactionInfo, transaction.environment);
    if (
      String(current.transactionId || '') !== String(transaction.transactionId || '')
      || String(current.productId || '') !== String(transaction.productId || '')
    ) {
      throw fail('Apple transaction reconciliation did not match the submitted transaction', 409, 'APPLE_TRANSACTION_RECONCILIATION_MISMATCH');
    }
    return current;
  } catch (error) {
    if (error?.code === 'APPLE_TRANSACTION_RECONCILIATION_MISMATCH') throw error;
    throw fail('Apple transaction could not be reconciled with the App Store', 503, 'APPLE_TRANSACTION_RECONCILIATION_FAILED');
  }
};

const resetForTests = () => {
  cachedKey = '';
  cachedClients = null;
};

module.exports = { getCurrentTransaction, resetForTests };
