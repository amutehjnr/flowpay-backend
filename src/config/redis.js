// config/redis.js
const Redis = require('ioredis');
const logger = require('./logger');

class RedisClient {
  constructor() {
    this.client = null;
    this.subscriber = null;
    this.isConnected = false;
  }

  async connect() {
    try {
      // Validate environment variables
      if (!process.env.REDIS_HOST || !process.env.REDIS_PORT || !process.env.REDIS_PASSWORD) {
        throw new Error('Redis configuration missing. Check your .env file');
      }

      logger.info('Connecting to Redis Cloud...');
      logger.info(`Host: ${process.env.REDIS_HOST}`);
      logger.info(`Port: ${process.env.REDIS_PORT}`);

      // Option 1: Try WITHOUT TLS first (most Redis Cloud free tiers work this way)
      logger.info('Attempting connection WITHOUT TLS...');
      
      const redisOptions = {
        host: process.env.REDIS_HOST,
        port: parseInt(process.env.REDIS_PORT, 10),
        password: process.env.REDIS_PASSWORD,
        username: 'default',
        retryStrategy: (times) => {
          const delay = Math.min(times * 100, 3000);
          return delay;
        },
        maxRetriesPerRequest: 3,
        connectTimeout: 10000,
        lazyConnect: false,
        enableReadyCheck: true,
        // NO TLS OPTIONS - TRY WITHOUT FIRST
      };

      // Create main Redis client
      this.client = new Redis(redisOptions);

      // Set up event handlers
      this.client.on('connect', () => {
        logger.info('✅ Socket connected to Redis');
      });

      this.client.on('ready', () => {
        logger.info('✅ Redis client ready and authenticated');
        this.isConnected = true;
        this.testConnection();
      });

      this.client.on('error', (error) => {
        logger.error('Redis client error:', error.message);
        
        // If error suggests TLS is needed, we'll try with TLS
        if (error.message.includes('SSL') || error.message.includes('TLS') || 
            error.code === 'ERR_SSL_WRONG_VERSION_NUMBER') {
          logger.info('⚠️ Non-TLS connection failed. Attempting TLS connection...');
          this.connectWithTLS();
        }
      });

      this.client.on('close', () => {
        logger.warn('Redis client connection closed');
        this.isConnected = false;
      });

      // Wait for connection
      await new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
          reject(new Error('Redis connection timeout'));
        }, 10000);

        this.client.once('ready', () => {
          clearTimeout(timeout);
          resolve();
        });

        this.client.once('error', (error) => {
          // Don't reject on SSL errors - we'll try TLS
          if (!error.message.includes('SSL') && !error.message.includes('TLS')) {
            clearTimeout(timeout);
            reject(error);
          }
        });
      });

      return this.client;

    } catch (error) {
      logger.error('❌ Initial connection error:', error.message);
      
      // Try TLS as fallback if we haven't already
      if (!error.message.includes('TLS')) {
        return this.connectWithTLS();
      }
      throw error;
    }
  }

  async connectWithTLS() {
    logger.info('Connecting with TLS enabled...');
    
    const redisOptions = {
      host: process.env.REDIS_HOST,
      port: parseInt(process.env.REDIS_PORT, 10),
      password: process.env.REDIS_PASSWORD,
      username: 'default',
      retryStrategy: (times) => Math.min(times * 100, 3000),
      maxRetriesPerRequest: 3,
      connectTimeout: 10000,
      tls: {
        rejectUnauthorized: false // For development only
      }
    };

    this.client = new Redis(redisOptions);

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('Redis TLS connection timeout'));
      }, 10000);

      this.client.once('ready', () => {
        clearTimeout(timeout);
        this.isConnected = true;
        logger.info('✅ Redis TLS connection successful');
        this.testConnection();
        resolve(this.client);
      });

      this.client.once('error', (error) => {
        clearTimeout(timeout);
        logger.error('❌ Redis TLS connection failed:', error.message);
        reject(error);
      });

      this.client.on('connect', () => {
        logger.info('✅ TLS socket connected');
      });
    });
  }

  async testConnection() {
    try {
      const ping = await this.client.ping();
      logger.info(`✅ Redis PING: ${ping}`);
      
      // Test write/read
      const testKey = 'flowpay:connection:test';
      await this.client.set(testKey, 'connected', 'EX', 5);
      const value = await this.client.get(testKey);
      logger.info(`✅ Redis read/write test: ${value}`);
      
      logger.info('✅ Redis fully operational');
    } catch (error) {
      logger.error('Redis test failed:', error.message);
    }
  }

  isReady() {
    return this.isConnected && this.client?.status === 'ready';
  }

  async sendCommand(command, ...args) {
    if (!this.isReady()) {
      throw new Error('Redis client not ready');
    }
    return this.client.call(command, ...args);
  }

  async get(key) {
    return this.client.get(key);
  }

  async set(key, value, ttl = 3600) {
    return this.client.set(key, value, 'EX', ttl);
  }

  async del(key) {
    return this.client.del(key);
  }

  async quit() {
    if (this.client) {
      await this.client.quit();
    }
    if (this.subscriber) {
      await this.subscriber.quit();
    }
    logger.info('Redis connections closed');
  }
}

module.exports = new RedisClient();