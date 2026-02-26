// middleware/rateLimiter.js
const rateLimit = require('express-rate-limit');
const { RedisStore } = require('rate-limit-redis');
const redisClient = require('../config/redis');
const logger = require('../config/logger');

// Store references to limiter configurations
let apiLimiter = null;
let authLimiter = null;
let webhookLimiter = null;

// Initialize rate limiters after Redis is connected
const initializeRateLimiters = () => {
  // Check if Redis is ready
  if (!redisClient.isReady()) {
    const status = redisClient.getStatus();
    throw new Error(`Redis client not ready. Current status: ${JSON.stringify(status)}`);
  }

  logger.info('Initializing rate limiters with Redis...');

  // Create sendCommand function for RedisStore
  const sendCommand = async (...args) => {
    try {
      // args format from rate-limiter-redis: [command, ...args]
      const command = args[0];
      const commandArgs = args.slice(1);
      
      logger.debug(`Rate limiter executing Redis command: ${command}`);
      return await redisClient.sendCommand(command, ...commandArgs);
    } catch (error) {
      logger.error('Rate limiter Redis command error:', error);
      throw error;
    }
  };

  // General API rate limiter
  apiLimiter = rateLimit({
    store: new RedisStore({
      sendCommand,
      prefix: 'rl:api:'
    }),
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 100, // Limit each IP to 100 requests per windowMs
    message: {
      error: 'Too many requests, please try again later.',
      code: 'RATE_LIMIT_EXCEEDED'
    },
    standardHeaders: true, // Return rate limit info in the `RateLimit-*` headers
    legacyHeaders: false, // Disable the `X-RateLimit-*` headers
    skipFailedRequests: false, // Do not count failed requests
    skipSuccessfulRequests: false, // Do not skip successful requests
    keyGenerator: (req) => {
      // Use user ID if authenticated, otherwise IP
      return req.user?.id || req.ip;
    },
    handler: (req, res) => {
      logger.warn(`Rate limit exceeded for IP: ${req.ip}`);
      res.status(429).json({
        error: 'Too many requests, please try again later.',
        code: 'RATE_LIMIT_EXCEEDED'
      });
    }
  });

  // Strict limiter for authentication endpoints
  authLimiter = rateLimit({
    store: new RedisStore({
      sendCommand,
      prefix: 'rl:auth:'
    }),
    windowMs: 60 * 60 * 1000, // 1 hour
    max: 5, // Limit each IP to 5 login attempts per hour
    skipSuccessfulRequests: true, // Don't count successful logins
    message: {
      error: 'Too many authentication attempts, please try again later.',
      code: 'AUTH_RATE_LIMIT_EXCEEDED'
    },
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req) => {
      // Use email from request body if available, otherwise IP
      return req.body?.email || req.ip;
    },
    handler: (req, res) => {
      logger.warn(`Auth rate limit exceeded for: ${req.body?.email || req.ip}`);
      res.status(429).json({
        error: 'Too many authentication attempts, please try again later.',
        code: 'AUTH_RATE_LIMIT_EXCEEDED'
      });
    }
  });

  // Webhook endpoint limiter
  webhookLimiter = rateLimit({
    store: new RedisStore({
      sendCommand,
      prefix: 'rl:webhook:'
    }),
    windowMs: 60 * 1000, // 1 minute
    max: 30, // Limit each IP to 30 webhook requests per minute
    message: {
      error: 'Too many webhook requests.',
      code: 'WEBHOOK_RATE_LIMIT_EXCEEDED'
    },
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req) => {
      // Use webhook ID if available, otherwise IP
      return req.headers['webhook-id'] || req.ip;
    }
  });

  logger.info('✅ Rate limiters initialized successfully');
  return { apiLimiter, authLimiter, webhookLimiter };
};

// Create custom limiter for different tiers
const createTieredLimiter = (tier) => {
  if (!redisClient.isReady()) {
    throw new Error('Redis client not ready. Make sure Redis is connected first.');
  }

  const sendCommand = async (...args) => {
    const command = args[0];
    const commandArgs = args.slice(1);
    return await redisClient.sendCommand(command, ...commandArgs);
  };

  const limits = {
    startup: { window: 15 * 60 * 1000, max: 100 },
    growth: { window: 15 * 60 * 1000, max: 500 },
    enterprise: { window: 15 * 60 * 1000, max: 2000 },
    free: { window: 60 * 60 * 1000, max: 50 } // Added free tier
  };

  const selectedLimit = limits[tier] || limits.startup;

  logger.info(`Creating tiered rate limiter for: ${tier} (${selectedLimit.max} requests per ${selectedLimit.window}ms)`);

  return rateLimit({
    store: new RedisStore({
      sendCommand,
      prefix: `rl:${tier}:`
    }),
    windowMs: selectedLimit.window,
    max: selectedLimit.max,
    message: {
      error: 'Rate limit exceeded for your plan.',
      code: 'PLAN_RATE_LIMIT_EXCEEDED',
      plan: tier,
      limit: selectedLimit.max
    },
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req) => {
      // Use merchant ID if authenticated, otherwise IP
      return req.merchant ? req.merchant._id.toString() : req.ip;
    }
  });
};

// Export getters that check if limiters are initialized
module.exports = {
  get apiLimiter() {
    if (!apiLimiter) {
      throw new Error('Rate limiters not initialized. Call initializeRateLimiters first.');
    }
    return apiLimiter;
  },
  get authLimiter() {
    if (!authLimiter) {
      throw new Error('Rate limiters not initialized. Call initializeRateLimiters first.');
    }
    return authLimiter;
  },
  get webhookLimiter() {
    if (!webhookLimiter) {
      throw new Error('Rate limiters not initialized. Call initializeRateLimiters first.');
    }
    return webhookLimiter;
  },
  initializeRateLimiters,
  createTieredLimiter
};