const STORY_FONTS = ['Montserrat', 'Bebas Neue', 'Imperial Script', 'Lobster', 'Story Script'];
const STORY_COLORS = ['#000000', '#FFFFFF', '#8B5CF6', '#4F46E5', '#2563EB', '#16A34A', '#FACC15', '#F97316', '#EF4444'];
const MAX_STORY_TEXT_OVERLAYS = 20;
const MAX_STORY_TEXT_LENGTH = 500;

const invalid = (message = 'Story text overlays are invalid.') => {
  const error = new Error(message);
  error.statusCode = 400;
  error.code = 'STORY_OVERLAYS_INVALID';
  return error;
};

const parseStoryOverlays = (raw) => {
  if (raw == null || raw === '') return [];
  let value = raw;
  if (typeof value === 'string') {
    try { value = JSON.parse(value); } catch (_) { throw invalid(); }
  }
  if (!Array.isArray(value) || value.length > MAX_STORY_TEXT_OVERLAYS) throw invalid('A Story can contain up to 20 text elements.');
  const ids = new Set();
  return value.map((entry) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry) || !['text', 'link'].includes(entry.type)) throw invalid();
    const { id, text, font, color, x, y, scale } = entry;
    const v2 = entry.version === 2;
    if ((entry.version !== undefined && !v2) || (entry.type === 'link' && !v2)) throw invalid();
    if (typeof id !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/.test(id) || ids.has(id)) throw invalid();
    ids.add(id);
    if (typeof text !== 'string' || !text.trim() || text.length > MAX_STORY_TEXT_LENGTH || /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(text)) {
      throw invalid('Story text must be 1–500 characters.');
    }
    if (!STORY_FONTS.includes(font) || !STORY_COLORS.includes(color)) throw invalid();
    if (![x, y, scale].every((number) => typeof number === 'number' && Number.isFinite(number))) throw invalid();
    if (x < 0 || x > 1 || y < 0 || y > 1 || scale < 0.5 || scale > 3) throw invalid();
    const result = { id, type: entry.type, text, font, color, x, y, scale };
    if (v2) {
      if (entry.coordinateSpace !== 'media' || typeof entry.fontSize !== 'number' || !Number.isFinite(entry.fontSize)
        || entry.fontSize < 15 || entry.fontSize > 90 || Math.abs(entry.fontSize - 30 * scale) > 0.0001
        || !['left', 'center', 'right'].includes(entry.textAlign)) throw invalid();
      Object.assign(result, { version: 2, coordinateSpace: 'media', fontSize: entry.fontSize, textAlign: entry.textAlign });
    }
    if (entry.type === 'link') {
      const url = safeStoryUrl(entry.url);
      if (!url || typeof entry.label !== 'string' || !entry.label.trim() || entry.label.length > 80 || /[\x00-\x1f\x7f]/.test(entry.label)) throw invalid('Story link is invalid.');
      Object.assign(result, { url, label: entry.label.trim() });
    }
    return result;
  });
};

function safeStoryUrl(value) {
  if (typeof value !== 'string' || value.length > 2048 || /[\s\x00-\x1f\x7f]/.test(value)) return null;
  try { const url = new URL(value); return ['http:', 'https:'].includes(url.protocol) && url.hostname && !url.username && !url.password ? url.toString() : null; } catch { return null; }
}

module.exports = { parseStoryOverlays, STORY_FONTS, STORY_COLORS, MAX_STORY_TEXT_OVERLAYS };
