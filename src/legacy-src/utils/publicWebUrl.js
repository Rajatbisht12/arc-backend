const CANONICAL_PUBLIC_WEB_ORIGIN = 'https://www.squadhunt.com';
const PUBLIC_WEB_HOSTS = new Set([
  'squadhunt.com',
  'www.squadhunt.com',
  // Accepted only to normalize legacy generated/stored public links.
  'squadhunt.in',
  'www.squadhunt.in'
]);

const isSquadHuntPublicWebHost = (hostname) => (
  PUBLIC_WEB_HOSTS.has(String(hostname || '').split(':')[0].toLowerCase())
);

const canonicalizePublicWebUrl = (value) => {
  if (typeof value !== 'string' || !value.trim()) return value || '';
  try {
    const parsed = new URL(value.trim());
    if (!isSquadHuntPublicWebHost(parsed.hostname)) return value.trim();
    return `${CANONICAL_PUBLIC_WEB_ORIGIN}${parsed.pathname}${parsed.search}${parsed.hash}`;
  } catch {
    return value.trim();
  }
};

const resolvePublicWebOrigin = (configuredOrigin) => {
  const value = String(configuredOrigin || '').trim();
  if (!value) return CANONICAL_PUBLIC_WEB_ORIGIN;
  try {
    const parsed = new URL(value);
    if (isSquadHuntPublicWebHost(parsed.hostname)) return CANONICAL_PUBLIC_WEB_ORIGIN;
    const basePath = parsed.pathname === '/' ? '' : parsed.pathname.replace(/\/+$/, '');
    return `${parsed.origin}${basePath}`;
  } catch {
    return CANONICAL_PUBLIC_WEB_ORIGIN;
  }
};

module.exports = {
  CANONICAL_PUBLIC_WEB_ORIGIN,
  canonicalizePublicWebUrl,
  isSquadHuntPublicWebHost,
  resolvePublicWebOrigin
};
