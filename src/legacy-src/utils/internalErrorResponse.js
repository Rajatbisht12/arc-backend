/**
 * Log an unexpected controller failure and return a stable public 500 response.
 *
 * Internal exception details are useful during local development, but must not
 * be exposed by production APIs because database/provider errors can contain
 * collection names, query details, credentials, or other implementation data.
 */
function sendInternalError({ res, log, operation, publicMessage, error }) {
  const diagnostic = error instanceof Error
    ? error.message
    : String(error ?? 'Unknown error');

  log.error(operation, {
    error: diagnostic,
    ...(error instanceof Error && error.stack ? { stack: error.stack } : {})
  });

  return res.status(500).json({
    success: false,
    message: publicMessage,
    ...(process.env.NODE_ENV !== 'production' ? { error: diagnostic } : {})
  });
}

module.exports = { sendInternalError };
