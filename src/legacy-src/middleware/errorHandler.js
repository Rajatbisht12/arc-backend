// Global error handler middleware. Controllers should forward unexpected
// failures here so HTTP/parser/Mongoose errors are classified consistently and
// internal provider/database messages are never exposed in production.
const errorHandler = (err, req, res, next) => {
  void req;
  void next;
  console.error(err);

  const explicitStatus = Number(err?.statusCode ?? err?.status);
  let statusCode = Number.isInteger(explicitStatus) && explicitStatus >= 400 && explicitStatus <= 599
    ? explicitStatus
    : 500;
  let code = typeof err?.code === 'string' ? err.code : undefined;
  let message = statusCode < 500 && typeof err?.message === 'string'
    ? err.message
    : 'Internal server error';

  if (err?.type === 'entity.parse.failed') {
    statusCode = 400;
    code = 'INVALID_JSON';
    message = 'Request body contains invalid JSON';
  } else if (err?.type === 'entity.too.large' || statusCode === 413) {
    statusCode = 413;
    code = 'PAYLOAD_TOO_LARGE';
    message = 'Request payload is too large';
  } else if (err?.name === 'CastError') {
    statusCode = 400;
    const castPath = String(err?.path || '');
    const isIdentifier = castPath === '_id' || /(?:^|\.)[A-Za-z]*[Ii]d$/.test(castPath);
    code = isIdentifier ? 'INVALID_IDENTIFIER' : 'INVALID_VALUE';
    message = isIdentifier ? 'Invalid resource identifier' : 'Invalid request value';
  } else if (err?.code === 11000) {
    statusCode = 409;
    code = 'RESOURCE_CONFLICT';
    message = 'A resource with that value already exists';
  } else if (err?.name === 'ValidationError') {
    statusCode = 400;
    code = 'VALIDATION_FAILED';
    const validationMessages = Object.values(err.errors || {})
      .map((value) => value?.message)
      .filter(Boolean);
    message = validationMessages.length > 0 ? validationMessages.join(', ') : 'Validation failed';
  } else if (err?.name === 'JsonWebTokenError') {
    statusCode = 401;
    code = 'INVALID_TOKEN';
    message = 'Invalid token';
  } else if (err?.name === 'TokenExpiredError') {
    statusCode = 401;
    code = 'TOKEN_EXPIRED';
    message = 'Token expired';
  }

  const response = {
    success: false,
    message,
    ...(code ? { code } : {}),
    ...(process.env.NODE_ENV === 'development' && err?.stack ? { stack: err.stack } : {})
  };
  return res.status(statusCode).json(response);
};

module.exports = errorHandler;
