// Enhanced error handling wrapper for async functions
const safeAsyncHandler = (handler) => {
  return async (req, res, next) => {
    try {
      await handler(req, res, next);
    } catch (error) {
      console.error(`Unhandled API error in ${handler.name || 'anonymous handler'}:`, error);
      if (res.headersSent) return next(error);
      // Preserve the original error. The global error middleware maps known
      // Mongoose/parser/auth failures to their recoverable HTTP status.
      return next(error);
    }
  };
};

module.exports = safeAsyncHandler;
