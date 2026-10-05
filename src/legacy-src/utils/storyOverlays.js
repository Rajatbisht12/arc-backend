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
    if (!entry || typeof entry !== 'object' || Array.isArray(entry) || entry.type !== 'text') throw invalid();
    const { id, text, font, color, x, y, scale } = entry;
    if (typeof id !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/.test(id) || ids.has(id)) throw invalid();
    ids.add(id);
    if (typeof text !== 'string' || !text.trim() || text.length > MAX_STORY_TEXT_LENGTH || /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(text)) {
      throw invalid('Story text must be 1–500 characters.');
    }
    if (!STORY_FONTS.includes(font) || !STORY_COLORS.includes(color)) throw invalid();
    if (![x, y, scale].every((number) => typeof number === 'number' && Number.isFinite(number))) throw invalid();
    if (x < 0 || x > 1 || y < 0 || y > 1 || scale < 0.5 || scale > 3) throw invalid();
    // Links are derived from validated HTTP(S) text on the viewer. Never accept
    // a client-provided URL or arbitrary layout/style metadata for overlays.
    return { id, type: 'text', text, font, color, x, y, scale };
  });
};

module.exports = { parseStoryOverlays, STORY_FONTS, STORY_COLORS, MAX_STORY_TEXT_OVERLAYS };
