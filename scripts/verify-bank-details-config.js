#!/usr/bin/env node
require('dotenv').config();

const release = process.argv.includes('--release');
const dedicatedKey = process.env.BANK_DETAILS_ENCRYPTION_KEY || '';
const fallbackKey = process.env.ENCRYPTION_KEY || '';
const activeKey = dedicatedKey || fallbackKey;
const adminJwtSecret = process.env.ADMIN_JWT_SECRET || '';
const userJwtSecret = process.env.JWT_SECRET || '';
const failures = [];
const warnings = [];

if (!/^[\x20-\x7E]{32,}$/.test(activeKey)) failures.push('BANK_DETAILS_ENCRYPTION_KEY must contain at least 32 ASCII characters.');
if (!dedicatedKey && fallbackKey) warnings.push('Using shared ENCRYPTION_KEY fallback; production requires a dedicated stable BANK_DETAILS_ENCRYPTION_KEY.');
if (release && !dedicatedKey) failures.push('Production release requires BANK_DETAILS_ENCRYPTION_KEY from the secret store; fallback ENCRYPTION_KEY is not accepted.');
if (/(replace|change[-_ ]?me|placeholder|example|demo|your[-_ ]?key|at_least_32)/i.test(activeKey)) failures.push('The active bank-details encryption key appears to contain a placeholder value.');
if (release && activeKey && activeKey === userJwtSecret) failures.push('BANK_DETAILS_ENCRYPTION_KEY must be different from JWT_SECRET.');
if (release && activeKey && activeKey === adminJwtSecret) failures.push('BANK_DETAILS_ENCRYPTION_KEY must be different from ADMIN_JWT_SECRET.');
if (release && adminJwtSecret.length < 32) failures.push('Production release requires a dedicated ADMIN_JWT_SECRET with at least 32 characters.');
if (release && adminJwtSecret && adminJwtSecret === userJwtSecret) failures.push('ADMIN_JWT_SECRET must be different from JWT_SECRET.');
if (release && /(replace|change[-_ ]?me|placeholder|example|demo|your[-_ ]?key|at_least_32)/i.test(adminJwtSecret)) failures.push('ADMIN_JWT_SECRET appears to contain a placeholder value.');

warnings.forEach((message) => console.warn(`[bank-details-config] WARN: ${message}`));
failures.forEach((message) => console.error(`[bank-details-config] FAIL: ${message}`));

if (!failures.length) {
  console.log('[bank-details-config] PASS: bank-detail encryption is configured.');
  process.exit(0);
}
process.exit(release ? 1 : 0);
