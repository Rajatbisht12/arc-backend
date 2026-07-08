const mongoose = require('mongoose');
const crypto = require('crypto');

const LEGACY_IV_LENGTH = 16;
const GCM_IV_LENGTH = 12;
const LEGACY_ALGO = 'aes-256-cbc';
const ALGO = 'aes-256-gcm';

function encryptionKey() {
  const encryptionSecret = process.env.BANK_DETAILS_ENCRYPTION_KEY || process.env.ENCRYPTION_KEY;
  if (!encryptionSecret || !/^[\x20-\x7E]{32,}$/.test(encryptionSecret)) {
    throw new Error('BANK_DETAILS_ENCRYPTION_KEY or ENCRYPTION_KEY with at least 32 ASCII characters is required');
  }
  // Preserve the deployed v1/v2 key derivation so existing ciphertext remains
  // decryptable. Key rotation must be performed through an explicit migration.
  return Buffer.from(encryptionSecret.slice(0, 32).padEnd(32, '0'));
}

function encrypt(text) {
  const key = encryptionKey();
  const iv = crypto.randomBytes(GCM_IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGO, key, iv);
  let encrypted = cipher.update(String(text), 'utf8', 'hex');
  encrypted += cipher.final('hex');
  const authTag = cipher.getAuthTag();
  return 'v2:' + iv.toString('hex') + ':' + authTag.toString('hex') + ':' + encrypted;
}

function hashValue(text, purpose = 'sensitive-value') {
  return crypto
    .createHmac('sha256', encryptionKey())
    .update(`${purpose}:${String(text || '').trim().toLowerCase()}`)
    .digest('hex');
}

function decrypt(encrypted) {
  if (!encrypted || typeof encrypted !== 'string' || !encrypted.includes(':')) {
    throw new Error('Invalid encrypted bank value');
  }
  const key = encryptionKey();
  const parts = encrypted.split(':');
  if (parts[0] === 'v2') {
    if (parts.length !== 4 || parts[1].length !== GCM_IV_LENGTH * 2 || parts[2].length !== 32) {
      throw new Error('Invalid encrypted bank value');
    }
    const decipher = crypto.createDecipheriv(ALGO, key, Buffer.from(parts[1], 'hex'));
    decipher.setAuthTag(Buffer.from(parts[2], 'hex'));
    let decrypted = decipher.update(parts[3], 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    return decrypted;
  }
  // Backward-compatible read path for legacy AES-CBC rows. All new writes use
  // authenticated v2 AES-GCM and naturally migrate when bank details change.
  if (parts.length !== 2 || parts[0].length !== LEGACY_IV_LENGTH * 2) {
    throw new Error('Invalid encrypted bank value');
  }
  const [ivHex, encryptedText] = parts;
  const iv = Buffer.from(ivHex, 'hex');
  const decipher = crypto.createDecipheriv(LEGACY_ALGO, key, iv);
  let decrypted = decipher.update(encryptedText, 'hex', 'utf8');
  decrypted += decipher.final('utf8');
  return decrypted;
}

const creatorBankDetailsSchema = new mongoose.Schema({
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    immutable: true,
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
    required: true,
    select: false
  },
  accountNumberHash: {
    type: String,
    index: true,
    select: false
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
    maxlength: 100,
    select: false
  },
  upiIdEncrypted: {
    type: String,
    select: false
  },
  upiIdMasked: {
    type: String,
    default: '',
    maxlength: 120
  },
  paypalEmail: {
    type: String,
    trim: true,
    lowercase: true,
    maxlength: 200,
    select: false
  },
  paypalEmailEncrypted: {
    type: String,
    select: false
  },
  paypalEmailMasked: {
    type: String,
    default: '',
    maxlength: 220
  },
  country: {
    type: String,
    trim: true,
    uppercase: true,
    default: 'IN',
    maxlength: 2
  },
  taxIdEncrypted: {
    type: String,
    select: false
  },
  taxIdHash: {
    type: String,
    index: true,
    select: false
  },
  gstNumber: {
    type: String,
    trim: true,
    uppercase: true,
    maxlength: 30,
    select: false
  },
  gstNumberEncrypted: {
    type: String,
    select: false
  },
  gstNumberMasked: {
    type: String,
    default: '',
    maxlength: 40
  },
  verificationStatus: {
    type: String,
    enum: ['pending', 'verified', 'rejected', 'failed'],
    default: 'pending',
    index: true
  },
  verifiedAt: {
    type: Date
  },
  verifiedByActorKey: {
    type: String,
    default: ''
  },
  rejectedAt: {
    type: Date
  },
  verificationReason: {
    type: String,
    trim: true,
    maxlength: 1000,
    default: ''
  },
  internalNotes: {
    type: String,
    trim: true,
    maxlength: 2000,
    default: '',
    select: false
  },
  // Administrative notes are metadata. Their concurrency token must remain
  // independent from the payout-destination version pinned by disbursements.
  internalNotesVersion: {
    type: Number,
    default: 1,
    min: 1
  },
  version: {
    type: Number,
    default: 1,
    min: 1
  },
  lastSubmittedAt: {
    type: Date,
    default: Date.now
  },
  activePayoutLocks: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'CreatorPayout'
  }],
  activeWithdrawalLocks: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'WithdrawalRequest'
  }],
  lastFourDigits: {
    type: String,
    maxlength: 4
  }
}, { timestamps: true });

creatorBankDetailsSchema.set('toJSON', { virtuals: false });
creatorBankDetailsSchema.set('toObject', { virtuals: false });

creatorBankDetailsSchema.index({ verificationStatus: 1, updatedAt: -1 });
creatorBankDetailsSchema.index({ country: 1, verificationStatus: 1, updatedAt: -1 });

// Caller must encrypt account number before saving: use CreatorBankDetails.encryptAccountNumber(plain)
creatorBankDetailsSchema.statics.encryptAccountNumber = encrypt;
creatorBankDetailsSchema.statics.decryptAccountNumber = decrypt;
creatorBankDetailsSchema.statics.encryptSensitiveValue = encrypt;
creatorBankDetailsSchema.statics.hashSensitiveValue = hashValue;

module.exports = mongoose.model('CreatorBankDetails', creatorBankDetailsSchema);
