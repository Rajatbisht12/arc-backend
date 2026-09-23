const { extractHashtags, mergeTags } = require('./hashtags');

const sameTags = (left, right) => (
  Array.isArray(left)
  && left.length === right.length
  && left.every((value, index) => value === right[index])
);

/**
 * Produce the smallest safe repair for one historical post. Existing tag
 * relationships are retained (some were supplied explicitly by clients),
 * normalized/deduplicated, and every hashtag currently present in the caption
 * is added. The repair never guesses that an existing relationship is stale.
 */
function analyzePostHashtags(post) {
  const caption = typeof post?.content?.text === 'string' ? post.content.text : '';
  const existingTags = Array.isArray(post?.tags) ? post.tags : [];
  const captionTags = extractHashtags(caption);
  const normalizedExistingTags = mergeTags(existingTags, '');
  const expectedTags = mergeTags(existingTags, caption);
  const existingSet = new Set(normalizedExistingTags);
  const missingCaptionTags = captionTags.filter((tag) => !existingSet.has(tag));

  return {
    expectedTags,
    missingCaptionTags,
    changed: !sameTags(existingTags, expectedTags),
    normalizationOnly: missingCaptionTags.length === 0 && !sameTags(existingTags, expectedTags),
  };
}

module.exports = { analyzePostHashtags };
