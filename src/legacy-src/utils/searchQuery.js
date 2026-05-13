const normalizeQuerySearch = (value) => {
  const raw = value ?? '';
  const normalized = Array.isArray(raw) ? raw[0] : raw;
  return typeof normalized === 'string' ? normalized.trim() : '';
};

const escapeRegex = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

module.exports = {
  normalizeQuerySearch,
  escapeRegex,
};
