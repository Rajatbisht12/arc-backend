const jwt = require('jsonwebtoken');

// Generate JWT token
const generateToken = (payload) => {
  try {
    if (!process.env.JWT_SECRET) {
      throw new Error('JWT_SECRET is not configured');
    }
    
    if (!payload || !payload.id) {
      throw new Error('Invalid payload for token generation');
    }
    
    return jwt.sign(payload, process.env.JWT_SECRET, {
      expiresIn: process.env.JWT_EXPIRE || '7d'
    });
  } catch (error) {
    console.error('Token generation error:', error);
    throw new Error('Failed to generate token');
  }
};

// Verify JWT token
const verifyToken = (token) => {
  try {
    if (!process.env.JWT_SECRET) {
      throw new Error('JWT_SECRET is not configured');
    }
    
    if (!token || typeof token !== 'string') {
      throw new Error('Invalid token format');
    }
    
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    
    if (!decoded || !decoded.id) {
      throw new Error('Invalid token payload');
    }
    
    return decoded;
  } catch (error) {
    if (error.name === 'JsonWebTokenError') {
      throw new Error('Invalid token');
    } else if (error.name === 'TokenExpiredError') {
      throw new Error('Token expired');
    } else {
      console.error('Token verification error:', error);
      throw new Error('Token verification failed');
    }
  }
};

// Generate refresh token (longer expiry)
const generateRefreshToken = (payload) => {
  try {
    if (!process.env.JWT_SECRET) {
      throw new Error('JWT_SECRET is not configured');
    }
    
    if (!payload || !payload.id) {
      throw new Error('Invalid payload for refresh token generation');
    }
    
    return jwt.sign(payload, process.env.JWT_SECRET, {
      expiresIn: '30d'
    });
  } catch (error) {
    console.error('Refresh token generation error:', error);
    throw new Error('Failed to generate refresh token');
  }
};

// Extract token from request headers
const extractToken = (req) => {
  try {
    if (!req) {
      return null;
    }
    
    // Check Authorization header first
    const authHeader = req.headers?.authorization;
    
    if (authHeader && authHeader.startsWith('Bearer ')) {
      const token = authHeader.substring(7);
      if (token && token.trim()) {
        return token.trim();
      }
    }
    
    // Check for token in cookies
    if (req.cookies && req.cookies.token) {
      const token = req.cookies.token;
      if (token && token.trim()) {
        return token.trim();
      }
    }
    
    // Check for token in query parameters (for testing purposes)
    if (req.query && req.query.token) {
      const token = req.query.token;
      if (token && token.trim()) {
        return token.trim();
      }
    }
    
    return null;
  } catch (error) {
    console.error('Token extraction error:', error);
    return null;
  }
};

module.exports = {
  generateToken,
  verifyToken,
  generateRefreshToken,
  extractToken
};
