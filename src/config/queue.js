const { Queue, Worker } = require('bullmq');
const Redis = require('ioredis');
const logger = require('./logger');

const connection = new Redis({
  host: process.env.REDIS_HOST,
  port: process.env.REDIS_PORT,
  password: process.env.REDIS_PASSWORD,
  maxRetriesPerRequest: null
});

// Define queues
const queues = {
  subscriptionMonitoring: new Queue('subscription-monitoring', { connection }),
  paymentProcessing: new Queue('payment-processing', { connection }),
  webhookDelivery: new Queue('webhook-delivery', { connection }),
  eventReconciliation: new Queue('event-reconciliation', { connection }),
  gracePeriodExpiry: new Queue('grace-period-expiry', { connection }),
  paymentReminders: new Queue('payment-reminders', { connection })
};

// Queue options
const defaultJobOptions = {
  attempts: 3,
  backoff: {
    type: 'exponential',
    delay: 1000
  },
  removeOnComplete: 100,
  removeOnFail: 500
};

// Initialize workers
const initializeWorkers = () => {
  const workers = {};

  // Subscription monitoring worker
  workers.subscriptionMonitoring = new Worker('subscription-monitoring', 
    async job => {
      const { subscriptionId } = job.data;
      // Import here to avoid circular dependency
      const subscriptionService = require('../services/subscription.service');
      await subscriptionService.monitorSubscription(subscriptionId);
    },
    { connection, concurrency: 5 }
  );

  // Webhook delivery worker
  workers.webhookDelivery = new Worker('webhook-delivery',
    async job => {
      const { merchantId, eventType, payload, webhookUrl, secret } = job.data;
      const webhookService = require('../services/webhook.service');
      await webhookService.deliverWebhook(merchantId, eventType, payload, webhookUrl, secret);
    },
    { connection, concurrency: 10 }
  );

  // Payment processing worker
  workers.paymentProcessing = new Worker('payment-processing',
    async job => {
      const { subscriptionId, executeImmediately } = job.data;
      const paymentService = require('../services/payment.service');
      await paymentService.processPayment(subscriptionId, executeImmediately);
    },
    { connection, concurrency: 3 }
  );

  // Event reconciliation worker
  workers.eventReconciliation = new Worker('event-reconciliation',
    async job => {
      const { fromBlock, toBlock } = job.data;
      const blockchainService = require('../services/blockchain.service');
      await blockchainService.reconcileEvents(fromBlock, toBlock);
    },
    { connection, concurrency: 1 }
  );

  // Add error handlers
  Object.values(workers).forEach(worker => {
    worker.on('failed', (job, err) => {
      logger.error(`Job ${job.id} failed:`, err);
    });

    worker.on('completed', job => {
      logger.info(`Job ${job.id} completed successfully`);
    });
  });

  return workers;
};

module.exports = {
  queues,
  defaultJobOptions,
  initializeWorkers,
  connection
};