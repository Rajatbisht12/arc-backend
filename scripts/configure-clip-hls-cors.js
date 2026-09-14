#!/usr/bin/env node

require('dotenv').config();
const {
  S3Client,
  GetBucketCorsCommand,
  PutBucketCorsCommand,
} = require('@aws-sdk/client-s3');

const apply = process.argv.includes('--apply');
const verify = process.argv.includes('--verify');
if (apply && verify) throw new Error('Use either --apply or --verify, not both');
const bucket = process.env.AWS_S3_BUCKET;
if (!bucket) throw new Error('AWS_S3_BUCKET is required');

const originSource = process.env.CLIP_HLS_CORS_ORIGINS || process.env.CORS_ORIGIN || '';
const origins = Array.from(new Set(originSource.split(',').map(item => item.trim()).filter(item => /^https?:\/\//.test(item))));
if (!origins.length) throw new Error('CLIP_HLS_CORS_ORIGINS or CORS_ORIGIN must contain at least one HTTP(S) origin');

const client = new S3Client({ region: process.env.AWS_REGION || 'us-east-1' });
const ruleId = 'SquadHuntClipHlsRead';
const desired = {
  ID: ruleId,
  AllowedOrigins: origins,
  AllowedMethods: ['GET', 'HEAD'],
  AllowedHeaders: ['*'],
  ExposeHeaders: ['Accept-Ranges', 'Content-Length', 'Content-Range', 'ETag'],
  MaxAgeSeconds: 86400,
};

const sameSet = (left = [], right = []) => (
  left.length === right.length && left.every(value => right.includes(value))
);

const isCompliant = rule => Boolean(
  rule
  && sameSet(rule.AllowedOrigins, desired.AllowedOrigins)
  && desired.AllowedMethods.every(method => rule.AllowedMethods?.includes(method))
  && desired.ExposeHeaders.every(header => rule.ExposeHeaders?.includes(header))
  && rule.AllowedHeaders?.includes('*')
);

const main = async () => {
  let rules = [];
  try {
    const current = await client.send(new GetBucketCorsCommand({ Bucket: bucket }));
    rules = current.CORSRules || [];
  } catch (error) {
    const code = String(error?.name || error?.Code || error?.code || '');
    if (!/NoSuchCORS/i.test(code)) throw error;
  }
  const currentRule = rules.find(rule => rule.ID === ruleId);
  const compliant = isCompliant(currentRule);
  if (apply && !compliant) {
    const nextRules = [...rules.filter(rule => rule.ID !== ruleId), desired];
    await client.send(new PutBucketCorsCommand({
      Bucket: bucket,
      CORSConfiguration: { CORSRules: nextRules },
    }));
  }
  console.log(JSON.stringify({
    mode: apply ? 'apply' : verify ? 'verify' : 'audit-only',
    bucket,
    origins,
    compliant: apply ? true : compliant,
    changed: Boolean(apply && !compliant),
  }, null, 2));
  if (!apply) console.log('No bucket configuration was changed.');
  if (verify && !compliant) process.exitCode = 2;
};

main().catch(error => {
  console.error(String(error));
  process.exitCode = 1;
});
