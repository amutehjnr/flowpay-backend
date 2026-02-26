const jwt = require('jsonwebtoken');
const User = require('../models/User');
const Merchant = require('../models/Merchant');
const redisClient = require('../config/redis');
const logger = require('../config/logger');

const authenticateJWT = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'No token provided' });
    }

    const token = authHeader.split(' ')[1];

    // Check if token is blacklisted
    const isBlacklisted = await redisClient.get(`blacklist:${token}`);
    if (isBlacklisted) {
      return res.status(401).json({ error: 'Token has been revoked' });
    }

    // Verify token
    const decoded = jwt.verify(token, process.env.JWT_ACCESS_SECRET);
    
    // Get user
    const user = await User.findById(decoded.userId);
    if (!user) {
      return res.status(401).json({ error: 'User not found' });
    }

    // Check if user is active
    if (!user.isActive) {
      return res.status(403).json({ error: 'Account is deactivated' });
    }

    req.user = user;
    next();
  } catch (error) {
    if (error.name === 'TokenExpiredError') {
      return res.status(401).json({ error: 'Token expired' });
    }
    if (error.name === 'JsonWebTokenError') {
      return res.status(401).json({ error: 'Invalid token' });
    }
    logger.error('Authentication error:', error);
    return res.status(500).json({ error: 'Authentication failed' });
  }
};

const authenticateApiKey = async (req, res, next) => {
  try {
    const apiKey = req.headers['x-api-key'];
    
    if (!apiKey) {
      return res.status(401).json({ error: 'API key required' });
    }

    // Extract key (format: prefix_key)
    const [prefix, key] = apiKey.split('_');
    if (!prefix || !key) {
      return res.status(401).json({ error: 'Invalid API key format' });
    }

    // Find merchant by API key
    const merchant = await Merchant.findOne({ 
      apiKeyPrefix: prefix,
      apiKey: key 
    }).select('+webhookSecret');

    if (!merchant) {
      return res.status(401).json({ error: 'Invalid API key' });
    }

    if (!merchant.isActive) {
      return res.status(403).json({ error: 'Merchant account is deactivated' });
    }

    // Check IP whitelist if configured
    if (merchant.settings.ipWhitelist && merchant.settings.ipWhitelist.length > 0) {
      const clientIp = req.ip || req.connection.remoteAddress;
      if (!merchant.settings.ipWhitelist.includes(clientIp)) {
        logger.warn(`Blocked request from IP ${clientIp} for merchant ${merchant._id}`);
        return res.status(403).json({ error: 'IP not whitelisted' });
      }
    }

    req.merchant = merchant;
    next();
  } catch (error) {
    logger.error('API key authentication error:', error);
    return res.status(500).json({ error: 'Authentication failed' });
  }
};

const requireRole = (roles) => {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    if (!roles.includes(req.user.role)) {
      return res.status(403).json({ error: 'Insufficient permissions' });
    }

    next();
  };
};

const optionalAuth = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    
    if (authHeader && authHeader.startsWith('Bearer ')) {
      const token = authHeader.split(' ')[1];
      const decoded = jwt.verify(token, process.env.JWT_ACCESS_SECRET);
      const user = await User.findById(decoded.userId);
      if (user) {
        req.user = user;
      }
    }
    next();
  } catch (error) {
    // Continue without user
    next();
  }
};

module.exports = {
  authenticateJWT,
  authenticateApiKey,
  requireRole,
  optionalAuth
};