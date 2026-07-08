const COUNTRY_PATTERN = /^[A-Z]{2}$/;
const INDIAN_ACCOUNT_PATTERN = /^\d{6,20}$/;
const INTERNATIONAL_ACCOUNT_PATTERN = /^[A-Z0-9]{6,34}$/;
const IFSC_PATTERN = /^[A-Z]{4}0[A-Z0-9]{6}$/;
const SWIFT_PATTERN = /^[A-Z]{6}[A-Z0-9]{2}(?:[A-Z0-9]{3})?$/;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const UPI_PATTERN = /^[a-z0-9._-]{2,256}@[a-z][a-z0-9.-]{1,63}$/;
const GST_PATTERN = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][A-Z0-9]Z[A-Z0-9]$/;
const CONTROL_CHARACTER_PATTERN = /[\u0000-\u001f\u007f]/;

const normalizeText = (value, { uppercase = false, lowercase = false } = {}) => {
  let normalized = typeof value === 'string' ? value.trim().replace(/\s+/g, ' ') : '';
  if (uppercase) normalized = normalized.toUpperCase();
  if (lowercase) normalized = normalized.toLowerCase();
  return normalized;
};

const normalizeAccountNumber = (value) => String(value || '')
  .replace(/[\s-]+/g, '')
  .toUpperCase();

const validateText = (errors, field, value, { required = false, min = 0, max }) => {
  if (required && !value) errors.push({ field, message: `${field} is required.` });
  if (value && CONTROL_CHARACTER_PATTERN.test(value)) errors.push({ field, message: `${field} contains invalid characters.` });
  if (value && min && value.length < min) errors.push({ field, message: `${field} is too short.` });
  if (value && max && value.length > max) errors.push({ field, message: `${field} is too long.` });
};

const normalizeAndValidateBankDetails = (input = {}) => {
  const errors = [];
  const country = normalizeText(input.country || 'IN', { uppercase: true });
  const accountNumber = normalizeAccountNumber(input.accountNumber);
  const accountNumberConfirm = normalizeAccountNumber(input.accountNumberConfirm);
  const value = {
    accountHolderName: normalizeText(input.accountHolderName),
    bankName: normalizeText(input.bankName),
    accountNumber,
    accountNumberConfirm,
    country,
    ifsc: normalizeText(input.ifsc, { uppercase: true }),
    swiftCode: normalizeText(input.swiftCode, { uppercase: true }),
    branch: normalizeText(input.branch),
    upiId: normalizeText(input.upiId, { lowercase: true }),
    paypalEmail: normalizeText(input.paypalEmail, { lowercase: true }),
    taxId: normalizeText(input.taxId || input.pan, { uppercase: true }),
    gstNumber: normalizeText(input.gstNumber, { uppercase: true })
  };

  validateText(errors, 'Account holder name', value.accountHolderName, { required: true, min: 2, max: 100 });
  validateText(errors, 'Bank name', value.bankName, { required: true, min: 2, max: 200 });
  validateText(errors, 'Branch', value.branch, { max: 200 });
  validateText(errors, 'UPI ID', value.upiId, { max: 100 });
  validateText(errors, 'PayPal email', value.paypalEmail, { max: 200 });
  validateText(errors, 'Tax ID', value.taxId, { max: 100 });
  validateText(errors, 'GST number', value.gstNumber, { max: 30 });

  if (!COUNTRY_PATTERN.test(country)) errors.push({ field: 'country', message: 'Country must be a valid 2-letter country code.' });
  if (!accountNumber) errors.push({ field: 'accountNumber', message: 'Account number is required.' });
  if (!accountNumberConfirm) errors.push({ field: 'accountNumberConfirm', message: 'Account number confirmation is required.' });
  if (accountNumber && accountNumberConfirm && accountNumber !== accountNumberConfirm) {
    errors.push({ field: 'accountNumberConfirm', message: 'Account number confirmation does not match.' });
  }
  if (accountNumber) {
    const validAccount = country === 'IN'
      ? INDIAN_ACCOUNT_PATTERN.test(accountNumber)
      : INTERNATIONAL_ACCOUNT_PATTERN.test(accountNumber);
    if (!validAccount) {
      errors.push({
        field: 'accountNumber',
        message: country === 'IN'
          ? 'Indian account number must contain 6 to 20 digits.'
          : 'Account number must contain 6 to 34 letters or digits.'
      });
    }
  }
  if (country === 'IN' && !IFSC_PATTERN.test(value.ifsc)) {
    errors.push({ field: 'ifsc', message: 'A valid IFSC code is required for Indian payout accounts.' });
  }
  if (country !== 'IN' && !SWIFT_PATTERN.test(value.swiftCode)) {
    errors.push({ field: 'swiftCode', message: 'A valid 8 or 11 character SWIFT code is required for international payout accounts.' });
  }
  if (value.upiId && !UPI_PATTERN.test(value.upiId)) errors.push({ field: 'upiId', message: 'Enter a valid UPI ID.' });
  if (value.paypalEmail && !EMAIL_PATTERN.test(value.paypalEmail)) errors.push({ field: 'paypalEmail', message: 'Enter a valid PayPal email address.' });
  if (country === 'IN' && value.gstNumber && !GST_PATTERN.test(value.gstNumber)) errors.push({ field: 'gstNumber', message: 'Enter a valid GST number.' });

  return { valid: errors.length === 0, errors, value };
};

const firstValidationMessage = (result) => result.errors?.[0]?.message || 'Invalid bank details.';

module.exports = {
  COUNTRY_PATTERN,
  IFSC_PATTERN,
  SWIFT_PATTERN,
  normalizeAccountNumber,
  normalizeAndValidateBankDetails,
  firstValidationMessage
};
