/**
 * The one audio rule for posts, shared by Web, App and Backend.
 * Mirrors frontend/src/features/post-audio/postAudioRules.ts.
 *
 * Platform music and a video's native audio are MUTUALLY EXCLUSIVE. The server
 * enforces the half of that rule which clients must not be trusted with:
 * a post with no image has nothing for a music track to play over, so the
 * attachment is stripped rather than stored.
 */

const typeOf = (item) => String((item && item.type) || '').toLowerCase();

const isImageMedia = (item) => typeOf(item) === 'image';
const isVideoMedia = (item) => typeOf(item) === 'video';

/**
 * Allowed when at least one IMAGE is present. Deliberately NOT "no videos":
 * a mixed carousel keeps music because its images still need it. A post with no
 * media at all (text-only) keeps music — that predates carousels.
 */
function isMusicAllowedForMedia(media) {
  const items = Array.isArray(media) ? media : [];
  if (items.length === 0) return true;
  return items.some(isImageMedia);
}

/** The single source that may be audible for the active item. */
function resolvePostAudioSource(activeMedia, hasMusic) {
  if (isVideoMedia(activeMedia)) return 'video';
  return hasMusic ? 'music' : 'none';
}

module.exports = { isImageMedia, isVideoMedia, isMusicAllowedForMedia, resolvePostAudioSource };
