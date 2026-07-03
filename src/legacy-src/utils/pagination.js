const toPositiveInteger = (value, fallback) => {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
};

const normalizePagination = (query = {}, options = {}) => {
  const defaultLimit = toPositiveInteger(options.defaultLimit, 20);
  const maxLimit = Math.max(defaultLimit, toPositiveInteger(options.maxLimit, 100));
  // Offset pagination becomes prohibitively expensive at very deep pages.
  // Cursor-based endpoints can opt into their own policy; legacy offset lists
  // are bounded to keep a single request from forcing multi-million-row skips.
  const maxPage = toPositiveInteger(options.maxPage, 10000);
  const page = Math.min(toPositiveInteger(query.page, 1), maxPage);
  const requestedLimit = toPositiveInteger(query.limit, defaultLimit);
  const limit = Math.min(requestedLimit, maxLimit);
  return { page, limit, skip: (page - 1) * limit };
};

module.exports = { normalizePagination };
