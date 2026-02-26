const mongoose = require('mongoose');
const logger = require('./logger');

const connectDB = async () => {
  try {
    const conn = await mongoose.connect(process.env.MONGODB_URI, {
      maxPoolSize: 100,
      minPoolSize: 10,
      socketTimeoutMS: 45000,
      family: 4
    });

    logger.info(`MongoDB Connected: ${conn.connection.host}`);

    // Create indexes
    await createIndexes();

  } catch (error) {
    logger.error('MongoDB connection error:', error);
    process.exit(1);
  }
};

const createIndexes = async () => {
  const db = mongoose.connection;

  // Users collection indexes
  await db.collection('users').createIndexes([
    { key: { email: 1 }, unique: true },
    { key: { walletAddress: 1 }, sparse: true },
    { key: { role: 1 } }
  ]);

  // Merchants collection indexes
  await db.collection('merchants').createIndexes([
    { key: { ownerId: 1 } },
    { key: { apiKey: 1 }, unique: true },
    { key: { brandName: 1 } }
  ]);

  // Plans collection indexes
  await db.collection('plans').createIndexes([
    { key: { merchantId: 1 } },
    { key: { planId: 1 }, unique: true },
    { key: { isActive: 1 } },
    { key: { paymentToken: 1 } }
  ]);

  // Subscriptions collection indexes
  await db.collection('subscriptions').createIndexes([
    { key: { subscriptionId: 1 }, unique: true },
    { key: { planId: 1 } },
    { key: { merchantId: 1 } },
    { key: { subscriberWallet: 1 } },
    { key: { status: 1 } },
    { key: { nextPaymentDue: 1 } },
    { key: { createdAt: -1 } }
  ]);

  // Transactions collection indexes
  await db.collection('transactions').createIndexes([
    { key: { txHash: 1 }, unique: true },
    { key: { subscriptionId: 1 } },
    { key: { status: 1 } },
    { key: { timestamp: -1 } }
  ]);

  // WebhookLogs collection indexes
  await db.collection('webhooklogs').createIndexes([
    { key: { merchantId: 1 } },
    { key: { status: 1 } },
    { key: { createdAt: 1 } }
  ]);

  logger.info('Database indexes created');
};

module.exports = connectDB;