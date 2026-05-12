const { protect } = require('./auth');

// Require admin access - use protect middleware before this, or use requireAdminWithAuth for standalone
const requireAdmin = (req, res, next) => {
  // Check if user is authenticated (should be done by protect middleware before this)
  if (!req.user) {
    return res.status(401).json({
      success: false,
      message: 'Authentication required. Please use protect middleware first.'
    });
  }
  
  // Check if user is admin
  if (req.user.userType !== 'admin') {
    return res.status(403).json({
      success: false,
      message: 'Admin access required. Only administrators can access this resource.'
    });
  }
  
  next();
};

// Standalone admin middleware that includes authentication
const requireAdminWithAuth = async (req, res, next) => {
  // First authenticate
  if (!req.user) {
    return protect(req, res, () => {
      // After authentication, check admin
      if (!req.user || req.user.userType !== 'admin') {
        return res.status(403).json({
          success: false,
          message: 'Admin access required.'
        });
      }
      next();
    });
  }
  
  // User already authenticated, just check admin
  if (req.user.userType !== 'admin') {
    return res.status(403).json({
      success: false,
      message: 'Admin access required.'
    });
  }
  
  next();
};

// Require super admin access (for critical operations)
const requireSuperAdmin = (req, res, next) => {
  // First check admin access
  requireAdmin(req, res, () => {
    // Check for super admin role
    if (!req.user.isSuperUser) {
      return res.status(403).json({
        success: false,
        message: 'Super admin access required for this operation.'
      });
    }
    
    next();
  });
};

// Log admin actions for audit
const auditLog = (action) => {
  return (req, res, next) => {
    const originalSend = res.send;
    
    res.send = function(data) {
      // Log admin action
      console.log(`[ADMIN ACTION] ${action} - User: ${req.user?.username} (${req.user?._id}) - IP: ${req.ip} - Time: ${new Date().toISOString()}`);
      
      // Call original send
      originalSend.call(this, data);
    };
    
    next();
  };
};

module.exports = { 
  requireAdmin, 
  requireAdminWithAuth,
  requireSuperAdmin, 
  auditLog 
};
