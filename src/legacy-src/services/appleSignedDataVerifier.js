const fs = require('fs');
const {
  Environment,
  SignedDataVerifier
} = require('@apple/app-store-server-library');

let verifierOverride = null;
let cachedKey = '';
let cachedVerifiers = null;

const fail = (message, statusCode = 503, code = 'APPLE_IAP_VERIFIER_UNAVAILABLE') => {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.code = code;
  return error;
};

const loadRootCertificates = () => {
  const paths = String(process.env.APPLE_IAP_ROOT_CA_PATHS || '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);
  if (!paths.length) throw fail('Apple root certificate paths are not configured');
  try {
    return paths.map((path) => fs.readFileSync(path));
  } catch (_error) {
    throw fail('Apple root certificates could not be loaded');
  }
};

const getVerifiers = () => {
  if (verifierOverride) return verifierOverride;
  const bundleId = String(process.env.APPLE_IAP_BUNDLE_ID || '').trim();
  const appAppleId = Number(process.env.APPLE_IAP_APPLE_ID);
  const onlineChecks = String(process.env.APPLE_IAP_ONLINE_CHECKS || 'true').toLowerCase() !== 'false';
  const key = `${bundleId}:${appAppleId || ''}:${process.env.APPLE_IAP_ROOT_CA_PATHS || ''}:${onlineChecks}`;
  if (cachedVerifiers && cachedKey === key) return cachedVerifiers;
  if (!bundleId) throw fail('APPLE_IAP_BUNDLE_ID is not configured');
  if (!Number.isSafeInteger(appAppleId) || appAppleId <= 0) {
    throw fail('APPLE_IAP_APPLE_ID must be the numeric App Store Connect app ID');
  }
  const roots = loadRootCertificates();
  cachedVerifiers = {
    production: new SignedDataVerifier(roots, onlineChecks, Environment.PRODUCTION, bundleId, appAppleId),
    sandbox: new SignedDataVerifier(roots, onlineChecks, Environment.SANDBOX, bundleId),
    xcode: new SignedDataVerifier(roots, false, Environment.XCODE, bundleId)
  };
  cachedKey = key;
  return cachedVerifiers;
};

const tryAll = async (method, signedData, environmentHint) => {
  if (typeof signedData !== 'string' || signedData.length < 100 || signedData.length > 200000) {
    throw fail('Apple signed data is invalid', 400, 'INVALID_APPLE_SIGNED_DATA');
  }
  const verifiers = getVerifiers();
  if (verifiers.verifyTransaction || verifiers.verifyNotification) {
    const overrideMethod = method === 'verifyAndDecodeTransaction'
      ? verifiers.verifyTransaction
      : method === 'verifyAndDecodeNotification'
        ? verifiers.verifyNotification
        : verifiers.verifyRenewal;
    return overrideMethod(signedData, environmentHint);
  }
  const normalizedHint = String(environmentHint || '').toLowerCase();
  const order = normalizedHint.includes('sandbox')
    ? [verifiers.sandbox, verifiers.production, verifiers.xcode]
    : normalizedHint.includes('xcode')
      ? [verifiers.xcode, verifiers.sandbox, verifiers.production]
      : [verifiers.production, verifiers.sandbox, verifiers.xcode];
  let lastError;
  for (const verifier of order) {
    try {
      return await verifier[method](signedData);
    } catch (error) {
      lastError = error;
    }
  }
  const error = fail('Apple could not verify this transaction', 400, 'APPLE_TRANSACTION_VERIFICATION_FAILED');
  error.cause = lastError;
  throw error;
};

const verifyTransaction = (signedData, environmentHint) => tryAll('verifyAndDecodeTransaction', signedData, environmentHint);
const verifyNotification = (signedData, environmentHint) => tryAll('verifyAndDecodeNotification', signedData, environmentHint);
const verifyRenewal = (signedData, environmentHint) => tryAll('verifyAndDecodeRenewalInfo', signedData, environmentHint);

const setVerifierForTests = (override) => { verifierOverride = override; };
const resetVerifierForTests = () => {
  verifierOverride = null;
  cachedKey = '';
  cachedVerifiers = null;
};

module.exports = {
  verifyTransaction,
  verifyNotification,
  verifyRenewal,
  setVerifierForTests,
  resetVerifierForTests
};
