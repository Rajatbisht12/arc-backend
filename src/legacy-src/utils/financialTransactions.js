const mongoose = require('mongoose');

const FINANCIAL_TRANSACTION_OPTIONS = Object.freeze({
  readPreference: 'primary',
  readConcern: { level: 'snapshot' },
  writeConcern: { w: 'majority' }
});

// Amazon DocumentDB explicit sessions must not use causal consistency.
const startFinancialSession = () => mongoose.startSession({ causalConsistency: false });

const maskedBankSnapshot = (bank) => ({
  accountHolderName: bank.accountHolderName || '',
  bankName: bank.bankName || '',
  lastFourDigits: bank.lastFourDigits || '',
  ifsc: bank.ifsc || '',
  swiftCode: bank.swiftCode || '',
  branch: bank.branch || '',
  country: bank.country || 'IN',
  version: Math.max(1, Number(bank.version || 1)),
  capturedAt: new Date()
});

module.exports = {
  FINANCIAL_TRANSACTION_OPTIONS,
  startFinancialSession,
  maskedBankSnapshot
};
