const crypto = require('crypto');

const SHARE_CODE_PATTERNS = Object.freeze({
  recruitment: /^(RST|STF)-[A-Z0-9]{3}-[A-F0-9]{8}$/,
  profile: /^(PLR|STF)-[A-Z0-9]{3}-[A-F0-9]{8}$/
});
const SUPPORTED_LEGACY_SHARE_CODE_PATTERNS = Object.freeze({
  recruitment: /^(RST|STF)-[^/]{1,16}-[A-F0-9]{8}$/,
  profile: /^(PLR|STF)-[^/]{1,16}-[A-F0-9]{8}$/
});

const safeRoleAbbreviation = (value) => {
  const compact = String(value || '')
    .normalize('NFKD')
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
    .slice(0, 3);
  return `${compact}GEN`.slice(0, 3);
};

const randomCodeSuffix = () => crypto.randomBytes(4).toString('hex').toUpperCase();

const generateRecruitmentCode = ({ recruitmentType, role, staffRole }) => {
  const prefix = recruitmentType === 'roster' ? 'RST' : 'STF';
  const sourceRole = recruitmentType === 'roster' ? role : staffRole;
  return `${prefix}-${safeRoleAbbreviation(sourceRole)}-${randomCodeSuffix()}`;
};

const generatePlayerProfileCode = ({ profileType, role, staffRole }) => {
  const prefix = profileType === 'looking-for-team' ? 'PLR' : 'STF';
  const sourceRole = profileType === 'looking-for-team' ? role : staffRole;
  return `${prefix}-${safeRoleAbbreviation(sourceRole)}-${randomCodeSuffix()}`;
};

const isShareCodeCollision = (error, codeField) => Boolean(
  error?.code === 11000
  && (
    error?.keyPattern?.[codeField]
    || Object.prototype.hasOwnProperty.call(error?.keyValue || {}, codeField)
    || String(error?.message || '').includes(codeField)
  )
);

const saveWithUniqueShareCode = async ({ document, codeField, generateCode, maxAttempts = 4 }) => {
  let lastError;
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    document[codeField] = generateCode();
    try {
      await document.save();
      return document;
    } catch (error) {
      lastError = error;
      if (!isShareCodeCollision(error, codeField)) throw error;
    }
  }
  throw lastError;
};

const backfillUniqueShareCode = async ({ model, document, codeField, generateCode, maxAttempts = 4 }) => {
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const code = generateCode();
    try {
      const result = await model.updateOne(
        {
          _id: document._id,
          $or: [
            { [codeField]: { $exists: false } },
            { [codeField]: null },
            { [codeField]: '' }
          ]
        },
        { $set: { [codeField]: code } },
        { runValidators: false }
      );
      if (result.modifiedCount === 1) {
        document[codeField] = code;
        return code;
      }
      const current = await model.findById(document._id).select(codeField).lean();
      if (current?.[codeField]) {
        document[codeField] = current[codeField];
        return current[codeField];
      }
    } catch (error) {
      if (!isShareCodeCollision(error, codeField)) throw error;
    }
  }
  throw new Error(`Unable to allocate unique ${codeField}`);
};

module.exports = {
  SHARE_CODE_PATTERNS,
  SUPPORTED_LEGACY_SHARE_CODE_PATTERNS,
  safeRoleAbbreviation,
  generateRecruitmentCode,
  generatePlayerProfileCode,
  isShareCodeCollision,
  saveWithUniqueShareCode,
  backfillUniqueShareCode
};
