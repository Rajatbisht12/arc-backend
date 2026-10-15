const mongoose = require('mongoose');

const otpVerificationSchema = new mongoose.Schema({
  email: {
    type: String,
    required: true,
    lowercase: true,
    trim: true
  },
  otp: {
    type: String,
    select: false
  },
  otpHash: { type: String, select: false },
  purpose: {
    type: String,
    enum: ['login', 'register', 'forgot_password'],
    default: 'login'
  },
  expiresAt: {
    type: Date,
    required: true
  },
  used: {
    type: Boolean,
    default: false
  }
}, {
  timestamps: true
});

otpVerificationSchema.index({ email: 1, purpose: 1 });
otpVerificationSchema.index({ email: 1, purpose: 1, otpHash: 1 });
otpVerificationSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 }); // TTL optional

module.exports = mongoose.model('OtpVerification', otpVerificationSchema);
