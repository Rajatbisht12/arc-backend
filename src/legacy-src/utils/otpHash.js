const { createHmac, timingSafeEqual } = require('crypto');

function hashOtp(email, purpose, otp) {
  const secret = process.env.JWT_SECRET;
  if (!secret) throw new Error('OTP hashing secret is not configured');
  return createHmac('sha256', secret)
    .update(`squadhunt-otp-v1:${String(email).toLowerCase()}:${purpose}:${String(otp)}`)
    .digest('hex');
}

async function findMatchingOtp(Model, email, purpose, otp) {
  const code = String(otp || '').trim();
  if (!/^\d{6}$/.test(code)) return null;
  const record = await Model.findOne({
    email: String(email).toLowerCase(), purpose, used: false, expiresAt: { $gt: new Date() }
  }).sort({ createdAt: -1 }).select('+otp +otpHash');
  if (!record) return null;
  const expectedHash = hashOtp(email, purpose, code);
  const storedHash = String(record.otpHash || '');
  const hashMatches = /^[a-f0-9]{64}$/.test(storedHash) &&
    timingSafeEqual(Buffer.from(expectedHash, 'hex'), Buffer.from(storedHash, 'hex'));
  // Older plaintext records exist only for the short TTL during deployment.
  const legacyCode = String(record.otp || '');
  const legacyMatches = /^\d{6}$/.test(legacyCode) &&
    timingSafeEqual(Buffer.from(code), Buffer.from(legacyCode));
  return hashMatches || legacyMatches ? record : null;
}

module.exports = { hashOtp, findMatchingOtp };
