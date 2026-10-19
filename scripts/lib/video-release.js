const { VIDEO_COMPATIBILITY_FLAGS } = require('../../src/legacy-src/config/videoDeploymentPolicy');

const sourceRepository = remote => {
  const normalized = String(remote || '').replace(/^git@github\.com:/, 'https://github.com/');
  const url = new URL(normalized);
  if (url.hostname !== 'github.com' || !/^\/[\w.-]+\/[\w.-]+(?:\.git)?$/.test(url.pathname)) throw new Error('A traceable GitHub source repository is required');
  // Never put credential-bearing Git remotes in image labels or deployment logs.
  return `https://github.com${url.pathname}`;
};

const prepareCompatibilityTaskDefinition = (definition, image) => {
  if (!/@sha256:[a-f0-9]{64}$/.test(image)) throw new Error('Deploy an immutable ECR digest, not a mutable tag');
  const td = JSON.parse(JSON.stringify(definition));
  const container = td.containerDefinitions?.[0];
  if (!container) throw new Error('API task container is missing');
  const current = Object.fromEntries((container.environment || []).map(row => [row.name, row.value]));
  if (current.POST_VIDEO_UPLOADS_ENABLED === 'true' || current.POST_VIDEO_PRIVATE_DELIVERY_ENABLED === 'true'
      || current.CLIP_HLS_WORKER_ENABLED === 'false') {
    throw new Error('Active dedicated/large-video topology requires an explicit drain-aware release, not compatibility deployment');
  }
  if (current.CLIP_HLS_ENABLED === 'false') throw new Error('HLS is deliberately disabled; review before compatibility deployment');
  const pinned = { ...VIDEO_COMPATIBILITY_FLAGS, VIDEO_DEPLOYMENT_MODE: 'compatibility' };
  const environment = container.environment ||= [];
  for (const [name, value] of Object.entries(pinned)) {
    const row = environment.find(item => item.name === name);
    if (row) row.value = value; else environment.push({ name, value });
  }
  container.secrets = (container.secrets || []).filter(row => !(row.name in pinned));
  container.image = image;
  for (const name of ['taskDefinitionArn', 'revision', 'status', 'requiresAttributes', 'compatibilities', 'registeredAt', 'registeredBy']) delete td[name];
  return td;
};

module.exports = { prepareCompatibilityTaskDefinition, sourceRepository };
if (require.main === module) process.stdout.write(sourceRepository(process.argv[2]));
