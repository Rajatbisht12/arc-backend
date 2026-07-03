const DEFAULT_ALLOWED_AVATAR_HOSTS = Object.freeze([
  'googleusercontent.com',
  'res.cloudinary.com'
]);

const configuredHosts = () => String(process.env.AVATAR_PROXY_ALLOWED_HOSTS || '')
  .split(',')
  .map((host) => host.trim().toLowerCase().replace(/\.$/, ''))
  .filter(Boolean);

const isHostAllowed = (hostname, allowedHosts) => allowedHosts.some((allowedHost) => (
  hostname === allowedHost || hostname.endsWith(`.${allowedHost}`)
));

const parseAllowedAvatarUrl = (value) => {
  if (typeof value !== 'string' || !value.trim()) return null;
  let parsed;
  try {
    parsed = new URL(value.trim());
  } catch (_error) {
    return null;
  }

  if (parsed.protocol !== 'https:' || parsed.username || parsed.password) return null;
  if (parsed.port && parsed.port !== '443') return null;
  const hostname = parsed.hostname.toLowerCase().replace(/\.$/, '');
  const allowedHosts = [...DEFAULT_ALLOWED_AVATAR_HOSTS, ...configuredHosts()];
  if (!hostname || !isHostAllowed(hostname, allowedHosts)) return null;
  return parsed;
};

module.exports = {
  DEFAULT_ALLOWED_AVATAR_HOSTS,
  parseAllowedAvatarUrl
};
