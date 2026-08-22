const MAX_PROFILE_SOCIAL_LINKS = 3;
const MAX_PROFILE_SOCIAL_LINK_TITLE_LENGTH = 40;
const MAX_PROFILE_SOCIAL_LINK_URL_LENGTH = 2048;

const LEGACY_TITLES = {
  discord: 'Discord',
  steam: 'Steam',
  twitch: 'Twitch'
};

const normalizeUrl = (value) => {
  const trimmed = String(value || '').trim();
  if (!trimmed || trimmed.length > MAX_PROFILE_SOCIAL_LINK_URL_LENGTH) return null;
  const candidate = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  try {
    const parsed = new URL(candidate);
    if (!['http:', 'https:'].includes(parsed.protocol) || !parsed.hostname) return null;
    return parsed.toString();
  } catch {
    return null;
  }
};

const normalizeStructuredLinks = (links) => {
  if (!Array.isArray(links)) {
    const error = new Error('Social links must be an array.');
    error.code = 'INVALID_PROFILE_SOCIAL_LINKS';
    throw error;
  }
  if (links.length > MAX_PROFILE_SOCIAL_LINKS) {
    const error = new Error(`You can add up to ${MAX_PROFILE_SOCIAL_LINKS} social links.`);
    error.code = 'TOO_MANY_PROFILE_SOCIAL_LINKS';
    throw error;
  }

  return links.reduce((result, item) => {
    if (!item || typeof item !== 'object') return result;
    const title = String(item.title || item.label || item.platform || '').trim();
    const rawUrl = String(item.url || '').trim();
    if (!rawUrl) return result;
    if (!title) {
      const error = new Error('Every social link with a URL must have a title.');
      error.code = 'PROFILE_SOCIAL_LINK_TITLE_REQUIRED';
      throw error;
    }
    if (title.length > MAX_PROFILE_SOCIAL_LINK_TITLE_LENGTH) {
      const error = new Error(`Social link titles must be ${MAX_PROFILE_SOCIAL_LINK_TITLE_LENGTH} characters or fewer.`);
      error.code = 'PROFILE_SOCIAL_LINK_TITLE_TOO_LONG';
      throw error;
    }
    const url = normalizeUrl(rawUrl);
    if (!url) {
      const error = new Error('Enter a valid http or https social-link URL.');
      error.code = 'INVALID_PROFILE_SOCIAL_LINK_URL';
      throw error;
    }
    result.push({ title, url });
    return result;
  }, []);
};

const normalizeLegacyFields = (source) => ({
  discord: String(source?.discord || '').trim(),
  steam: String(source?.steam || '').trim(),
  twitch: String(source?.twitch || '').trim()
});

/**
 * New Mobile clients send `links` explicitly. Older Web/Mobile clients do not,
 * so their fixed-field updates retain the previously stored structured list.
 */
const normalizeProfileSocialLinksUpdate = (incoming, existing = {}) => {
  const source = Array.isArray(incoming) ? { links: incoming } : (incoming || {});
  if (!source || typeof source !== 'object') {
    const error = new Error('Invalid social-links payload.');
    error.code = 'INVALID_PROFILE_SOCIAL_LINKS';
    throw error;
  }

  const hasExplicitLinks = Array.isArray(incoming)
    || Object.prototype.hasOwnProperty.call(source, 'links');
  const links = hasExplicitLinks
    ? normalizeStructuredLinks(source.links)
    : Array.isArray(existing?.links)
      ? existing.links.slice(0, MAX_PROFILE_SOCIAL_LINKS).map(link => ({
          title: String(link?.title || '').trim(),
          url: String(link?.url || '').trim()
        })).filter(link => link.title && link.url)
      : [];
  const legacy = normalizeLegacyFields(source);

  // Explicit structured payloads are canonical, but mirror the three legacy
  // titles so existing Web profile surfaces remain backward compatible.
  if (hasExplicitLinks) {
    Object.entries(LEGACY_TITLES).forEach(([key, title]) => {
      legacy[key] = links.find(link => link.title.toLowerCase() === title.toLowerCase())?.url || '';
    });
  }

  return { ...legacy, links };
};

module.exports = {
  MAX_PROFILE_SOCIAL_LINKS,
  MAX_PROFILE_SOCIAL_LINK_TITLE_LENGTH,
  MAX_PROFILE_SOCIAL_LINK_URL_LENGTH,
  normalizeProfileSocialLinksUpdate,
  normalizeUrl
};
