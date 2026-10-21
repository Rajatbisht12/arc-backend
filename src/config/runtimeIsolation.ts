type Environment = Record<string, string | undefined>;
const PRODUCTION_SECRET = 'arc/prod/backend';
export class RuntimeIsolationError extends Error {}
const stageName = /(^|[._/-])(stage|staging)(?=$|[._/-])/i;
const prodName = /(^|[._/-])(prod|production)(?=$|[._/-])/i;
const fail = (name: string): never => { throw new RuntimeIsolationError(`Staging isolation requires an explicit, non-production ${name}`); };

export const runtimeSecretTarget = (environment: Environment) => {
  const deployment = environment.DEPLOYMENT_ENVIRONMENT || (environment.NODE_ENV === 'production' ? 'production' : environment.NODE_ENV || 'development');
  if (!['production', 'staging', 'development', 'test'].includes(deployment)) throw new Error('Invalid DEPLOYMENT_ENVIRONMENT');
  const secretId = environment.BACKEND_SECRET_ID || (deployment === 'production' ? PRODUCTION_SECRET : '');
  if (deployment === 'staging') {
    if (environment.NODE_ENV !== 'production') throw new Error('Staging must use NODE_ENV=production with DEPLOYMENT_ENVIRONMENT=staging');
    // Staging ECS tasks must use their own task role, not copied long-lived
    // credentials from a workstation or production runtime secret.
    if (['AWS_ACCESS_KEY_ID', 'AWS_SECRET_ACCESS_KEY', 'AWS_SESSION_TOKEN'].some(name => environment[name])) fail('ECS task-role credentials (no static AWS credentials)');
    const name = secretId.replace(/^arn:aws[a-z-]*:secretsmanager:[^:]+:\d{12}:secret:/, '');
    if (!name.startsWith('arc/staging/') || prodName.test(name)) fail('BACKEND_SECRET_ID under arc/staging/');
  }
  if (deployment === 'production' && !secretId.replace(/^arn:aws[a-z-]*:secretsmanager:[^:]+:\d{12}:secret:/, '').startsWith('arc/prod/')) {
    throw new Error('Production BACKEND_SECRET_ID must remain under arc/prod/');
  }
  return { deployment, secretId, load: environment.NODE_ENV === 'production' };
};

// Task-provided resource identities are independent of secret contents. Never
// hydrate these controls from a secret that might have been copied incorrectly.
export const isIsolationControl = (name: string) => [
  'DEPLOYMENT_ENVIRONMENT', 'BACKEND_SECRET_ID', 'VIDEO_DEPLOYMENT_MODE',
  'POST_VIDEO_ROLLOUT_MODE', 'POST_VIDEO_CANARY_USER_IDS',
].includes(name) || name.startsWith('STAGING_');

export const assertRuntimeIsolation = (environment: Environment): void => {
  if (runtimeSecretTarget(environment).deployment !== 'staging') return;
  const guard = (name: string) => {
    const value = environment[name] || '';
    if (!value || !stageName.test(value) || prodName.test(value) || /[\s*?]/.test(value)) fail(name);
    return value;
  };
  const host = guard('STAGING_MONGODB_HOST');
  const database = guard('STAGING_MONGODB_DATABASE');
  let mongo: URL;
  try { mongo = new URL(environment.MONGODB_URI || ''); } catch { return fail('MONGODB_URI'); }
  if (!['mongodb:', 'mongodb+srv:'].includes(mongo.protocol) || mongo.hostname.toLowerCase() !== host.toLowerCase()
      || decodeURIComponent(mongo.pathname.slice(1)) !== database) fail('MONGODB_URI matching staging host/database');
  if ((environment.REDIS_HOST || '').toLowerCase() !== guard('STAGING_REDIS_HOST').toLowerCase()) fail('REDIS_HOST matching staging endpoint');
  if ((environment.AWS_S3_BUCKET || '') !== guard('STAGING_S3_BUCKET')) fail('AWS_S3_BUCKET matching staging bucket');
  if (environment.AWS_S3_BUCKET_NAME && environment.AWS_S3_BUCKET_NAME !== environment.AWS_S3_BUCKET) fail('AWS_S3_BUCKET_NAME');
  // CloudFront's generated HTTPS hostnames do not contain "staging". Allow
  // them only when independently bound in the ECS task (never in the secret)
  // to the outputs of the approved staging stack. This avoids requiring a
  // change to production DNS merely to run isolated staging tests.
  const boundOrigin = (name: string) => {
    if (!environment[name]) return undefined;
    try {
      const url = new URL(environment[name]);
      if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash
          || url.pathname !== '/' || url.port
          || (!stageName.test(url.hostname) && !/^d[a-z0-9]+\.cloudfront\.net$/.test(url.hostname))
          || prodName.test(url.hostname)) return fail(name);
      return url.origin;
    } catch { return fail(name); }
  };
  const apiOrigin = boundOrigin('STAGING_API_ORIGIN');
  const mediaOrigin = boundOrigin('STAGING_MEDIA_ORIGIN');
  for (const name of ['AWS_S3_CDN_URL', 'POST_VIDEO_CLOUDFRONT_URL', 'POST_VIDEO_API_ORIGIN', 'CLIENT_URL', 'GOOGLE_CALLBACK_URL']) {
    if (!environment[name]) continue;
    try {
      const url = new URL(environment[name]);
      const binding = name === 'POST_VIDEO_API_ORIGIN' ? apiOrigin
        : ['AWS_S3_CDN_URL', 'POST_VIDEO_CLOUDFRONT_URL'].includes(name) ? mediaOrigin : undefined;
      if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash
          || prodName.test(url.hostname)
          || (binding ? url.origin !== binding || url.pathname !== '/' : !stageName.test(url.hostname))) fail(name);
    } catch { fail(name); }
  }
  const origins = String(environment.CORS_ORIGIN || '').split(',').filter(Boolean);
  for (const origin of origins) {
    try {
      const url = new URL(origin.trim());
      if (!['localhost', '127.0.0.1'].includes(url.hostname) && (url.protocol !== 'https:' || !stageName.test(url.hostname) || prodName.test(url.hostname))) fail('CORS_ORIGIN');
    } catch { fail('CORS_ORIGIN'); }
  }
};
