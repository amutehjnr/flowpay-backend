const swaggerJsdoc = require('swagger-jsdoc');

const options = {
  definition: {
    openapi: '3.0.0',
    info: {
      title: 'FlowPay API Documentation',
      version: '1.0.0',
      description: 'Enterprise subscription infrastructure for on-chain recurring payments',
      contact: {
        name: 'FlowPay Support',
        email: 'support@flowpay.io'
      }
    },
    servers: [
      {
        url: 'http://localhost:3000/api/v1',
        description: 'Development server'
      },
      {
        url: 'https://flowpay-backend-a97z.onrender.com/api/v1',
        description: 'Production server (Render)'
      },
      {
        url: 'https://api.flowpay.io/api/v1',
        description: 'Production server'
      }
    ],
    components: {
      securitySchemes: {
        bearerAuth: {
          type: 'http',
          scheme: 'bearer',
          bearerFormat: 'JWT'
        },
        apiKey: {
          type: 'apiKey',
          in: 'header',
          name: 'x-api-key'
        }
      },
      schemas: {
        User: {
          type: 'object',
          properties: {
            _id: { type: 'string' },
            firstName: { type: 'string' },
            lastName: { type: 'string' },
            email: { type: 'string', format: 'email' },
            country: { type: 'string' },
            phone: { type: 'string' },
            walletAddress: { type: 'string' },
            role: { type: 'string', enum: ['merchant', 'user'] },
            createdAt: { type: 'string', format: 'date-time' }
          }
        },
        Plan: {
          type: 'object',
          properties: {
            planId: { type: 'integer' },
            merchantId: { type: 'string' },
            amountPerInterval: { type: 'string' },
            interval: { type: 'integer' },
            totalIntervals: { type: 'integer' },
            paymentToken: { type: 'string' },
            gracePeriod: { type: 'integer' },
            isActive: { type: 'boolean' },
            createdAt: { type: 'string', format: 'date-time' }
          }
        },
        Subscription: {
          type: 'object',
          properties: {
            subscriptionId: { type: 'integer' },
            planId: { type: 'integer' },
            merchantId: { type: 'string' },
            subscriberWallet: { type: 'string' },
            startTime: { type: 'string', format: 'date-time' },
            nextPaymentDue: { type: 'string', format: 'date-time' },
            paymentsRemaining: { type: 'integer' },
            status: { 
              type: 'string', 
              enum: ['active', 'paused', 'canceled', 'expired', 'grace_period', 'completed'] 
            },
            createdAt: { type: 'string', format: 'date-time' }
          }
        },
        Transaction: {
          type: 'object',
          properties: {
            txHash: { type: 'string' },
            subscriptionId: { type: 'integer' },
            amount: { type: 'string' },
            token: { type: 'string' },
            status: { type: 'string', enum: ['pending', 'confirmed', 'failed'] },
            blockNumber: { type: 'integer' },
            timestamp: { type: 'string', format: 'date-time' }
          }
        },
        Error: {
          type: 'object',
          properties: {
            error: { type: 'string' }
          }
        }
      }
    },
    tags: [
      { name: 'Authentication', description: 'User authentication endpoints' },
      { name: 'Merchant', description: 'Merchant management endpoints' },
      { name: 'Wallet', description: 'Wallet management endpoints' },
      { name: 'Plans', description: 'Subscription plan management' },
      { name: 'Subscriptions', description: 'Subscription management' },
      { name: 'Transactions', description: 'Transaction management' },
      { name: 'Webhooks', description: 'Webhook testing endpoints' }
    ]
  },
  apis: ['./src/routes/*.js']
};

module.exports = swaggerJsdoc(options);