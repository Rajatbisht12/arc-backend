// Enhanced error handling wrapper for async functions
const safeAsyncHandler = (handler) => {
  return async (req, res, next) => {
    try {
      await handler(req, res, next);
    } catch (error) {
      console.error(`🚨 Random Connection Error in ${handler.name || 'unknown'}:`, error);
      
      // Don't crash the server, just log and send error response
      if (!res.headersSent) {
        res.status(500).json({
          success: false,
          message: 'Internal server error occurred',
          error: process.env.NODE_ENV === 'development' ? error.message : 'Something went wrong'
        });
      }
    }
  };
};

module.exports = safeAsyncHandler;
