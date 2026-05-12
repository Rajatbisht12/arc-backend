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
  ifsc: {
    type: String,
    required: true,
    trim: true,
    uppercase: true,
    match: [/^[A-Z]{4}0[A-Z0-9]{6}$/, 'Invalid IFSC format']
  },
  bankName: {
    type: String,
    required: true,
    trim: true,
    maxlength: 200
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

module.exports = mongoose.model('CreatorBankDetails', creatorBankDetailsSchema);
