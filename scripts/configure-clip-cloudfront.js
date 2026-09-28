#!/usr/bin/env node

const { spawnSync } = require('node:child_process');
const { performance } = require('node:perf_hooks');

// Intentionally do not load the backend .env here. This operator tool delegates
// authentication to the AWS CLI credential chain; importing application access
// keys from .env could silently run infrastructure changes under another IAM
// identity. Non-secret configuration is supplied explicitly by the shell.

const flags = new Set(process.argv.slice(2));
const apply = flags.has('--apply');
const verify = flags.has('--verify');
const activateEcs = flags.has('--activate-ecs');
if ([apply, verify, activateEcs].filter(Boolean).length > 1) {
  throw new Error('Use only one of --apply, --verify, or --activate-ecs');
}

const bucket = process.env.AWS_S3_BUCKET || process.env.AWS_S3_BUCKET_NAME;
const region = process.env.AWS_REGION || 'us-east-1';
if (!bucket) throw new Error('AWS_S3_BUCKET is required');

const distributionComment = process.env.CLIP_CDN_DISTRIBUTION_COMMENT || 'SquadHunt immutable Clip media';
const oacName = process.env.CLIP_CDN_OAC_NAME || 'SquadHuntClipMediaOAC-v1';
const edgeFunctionName = process.env.CLIP_CDN_FUNCTION_NAME || 'SquadHuntClipMediaCors-v1';
// AWS managed CachingOptimized: no query strings/cookies/headers in the key,
// DefaultTTL 1 day, MaxTTL 1 year. Edge-generated CORS below makes one media
// object reusable across official Web origins without caching the wrong ACAO.
const cachePolicyId = '658327ea-f89d-4fab-a63d-7e88639e58f6';
const originRequestPolicyId = '88a5eaf4-2fd4-4709-b370-b4c650ea3fcf';
const priceClass = process.env.CLIP_CDN_PRICE_CLASS || 'PriceClass_200';
const ecsCluster = process.env.CLIP_CDN_ECS_CLUSTER || 'arc-cluster';
const ecsService = process.env.CLIP_CDN_ECS_SERVICE || 'arc-backend';
const ecsContainer = process.env.CLIP_CDN_ECS_CONTAINER || 'arc-backend';
const allowedOrigins = Array.from(new Set((process.env.CLIP_CDN_ALLOWED_ORIGINS || [
  'https://squadhunt.com',
  'https://www.squadhunt.com',
  'https://squadhunt.in',
  'https://www.squadhunt.in',
  'http://localhost:3000',
  'http://localhost:5173'
].join(','))
  .split(',')
  .map(value => value.trim())
  .filter(value => /^https?:\/\//.test(value))));

const originDomain = `${bucket}.s3.${region}.amazonaws.com`;
const originId = 'squadhunt-clip-media-s3';

const aws = (args, { allowFailure = false } = {}) => {
  const result = spawnSync('aws', [...args, '--no-cli-pager', '--output', 'json'], {
    encoding: 'utf8',
    maxBuffer: 20 * 1024 * 1024
  });
  if (result.status !== 0) {
    if (allowFailure) return null;
    const message = String(result.stderr || result.stdout || `aws ${args.slice(0, 2).join(' ')} failed`).trim();
    throw new Error(message);
  }
  const output = String(result.stdout || '').trim();
  return output ? JSON.parse(output) : {};
};

const listItems = (value, key) => value?.[key]?.Items || [];

const loadState = () => {
  const distributions = listItems(aws(['cloudfront', 'list-distributions']), 'DistributionList');
  const distribution = distributions.find(item => (
    item.Comment === distributionComment
    || item.Origins?.Items?.some(origin => origin.DomainName === originDomain)
  ));
  const originAccessControls = listItems(
    aws(['cloudfront', 'list-origin-access-controls']),
    'OriginAccessControlList'
  );
  const liveFunctions = listItems(
    aws(['cloudfront', 'list-functions', '--stage', 'LIVE']),
    'FunctionList'
  );
  const attachedOacId = distribution?.Origins?.Items?.find(origin => origin.DomainName === originDomain)
    ?.OriginAccessControlId;
  const subscriptions = aws([
    'pricing-plan-manager', 'list-subscriptions', '--region', region
  ], { allowFailure: true })?.subscriptionSummaries || [];
  return {
    distribution,
    cachePolicy: aws(['cloudfront', 'get-cache-policy', '--id', cachePolicyId]).CachePolicy,
    edgeFunction: liveFunctions.find(item => item.Name === edgeFunctionName),
    pricingPlan: subscriptions.find(item => item.resourceArns?.includes(distribution?.ARN)),
    originAccessControl: originAccessControls.find(item => item.Id === attachedOacId)
      || originAccessControls.find(item => item.Name === oacName)
  };
};

const desiredOriginAccessControl = () => ({
  Name: oacName,
  Description: 'SigV4 access from the SquadHunt Clip media distribution to S3',
  SigningProtocol: 'sigv4',
  SigningBehavior: 'always',
  OriginAccessControlOriginType: 's3'
});

const desiredEdgeFunctionCode = () => {
  const allowlist = Object.fromEntries(allowedOrigins.map(origin => [origin, true]));
  return `function handler(event) {
  var response = event.response;
  var originHeader = event.request.headers.origin;
  var origin = originHeader ? originHeader.value : '';
  var allowedOrigins = ${JSON.stringify(allowlist)};
  if (allowedOrigins[origin]) {
    response.headers['access-control-allow-origin'] = { value: origin };
    response.headers['access-control-allow-methods'] = { value: 'GET, HEAD, OPTIONS' };
    response.headers['access-control-allow-headers'] = { value: 'Range' };
    response.headers['access-control-expose-headers'] = { value: 'Accept-Ranges, Content-Length, Content-Range, ETag, Age, X-Cache' };
    response.headers['access-control-max-age'] = { value: '86400' };
    response.headers.vary = { value: 'Origin' };
  } else {
    delete response.headers['access-control-allow-origin'];
    delete response.headers['access-control-allow-methods'];
    delete response.headers['access-control-allow-headers'];
    delete response.headers['access-control-expose-headers'];
    delete response.headers['access-control-max-age'];
  }
  delete response.headers['access-control-allow-credentials'];
  response.headers['accept-ranges'] = { value: 'bytes' };
  response.headers['strict-transport-security'] = { value: 'max-age=31536000; includeSubDomains' };
  response.headers['x-content-type-options'] = { value: 'nosniff' };
  return response;
}`;
};

const ensurePublishedEdgeFunction = () => {
  const functionConfig = {
    Comment: 'Exact-origin CORS and Range-header visibility for public SquadHunt Clip media',
    Runtime: 'cloudfront-js-2.0'
  };
  const code = Buffer.from(desiredEdgeFunctionCode()).toString('base64');
  const development = aws([
    'cloudfront', 'describe-function', '--name', edgeFunctionName, '--stage', 'DEVELOPMENT'
  ], { allowFailure: true });
  if (development?.ETag) {
    aws([
      'cloudfront', 'update-function',
      '--name', edgeFunctionName,
      '--if-match', development.ETag,
      '--function-config', JSON.stringify(functionConfig),
      '--function-code', code
    ]);
  } else {
    aws([
      'cloudfront', 'create-function',
      '--name', edgeFunctionName,
      '--function-config', JSON.stringify(functionConfig),
      '--function-code', code
    ]);
  }
  const publishable = aws([
    'cloudfront', 'describe-function', '--name', edgeFunctionName, '--stage', 'DEVELOPMENT'
  ]);
  aws([
    'cloudfront', 'publish-function',
    '--name', edgeFunctionName,
    '--if-match', publishable.ETag
  ]);
  const live = aws([
    'cloudfront', 'describe-function', '--name', edgeFunctionName, '--stage', 'LIVE'
  ]);
  return live.FunctionSummary;
};

const desiredDistribution = ({ edgeFunctionArn, oacId }) => ({
  CallerReference: `squadhunt-clip-media-${Date.now()}`,
  Aliases: { Quantity: 0 },
  DefaultRootObject: '',
  Origins: {
    Quantity: 1,
    Items: [{
      Id: originId,
      DomainName: originDomain,
      OriginPath: '',
      CustomHeaders: { Quantity: 0 },
      S3OriginConfig: { OriginAccessIdentity: '' },
      ConnectionAttempts: 3,
      ConnectionTimeout: 10,
      OriginShield: { Enabled: false },
      OriginAccessControlId: oacId
    }]
  },
  OriginGroups: { Quantity: 0 },
  DefaultCacheBehavior: {
    TargetOriginId: originId,
    TrustedSigners: { Enabled: false, Quantity: 0 },
    TrustedKeyGroups: { Enabled: false, Quantity: 0 },
    ViewerProtocolPolicy: 'redirect-to-https',
    AllowedMethods: {
      Quantity: 3,
      Items: ['GET', 'HEAD', 'OPTIONS'],
      CachedMethods: { Quantity: 2, Items: ['GET', 'HEAD'] }
    },
    SmoothStreaming: false,
    Compress: true,
    LambdaFunctionAssociations: { Quantity: 0 },
    FunctionAssociations: {
      Quantity: 1,
      Items: [{ FunctionARN: edgeFunctionArn, EventType: 'viewer-response' }]
    },
    FieldLevelEncryptionId: '',
    CachePolicyId: cachePolicyId,
    OriginRequestPolicyId: originRequestPolicyId,
    GrpcConfig: { Enabled: false }
  },
  CacheBehaviors: { Quantity: 0 },
  CustomErrorResponses: { Quantity: 0 },
  Comment: distributionComment,
  Logging: { Enabled: false, IncludeCookies: false, Bucket: '', Prefix: '' },
  PriceClass: priceClass,
  Enabled: true,
  ViewerCertificate: {
    CloudFrontDefaultCertificate: true,
    MinimumProtocolVersion: 'TLSv1',
    CertificateSource: 'cloudfront'
  },
  Restrictions: { GeoRestriction: { RestrictionType: 'none', Quantity: 0 } },
  WebACLId: '',
  HttpVersion: 'http2and3',
  IsIPV6Enabled: true,
  Staging: false
});

const mergeBucketPolicy = ({ accountId, distributionId }) => {
  const current = aws(['s3api', 'get-bucket-policy', '--bucket', bucket], { allowFailure: true });
  let policy = { Version: '2012-10-17', Statement: [] };
  if (current?.Policy) policy = JSON.parse(current.Policy);
  const statements = Array.isArray(policy.Statement) ? policy.Statement : [policy.Statement].filter(Boolean);
  const sid = 'AllowSquadHuntClipCloudFrontRead';
  const sourceArn = `arn:aws:cloudfront::${accountId}:distribution/${distributionId}`;
  const asArray = value => Array.isArray(value) ? value : [value].filter(Boolean);
  const isEquivalentCloudFrontGrant = item => {
    const principalServices = asArray(item?.Principal?.Service);
    const actions = asArray(item?.Action);
    const resources = asArray(item?.Resource);
    const conditionSourceArns = [
      ...asArray(item?.Condition?.StringEquals?.['AWS:SourceArn']),
      ...asArray(item?.Condition?.ArnLike?.['AWS:SourceArn'])
    ];
    return item?.Effect === 'Allow'
      && principalServices.includes('cloudfront.amazonaws.com')
      && actions.includes('s3:GetObject')
      && resources.includes(`arn:aws:s3:::${bucket}/*`)
      && conditionSourceArns.includes(sourceArn);
  };
  const existingEquivalentGrant = statements.find(item => (
    item?.Sid !== sid && isEquivalentCloudFrontGrant(item)
  ));
  const statement = {
    Sid: sid,
    Effect: 'Allow',
    Principal: { Service: 'cloudfront.amazonaws.com' },
    Action: 's3:GetObject',
    Resource: `arn:aws:s3:::${bucket}/*`,
    Condition: {
      StringEquals: {
        'AWS:SourceArn': sourceArn
      }
    }
  };
  // The AWS console may have already installed an equivalent OAC grant. Keep
  // that statement and remove our managed duplicate instead of accumulating
  // multiple permissions for the same distribution.
  policy.Statement = existingEquivalentGrant
    ? statements.filter(item => item?.Sid !== sid)
    : [...statements.filter(item => item?.Sid !== sid), statement];
  aws([
    's3api', 'put-bucket-policy',
    '--bucket', bucket,
    '--policy', JSON.stringify(policy),
    '--region', region
  ]);
};

const provision = () => {
  let state = loadState();
  state.edgeFunction = ensurePublishedEdgeFunction();
  if (!state.originAccessControl) {
    const created = aws([
      'cloudfront', 'create-origin-access-control',
      '--origin-access-control-config', JSON.stringify(desiredOriginAccessControl())
    ]);
    state.originAccessControl = created.OriginAccessControl;
  }
  if (!state.distribution) {
    const created = aws([
      'cloudfront', 'create-distribution',
      '--distribution-config', JSON.stringify(desiredDistribution({
        edgeFunctionArn: state.edgeFunction.FunctionMetadata.FunctionARN,
        oacId: state.originAccessControl.Id
      }))
    ]);
    state.distribution = created.Distribution;
  }
  const current = aws(['cloudfront', 'get-distribution-config', '--id', state.distribution.Id]);
  const config = current.DistributionConfig;
  const origin = config.Origins?.Items?.find(item => item.DomainName === originDomain);
  if (!origin) throw new Error(`Distribution ${state.distribution.Id} does not use the expected S3 origin`);
  origin.OriginAccessControlId = state.originAccessControl.Id;
  const behavior = config.DefaultCacheBehavior;
  behavior.TargetOriginId = origin.Id;
  behavior.ViewerProtocolPolicy = 'redirect-to-https';
  behavior.CachePolicyId = cachePolicyId;
  behavior.OriginRequestPolicyId = originRequestPolicyId;
  delete behavior.ResponseHeadersPolicyId;
  const associations = behavior.FunctionAssociations?.Items || [];
  const otherViewerResponse = associations.find(item => (
    item.EventType === 'viewer-response'
    && item.FunctionARN !== state.edgeFunction.FunctionMetadata.FunctionARN
  ));
  if (otherViewerResponse) {
    throw new Error(`Distribution already has another viewer-response function: ${otherViewerResponse.FunctionARN}`);
  }
  const nextAssociations = [
    ...associations.filter(item => item.EventType !== 'viewer-response'),
    {
      EventType: 'viewer-response',
      FunctionARN: state.edgeFunction.FunctionMetadata.FunctionARN
    }
  ];
  behavior.FunctionAssociations = { Quantity: nextAssociations.length, Items: nextAssociations };
  behavior.AllowedMethods = {
    Quantity: 3,
    Items: ['GET', 'HEAD', 'OPTIONS'],
    CachedMethods: { Quantity: 2, Items: ['GET', 'HEAD'] }
  };
  behavior.Compress = true;
  behavior.SmoothStreaming = false;
  behavior.GrpcConfig = { Enabled: false };
  delete behavior.ForwardedValues;
  delete behavior.MinTTL;
  delete behavior.DefaultTTL;
  delete behavior.MaxTTL;
  config.HttpVersion = 'http2and3';
  if (!config.Comment) config.Comment = distributionComment;
  aws([
    'cloudfront', 'update-distribution',
    '--id', state.distribution.Id,
    '--if-match', current.ETag,
    '--distribution-config', JSON.stringify(config)
  ]);
  const identity = aws(['sts', 'get-caller-identity']);
  mergeBucketPolicy({ accountId: identity.Account, distributionId: state.distribution.Id });
  aws([
    'cloudfront', 'tag-resource',
    '--resource', state.distribution.ARN,
    '--tags', JSON.stringify({ Items: [
      { Key: 'Application', Value: 'SquadHunt' },
      { Key: 'Purpose', Value: 'ClipMediaDelivery' }
    ] })
  ]);
  return loadState();
};

const summarize = (state) => {
  const behavior = state.distribution?.DefaultCacheBehavior;
  const origin = state.distribution?.Origins?.Items?.find(item => item.Id === behavior?.TargetOriginId)
    || state.distribution?.Origins?.Items?.[0];
  const compliant = Boolean(
    state.distribution
    && state.cachePolicy
    && state.edgeFunction
    && state.originAccessControl
    && origin?.DomainName === originDomain
    && origin?.OriginAccessControlId === state.originAccessControl.Id
    && behavior?.CachePolicyId === cachePolicyId
    && behavior?.OriginRequestPolicyId === originRequestPolicyId
    && behavior?.FunctionAssociations?.Items?.some(item => (
      item.EventType === 'viewer-response'
      && item.FunctionARN === state.edgeFunction.FunctionMetadata.FunctionARN
    ))
    && behavior?.ViewerProtocolPolicy === 'redirect-to-https'
    && state.distribution.Enabled
  );
  return {
    mode: apply ? 'apply' : verify ? 'verify' : activateEcs ? 'activate-ecs' : 'audit-only',
    bucket,
    originDomain,
    publicBucketCompatibilityRetained: true,
    distribution: state.distribution ? {
      id: state.distribution.Id,
      domainName: state.distribution.DomainName,
      status: state.distribution.Status,
      enabled: state.distribution.Enabled,
      priceClass: state.distribution.PriceClass,
      httpVersion: state.distribution.HttpVersion
    } : null,
    pricingPlan: state.pricingPlan ? {
      tier: state.pricingPlan.planTier,
      status: state.pricingPlan.status
    } : null,
    cachePolicyId: state.cachePolicy?.Id || null,
    cachePolicyName: state.cachePolicy?.CachePolicyConfig?.Name || null,
    originRequestPolicyId: behavior?.OriginRequestPolicyId || null,
    responseHeadersPolicyId: behavior?.ResponseHeadersPolicyId || null,
    edgeFunctionArn: state.edgeFunction?.FunctionMetadata?.FunctionARN || null,
    originAccessControlId: state.originAccessControl?.Id || null,
    queryStringsInCacheKey: false,
    originHeaderInCacheKey: false,
    immutableMaxTtlSeconds: 31536000,
    compliant
  };
};

const findSampleKey = () => {
  if (process.env.CLIP_MEDIA_SAMPLE_KEY) return process.env.CLIP_MEDIA_SAMPLE_KEY;
  const listed = aws([
    's3api', 'list-objects-v2',
    '--bucket', bucket,
    '--prefix', 'gaming-social/posts/',
    '--max-keys', '100',
    '--region', region
  ]);
  const object = (listed.Contents || []).find(item => String(item.Key || '').toLowerCase().endsWith('.mp4'));
  if (!object?.Key) throw new Error('No MP4 sample found; set CLIP_MEDIA_SAMPLE_KEY');
  return object.Key;
};

const rangeProbe = async (baseUrl, objectKey, origin = 'https://www.squadhunt.com') => {
  const startedAt = performance.now();
  const response = await fetch(`${baseUrl.replace(/\/$/, '')}/${objectKey}`, {
    headers: {
      Range: 'bytes=0-1048575',
      Origin: origin
    }
  });
  const headersAt = performance.now();
  const body = await response.arrayBuffer();
  const completedAt = performance.now();
  return {
    status: response.status,
    ttfbMs: Math.round(headersAt - startedAt),
    totalMs: Math.round(completedAt - startedAt),
    bytes: body.byteLength,
    acceptRanges: response.headers.get('accept-ranges'),
    contentRange: response.headers.get('content-range'),
    contentLength: response.headers.get('content-length'),
    contentType: response.headers.get('content-type'),
    accessControlAllowOrigin: response.headers.get('access-control-allow-origin'),
    xCache: response.headers.get('x-cache'),
    age: response.headers.get('age'),
    serverTiming: response.headers.get('server-timing')
  };
};

const preflightProbe = async (baseUrl, objectKey, origin = 'https://www.squadhunt.com') => {
  const startedAt = performance.now();
  const response = await fetch(`${baseUrl.replace(/\/$/, '')}/${objectKey}`, {
    method: 'OPTIONS',
    headers: {
      Origin: origin,
      'Access-Control-Request-Method': 'GET',
      'Access-Control-Request-Headers': 'Range'
    }
  });
  return {
    status: response.status,
    totalMs: Math.round(performance.now() - startedAt),
    accessControlAllowOrigin: response.headers.get('access-control-allow-origin'),
    accessControlAllowMethods: response.headers.get('access-control-allow-methods'),
    accessControlAllowHeaders: response.headers.get('access-control-allow-headers'),
    vary: response.headers.get('vary'),
    xCache: response.headers.get('x-cache')
  };
};

const verifyDistribution = async (state) => {
  const summary = summarize(state);
  if (!summary.compliant) throw new Error('CloudFront resources are missing or do not match the expected safe configuration');
  if (state.distribution.Status !== 'Deployed') {
    throw new Error(`CloudFront distribution is ${state.distribution.Status}; wait until it is Deployed`);
  }
  const objectKey = findSampleKey();
  const baseUrl = `https://${state.distribution.DomainName}`;
  const first = await rangeProbe(baseUrl, objectKey);
  const second = await rangeProbe(baseUrl, objectKey);
  const alternateAllowedOrigin = await rangeProbe(baseUrl, objectKey, 'https://squadhunt.in');
  const disallowedOrigin = await rangeProbe(baseUrl, objectKey, 'https://evil.example');
  const preflight = await preflightProbe(baseUrl, objectKey);
  for (const [name, result] of [['first', first], ['second', second]]) {
    if (
      result.status !== 206
      || result.acceptRanges !== 'bytes'
      || !String(result.contentRange || '').startsWith('bytes 0-1048575/')
      || result.contentType !== 'video/mp4'
      || result.bytes !== 1048576
      || result.accessControlAllowOrigin !== 'https://www.squadhunt.com'
    ) throw new Error(`${name} CloudFront Range probe failed: ${JSON.stringify(result)}`);
  }
  if (alternateAllowedOrigin.accessControlAllowOrigin !== 'https://squadhunt.in') {
    throw new Error(`Alternate allowed-origin probe failed: ${JSON.stringify(alternateAllowedOrigin)}`);
  }
  if (disallowedOrigin.accessControlAllowOrigin) {
    throw new Error(`Disallowed origin received CORS access: ${JSON.stringify(disallowedOrigin)}`);
  }
  if (
    preflight.status < 200
    || preflight.status >= 300
    || preflight.accessControlAllowOrigin !== 'https://www.squadhunt.com'
    || !String(preflight.accessControlAllowMethods || '').includes('GET')
    || !String(preflight.accessControlAllowHeaders || '').toLowerCase().includes('range')
  ) throw new Error(`CloudFront CORS preflight failed: ${JSON.stringify(preflight)}`);
  return { objectKey, first, second, alternateAllowedOrigin, disallowedOrigin, preflight };
};

const activateEcsService = (cdnUrl) => {
  const service = aws(['ecs', 'describe-services', '--cluster', ecsCluster, '--services', ecsService]);
  const taskDefinitionArn = service.services?.[0]?.taskDefinition;
  if (!taskDefinitionArn) throw new Error(`ECS service ${ecsCluster}/${ecsService} was not found`);
  const described = aws(['ecs', 'describe-task-definition', '--task-definition', taskDefinitionArn]);
  const taskDefinition = described.taskDefinition;
  const container = taskDefinition.containerDefinitions?.find(item => item.name === ecsContainer);
  if (!container) throw new Error(`Container ${ecsContainer} was not found in ${taskDefinitionArn}`);
  const environment = container.environment || [];
  const existing = environment.find(item => item.name === 'AWS_S3_CDN_URL');
  if (existing?.value === cdnUrl) {
    return { changed: false, taskDefinition: taskDefinitionArn, cdnUrl };
  }
  if (existing) existing.value = cdnUrl;
  else environment.push({ name: 'AWS_S3_CDN_URL', value: cdnUrl });
  container.environment = environment;
  for (const key of [
    'taskDefinitionArn', 'revision', 'status', 'requiresAttributes',
    'compatibilities', 'registeredAt', 'registeredBy', 'deregisteredAt'
  ]) delete taskDefinition[key];
  const registered = aws([
    'ecs', 'register-task-definition',
    '--cli-input-json', JSON.stringify(taskDefinition)
  ]);
  const nextArn = registered.taskDefinition?.taskDefinitionArn;
  if (!nextArn) throw new Error('ECS did not return the registered task definition ARN');
  aws([
    'ecs', 'update-service',
    '--cluster', ecsCluster,
    '--service', ecsService,
    '--task-definition', nextArn,
    '--force-new-deployment'
  ]);
  return { changed: true, previousTaskDefinition: taskDefinitionArn, taskDefinition: nextArn, cdnUrl };
};

const main = async () => {
  let state = loadState();
  if (apply) state = provision();
  const summary = summarize(state);
  let rangeVerification = null;
  let ecsActivation = null;
  if (verify || activateEcs) rangeVerification = await verifyDistribution(state);
  if (activateEcs) ecsActivation = activateEcsService(`https://${state.distribution.DomainName}`);
  console.log(JSON.stringify({ ...summary, rangeVerification, ecsActivation }, null, 2));
  if (!apply && !verify && !activateEcs) console.log('No AWS resource was changed.');
  if (verify && !summary.compliant) process.exitCode = 2;
};

main().catch(error => {
  console.error(String(error?.stack || error));
  process.exitCode = 1;
});
