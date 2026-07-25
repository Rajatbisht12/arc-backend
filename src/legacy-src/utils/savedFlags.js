const User = require('../models/User');

// Stamp the viewer's saved-state onto post DTOs so every surface (feed,
// profile, search, detail, liked, saved) reports the same bookmark truth.
// Guests and anonymous viewers never get saved flags.
async function attachIsSavedFlags(postDtos, viewer) {
  const dtos = Array.isArray(postDtos) ? postDtos.filter(Boolean) : [];
  if (dtos.length === 0) return postDtos;
  const isGuest = !viewer || !viewer._id || viewer.userType === 'guest';
  if (isGuest) {
    dtos.forEach((dto) => { dto.isSaved = false; });
    return postDtos;
  }

  const owner = await User.findById(viewer._id)
    .select('savedPosts.post')
    .lean()
    .catch(() => null);
  const savedIds = new Set(
    (owner?.savedPosts || [])
      .map((item) => (item?.post?._id || item?.post))
      .filter(Boolean)
      .map((id) => id.toString())
  );
  dtos.forEach((dto) => {
    const dtoId = dto._id || dto.id;
    dto.isSaved = Boolean(dtoId && savedIds.has(dtoId.toString()));
  });
  return postDtos;
}

module.exports = { attachIsSavedFlags };
