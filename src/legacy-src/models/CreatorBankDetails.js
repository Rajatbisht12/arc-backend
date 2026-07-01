const mongoose = require('mongoose');
const crypto = require('crypto');

const ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || process.env.JWT_SECRET || 'default-32-byte-key-for-arc-bank!!';
const IV_LENGTH = 16;
const ALGO = 'aes-256-cbc';

function encrypt(text) {
  const key = Buffer.from(ENCRYPTION_KEY.slice(0, 32).padEnd(32, '0'));
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGO, key, iv);
  let encrypted = cipher.update(String(text), 'utf8', 'hex');
  encrypted += cipher.final('hex');
  return iv.toString('hex') + ':' + encrypted;
}

function hashValue(text) {
  return crypto
    .createHash('sha256')
    .update(String(text || '').trim().toLowerCase())
    .digest('hex');
}

function decrypt(encrypted) {
  if (!encrypted || !encrypted.includes(':')) return '';
  const [ivHex, encryptedText] = encrypted.split(':');
  const key = Buffer.from(ENCRYPTION_KEY.slice(0, 32).padEnd(32, '0'));
  const iv = Buffer.from(ivHex, 'hex');
  const decipher = crypto.createDecipheriv(ALGO, key, iv);
  let decrypted = decipher.update(encryptedText, 'hex', 'utf8');
  decrypted += decipher.final('utf8');
  return decrypted;
}

const creatorBankDetailsSchema = new mongoose.Schema({
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    unique: true,
    index: true
  },
  accountHolderName: {
    type: String,
    required: true,
    trim: true,
    maxlength: 100
  },
  /** Stored encrypted at rest */
  accountNumberEncrypted: {
    type: String,
    required: true
  },
  accountNumberHash: {
    type: String,
    index: true
  },
  ifsc: {
    type: String,
    trim: true,
    uppercase: true,
    match: [/^[A-Z]{4}0[A-Z0-9]{6}$/, 'Invalid IFSC format']
  },
  swiftCode: {
    type: String,
    trim: true,
    uppercase: true,
    maxlength: 11
  },
  bankName: {
    type: String,
    required: true,
    trim: true,
    maxlength: 200
  },
  branch: {
    type: String,
    trim: true,
    maxlength: 200
  },
  upiId: {
    type: String,
    trim: true,
    lowercase: true,
    maxlength: 100
  },
  paypalEmail: {
    type: String,
    trim: true,
    lowercase: true,
    maxlength: 200
  },
  country: {
    type: String,
    trim: true,
    uppercase: true,
    default: 'IN',
    maxlength: 2
  },
  taxIdEncrypted: {
    type: String
  },
  taxIdHash: {
    type: String,
    index: true
  },
  gstNumber: {
    type: String,
    trim: true,
    uppercase: true,
    maxlength: 30
  },
  verificationStatus: {
    type: String,
    enum: ['pending', 'verified', 'failed'],
    default: 'pending',
    index: true
  },
  verifiedAt: {
    type: Date
  },
  lastFourDigits: {
    type: String,
    maxlength: 4
  }
}, { timestamps: true });

creatorBankDetailsSchema.virtual('accountNumber').get(function() {
  return decrypt(this.accountNumberEncrypted);
});
creatorBankDetailsSchema.set('toJSON', { virtuals: false });
creatorBankDetailsSchema.set('toObject', { virtuals: true });

// Caller must encrypt account number before saving: use CreatorBankDetails.encryptAccountNumber(plain)
creatorBankDetailsSchema.statics.encryptAccountNumber = encrypt;
creatorBankDetailsSchema.statics.decryptAccountNumber = decrypt;
creatorBankDetailsSchema.statics.encryptSensitiveValue = encrypt;
creatorBankDetailsSchema.statics.hashSensitiveValue = hashValue;

module.exports = mongoose.model('CreatorBankDetails', creatorBankDetailsSchema);
