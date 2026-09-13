const positiveNumber = (value) => {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : null;
};

/**
 * Convert the authoritative storage upload result into the post media shape.
 * Metadata remains optional so legacy media documents stay backwards-compatible.
 */
const toPostMediaItem = (result) => {
  const width = positiveNumber(result?.width);
  const height = positiveNumber(result?.height);
  const duration = positiveNumber(result?.duration);
  return {
    type: result.type,
    url: result.url,
    publicId: result.publicId,
    ...(width && height ? { width, height, aspectRatio: width / height } : {}),
    ...(duration ? { duration } : {})
  };
};

module.exports = { toPostMediaItem };
