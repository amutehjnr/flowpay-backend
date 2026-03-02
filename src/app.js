// app.js
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const compression = require('compression');
const swaggerUi = require('swagger-ui-express');
const swaggerSpec = require('./config/swagger');

const connectDB = require('./config/database');
const redisClient = require('./config/redis');
const logger = require('./config/logger');
const { initializeWorkers } = require('./config/queue');
const scheduledJobs = require('./jobs/scheduled.jobs');
const blockchainService = require('./services/blockchain.service');
const paymentService = require('./services/payment.service');

const allowedOrigins = process.env.ALLOWED_ORIGINS
  ? process.env.ALLOWED_ORIGINS.split(',')
  : [
      "http://localhost:3000",
      "http://localhost:3001",
      "https://flowpay-backend-a97z.onrender.com"
    ];


// Import middleware
const { 
  securityHeaders, 
  sanitizeData, 
  requestId,
  bodySizeLimit
} = require('./middleware/security');

// Import ABI
const contractABI = require('../contracts/FlowPayABI.json');

const app = express();

// Security middleware
app.use(securityHeaders);
app.use(sanitizeData);
app.use(requestId);
app.use(bodySizeLimit);

// Standard middleware
app.use(compression());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// CORS
app.use(cors({
  origin: function (origin, callback) {
    // allow requests with no origin (Postman, mobile apps)
    if (!origin) return callback(null, true);

    if (allowedOrigins.includes(origin)) {
      return callback(null, true);
    } else {
      return callback(new Error("CORS not allowed"));
    }
  },
  credentials: true
}));

// Health check (no rate limiting needed)
app.get('/health', (req, res) => {
  res.json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    environment: process.env.NODE_ENV
  });
});

// API documentation (no rate limiting needed)
app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec));

// Start server
const startServer = async () => {
  try {
    // Connect to MongoDB
    await connectDB();
    
    // Connect to Redis
    await redisClient.connect();
    
    // Initialize rate limiters AFTER Redis is connected
    const { initializeRateLimiters } = require('./middleware/rateLimiter');
    const { apiLimiter, authLimiter, webhookLimiter } = initializeRateLimiters();
    
    // Apply rate limiting middleware AFTER initialization
    app.use('/api/', apiLimiter);
    
    // Import routes AFTER rate limiters are initialized
    const authRoutes = require('./routes/auth.routes');
    const merchantRoutes = require('./routes/merchant.routes');
    const walletRoutes = require('./routes/wallet.routes');
    const planRoutes = require('./routes/plan.routes');
    const subscriptionRoutes = require('./routes/subscription.routes');
    const transactionRoutes = require('./routes/transaction.routes');
    const webhookTestRoutes = require('./routes/webhook.test.routes');
    
    // API routes
    app.use('/api/v1/auth', authRoutes);
    app.use('/api/v1/merchant', merchantRoutes);
    app.use('/api/v1/wallet', walletRoutes);
    app.use('/api/v1/plans', planRoutes);
    app.use('/api/v1/subscriptions', subscriptionRoutes);
    app.use('/api/v1/transactions', transactionRoutes);
    app.use('/api/v1/webhooks', webhookTestRoutes);
    
    // ===== IMPORTANT: 404 Handler MUST come AFTER routes =====
    // 404 handler for undefined routes
    app.use((req, res) => {
      res.status(404).json({ error: 'Route not found' });
    });

    // Error handler
    app.use((err, req, res, next) => {
      logger.error('Unhandled error:', err);
      
      res.status(err.status || 500).json({
        error: process.env.NODE_ENV === 'production' 
          ? 'Internal server error' 
          : err.message
      });
    });
    
    // Initialize blockchain service with ABI
    await blockchainService.initialize(contractABI);
    
    // Initialize payment service
    await paymentService.initialize();
    
    // Initialize queue workers
    initializeWorkers();
    
    // Initialize scheduled jobs
    scheduledJobs.initialize();
    
    const PORT = process.env.PORT || 3000;
    app.listen(PORT, () => {
      logger.info(`Server running on port ${PORT}`);
      logger.info(`Environment: ${process.env.NODE_ENV}`);
      logger.info(`API Documentation: flowpay-backend-a97z.onrender.com/api-docs`);
      
      // Log all registered routes for debugging
      logger.info('Registered Routes:');
      logger.info('- POST /api/v1/auth/register');
      logger.info('- POST /api/v1/auth/login');
      logger.info('- POST /api/v1/auth/refresh');
      logger.info('- POST /api/v1/auth/logout');
      logger.info('- GET /api/v1/auth/me');
      logger.info('- POST /api/v1/auth/verify-email/:token');
      logger.info('- POST /api/v1/auth/forgot-password');
      logger.info('- POST /api/v1/auth/reset-password');
    });
    
  } catch (error) {
    logger.error('Failed to start server:', error);
    process.exit(1);
  }
};

// Graceful shutdown
const gracefulShutdown = async () => {
  logger.info('Received shutdown signal, closing connections...');
  
  try {
    await mongoose.connection.close();
    logger.info('MongoDB connection closed');
    
    await redisClient.quit();
    logger.info('Redis connection closed');
    
    // Close queue workers
    const { workers } = require('./config/queue');
    await Promise.all(Object.values(workers).map(worker => worker.close()));
    logger.info('Queue workers closed');
    
    process.exit(0);
  } catch (error) {
    logger.error('Error during graceful shutdown:', error);
    process.exit(1);
  }
};

process.on('SIGTERM', gracefulShutdown);
process.on('SIGINT', gracefulShutdown);

startServer();

module.exports = app;