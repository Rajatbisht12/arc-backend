/**
 * ZegoCloud Token Generator (Token04)
 * ------------------------------------
 * Ported from: https://github.com/ZEGOCLOUD/zego_server_assistant/tree/master/token/nodejs
 *
 * Generates server-side authentication tokens for ZegoCloud video/voice SDKs.
 * This MUST run on the server to keep ServerSecret safe.
 */

const crypto = require('crypto');

const ErrorCode = {
  success: 0,
  appIDInvalid: 1,
  userIDInvalid: 3,
  secretInvalid: 5,
  effectiveTimeInSecondsInvalid: 6
};

function makeNonce() {
  return crypto.randomInt(0, 2147483647);
}

function makeRandomIv() {
  const str = '0123456789abcdefghijklmnopqrstuvwxyz';
  const buf = [];
  for (let i = 0; i < 16; i++) {
    const index = Math.round(Math.random() * (str.length - 1));
    buf.push(str[index]);
  }
  return buf.join('');
}

function aesEncrypt(plainText, key, iv) {
  const cipher = crypto.createCipheriv('aes-128-cbc', key, iv);
  cipher.setAutoPadding(true);
  const encrypted = cipher.update(plainText);
  const final = cipher.final();
  const result = Buffer.concat([encrypted, final]);
  return result;
}

/**
 * Generate a ZegoCloud Token04
 *
 * @param {number} appID - App ID assigned by ZEGO
 * @param {string} userId - User ID
 * @param {string} secret - 32-byte hex secret
 * @param {number} effectiveTimeInSeconds - Token validity in seconds
 * @param {string} [payload=''] - Optional custom payload (JSON string for strict tokens)
 * @returns {{ token: string } | { errorCode: number, errorMessage: string }}
 */
function generateToken04(appID, userId, secret, effectiveTimeInSeconds, payload = '') {
  if (!appID || typeof appID !== 'number') {
    return {
      errorCode: ErrorCode.appIDInvalid,
      errorMessage: 'appID invalid'
    };
  }

  if (!userId || typeof userId !== 'string') {
    return {
      errorCode: ErrorCode.userIDInvalid,
      errorMessage: 'userId invalid'
    };
  }

  if (!secret || typeof secret !== 'string' || secret.length !== 32) {
    return {
      errorCode: ErrorCode.secretInvalid,
      errorMessage: 'secret must be a 32-byte string'
    };
  }

  if (!effectiveTimeInSeconds || typeof effectiveTimeInSeconds !== 'number') {
    return {
      errorCode: ErrorCode.effectiveTimeInSecondsInvalid,
      errorMessage: 'effectiveTimeInSeconds invalid'
    };
  }

  const createTime = Math.floor(Date.now() / 1000);
  const tokenInfo = {
    app_id: appID,
    user_id: userId,
    nonce: makeNonce(),
    ctime: createTime,
    expire: createTime + effectiveTimeInSeconds,
    payload: payload || ''
  };

  const plainText = JSON.stringify(tokenInfo);
  const iv = makeRandomIv();
  const encryptBuf = aesEncrypt(plainText, secret.substring(0, 16), iv);

  // Token format: '04' + base64([expireTime(8 bytes) + ivLen(2 bytes) + iv + encryptedLen(2 bytes) + encrypted])
  const resultSize = 8 + 2 + iv.length + 2 + encryptBuf.length;
  const resultBuf = Buffer.alloc(resultSize);
  let offset = 0;

  // expire time (BigInt64)
  const expireTime = BigInt(createTime + effectiveTimeInSeconds);
  resultBuf.writeBigInt64BE(expireTime, offset);
  offset += 8;

  // IV length + IV
  const ivBuf = Buffer.from(iv);
  resultBuf.writeUInt16BE(ivBuf.length, offset);
  offset += 2;
  ivBuf.copy(resultBuf, offset);
  offset += ivBuf.length;

  // Encrypted data length + data
  resultBuf.writeUInt16BE(encryptBuf.length, offset);
  offset += 2;
  encryptBuf.copy(resultBuf, offset);

  const token = '04' + resultBuf.toString('base64');

  return { token, errorCode: ErrorCode.success };
}

module.exports = { generateToken04, ErrorCode };
