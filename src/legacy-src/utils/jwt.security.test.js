const assert = require('node:assert/strict');
const jwt = require('jsonwebtoken');

const previous = {
  JWT_SECRET: process.env.JWT_SECRET,
  JWT_REFRESH_SECRET: process.env.JWT_REFRESH_SECRET
};
process.env.JWT_SECRET = 'access-secret-0123456789-ABCDEFGHIJ';
process.env.JWT_REFRESH_SECRET = 'refresh-secret-0123456789-ABCDEFG';

const { generateToken, generateRefreshToken, verifyToken } = require('./jwt');

const accessToken = generateToken({ id: '507f1f77bcf86cd799439011' });
const accessClaims = verifyToken(accessToken);
assert.equal(accessClaims.tokenType, 'access');

const refreshToken = generateRefreshToken({ id: '507f1f77bcf86cd799439011' });
assert.throws(() => verifyToken(refreshToken), /Invalid token|verification failed/i);
const refreshClaims = jwt.verify(refreshToken, process.env.JWT_REFRESH_SECRET, { algorithms: ['HS256'] });
assert.equal(refreshClaims.tokenType, 'refresh');

const legacyAccess = jwt.sign({ id: '507f1f77bcf86cd799439011' }, process.env.JWT_SECRET, {
  algorithm: 'HS256', expiresIn: '7d'
});
assert.equal(verifyToken(legacyAccess).id, '507f1f77bcf86cd799439011');
const legacyRefresh = jwt.sign({ id: '507f1f77bcf86cd799439011' }, process.env.JWT_SECRET, {
  algorithm: 'HS256', expiresIn: '30d'
});
assert.throws(() => verifyToken(legacyRefresh), /Invalid token|verification failed/i);

const socketSource = require('node:fs').readFileSync(
  require('node:path').resolve(__dirname, '../../infrastructure/websocket/socket.ts'),
  'utf8'
);
assert.match(socketSource, /algorithms:\s*\["HS256"\]/);
assert.match(socketSource, /decoded\.tokenType\s*!==\s*"access"/);
assert.match(socketSource, /decoded\.exp - decoded\.iat > 8 \* 24 \* 60 \* 60/);

for (const [key, value] of Object.entries(previous)) {
  if (value === undefined) delete process.env[key];
  else process.env[key] = value;
}

console.log('JWT access/refresh separation and algorithm contracts passed');
