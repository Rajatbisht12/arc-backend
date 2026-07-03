const CryptoJS = require('crypto-js');

// Sync this flag with frontend to enable/disable easily for debugging
const ENCRYPTION_ENABLED = process.env.ENABLE_PAYLOAD_ENCRYPTION === 'true';
const ENCRYPTION_KEY = process.env.ENCRYPTION_KEY;

if (ENCRYPTION_ENABLED && (!ENCRYPTION_KEY || ENCRYPTION_KEY.length < 32)) {
    throw new Error('ENABLE_PAYLOAD_ENCRYPTION requires ENCRYPTION_KEY with at least 32 characters');
}

const encrypt = (data) => {
    try {
        if (!ENCRYPTION_KEY) throw new Error('ENCRYPTION_KEY is not configured');
        const jsonString = JSON.stringify(data);
        return CryptoJS.AES.encrypt(jsonString, ENCRYPTION_KEY).toString();
    } catch (e) {
        console.error('Encryption failed:', e);
        return null;
    }
};

const decrypt = (ciphertext) => {
    try {
        if (!ENCRYPTION_KEY) throw new Error('ENCRYPTION_KEY is not configured');
        const bytes = CryptoJS.AES.decrypt(ciphertext, ENCRYPTION_KEY);
        const decryptedStr = bytes.toString(CryptoJS.enc.Utf8);
        return decryptedStr ? JSON.parse(decryptedStr) : null;
    } catch (e) {
        console.error('Decryption failed, falling back to original');
        return null;
    }
};

const encryptionMiddleware = (req, res, next) => {
    // If disabled, just pass through
    if (!ENCRYPTION_ENABLED) return next();

    // Skip intercepting multipart forms (image uploads) as they can't be strictly payload encrypted this easily
    if (req.path.includes('/upload') || (req.headers['content-type'] && req.headers['content-type'].includes('multipart/form-data'))) {
        return next();
    }

    // 1. Decrypt incoming Request Body
    if (req.body && typeof req.body.payload === 'string') {
        const decryptedBody = decrypt(req.body.payload);
        if (decryptedBody) {
            req.body = decryptedBody;
        }
    }

    // 2. Intercept outgoing Response
    const originalJson = res.json;
    res.json = function (data) {
        // Avoid double encrypting and don't encrypt error stack traces if we're sending standard format
        if (data && !data._isEncrypted) {
           const encryptedPayload = encrypt(data);
           if (encryptedPayload) {
               return originalJson.call(this, { payload: encryptedPayload, _isEncrypted: true });
           }
        }
        return originalJson.call(this, data);
    };

    next();
};

module.exports = {
    encrypt,
    decrypt,
    encryptionMiddleware
};
