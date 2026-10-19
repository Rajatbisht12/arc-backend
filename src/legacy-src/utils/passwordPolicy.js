// This policy applies only when creating or replacing a password. Never use it
// to reject a login attempt for an existing account.
const passwordRequirements = (value) => ({
  length: typeof value === 'string' && Array.from(value).length >= 8,
  number: typeof value === 'string' && /[0-9]/.test(value),
  uppercase: typeof value === 'string' && /[A-Z]/.test(value),
  symbol: typeof value === 'string' && /[!-/:-@[-`{-~]/.test(value)
});

const passwordPolicyError = (value) => {
  const requirements = passwordRequirements(value);
  const missing = [
    !requirements.length && '8 or more characters',
    !requirements.number && 'a number',
    !requirements.uppercase && 'an uppercase letter',
    !requirements.symbol && 'a special symbol'
  ].filter(Boolean);
  return missing.length ? `Password must include ${missing.join(', ')}.` : '';
};

const passwordPolicyResponse = (message) => ({
  success: false,
  code: 'PASSWORD_POLICY_FAILED',
  error: 'PASSWORD_POLICY_FAILED',
  message
});

module.exports = { passwordRequirements, passwordPolicyError, passwordPolicyResponse };
