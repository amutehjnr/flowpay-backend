const { Worker } = require('bullmq');
const logger = require('../config/logger');
const subscriptionService = require('../services/subscription.service');
const { connection } = require('../config/queue');

const subscriptionWorker = new Worker('subscription-monitoring',
  async job => {
    const { subscriptionId } = job.data;
    logger.info(`Processing subscription monitoring job: ${subscriptionId}`);
    
    await subscriptionService.monitorSubscription(subscriptionId);
  },
  { 
    connection,
    concurrency: 5,
    limiter: {
      max: 100,
      duration: 1000
    }
  }
);

const paymentWorker = new Worker('payment-processing',
  async job => {
    const { subscriptionId, executeImmediately } = job.data;
    logger.info(`Processing payment job: ${subscriptionId}`);
    
    const paymentService = require('../services/payment.service');
    await paymentService.processPayment(subscriptionId, executeImmediately);
  },
  { 
    connection,
    concurrency: 3
  }
);

const webhookWorker = new Worker('webhook-delivery',
  async job => {
    const { merchantId, eventType, payload, webhookUrl, secret } = job.data;
    logger.info(`Processing webhook delivery job: ${eventType}`);
    
    const webhookService = require('../services/webhook.service');
    await webhookService.deliverWebhook(merchantId, eventType, payload, webhookUrl, secret);
  },
  { 
    connection,
    concurrency: 10
  }
);

const gracePeriodWorker = new Worker('grace-period-expiry',
  async job => {
    const { subscriptionId } = job.data;
    logger.info(`Processing grace period expiry: ${subscriptionId}`);
    
    const subscription = await Subscription.findOne({ subscriptionId });
    if (subscription) {
      await subscriptionService.handleGracePeriodExpiry(subscription);
    }
  },
  { 
    connection,
    concurrency: 5
  }
);

const reconciliationWorker = new Worker('event-reconciliation',
  async job => {
    const { fromBlock, toBlock } = job.data;
    logger.info(`Processing event reconciliation from ${fromBlock} to ${toBlock}`);
    
    const blockchainService = require('../services/blockchain.service');
    await blockchainService.reconcileEvents(fromBlock, toBlock);
  },
  { 
    connection,
    concurrency: 1
  }
);

// Error handlers
subscriptionWorker.on('failed', (job, err) => {
  logger.error(`Subscription job ${job.id} failed:`, err);
});

paymentWorker.on('failed', (job, err) => {
  logger.error(`Payment job ${job.id} failed:`, err);
});

webhookWorker.on('failed', (job, err) => {
  logger.error(`Webhook job ${job.id} failed:`, err);
});

logger.info('Job workers initialized');

module.exports = {
  subscriptionWorker,
  paymentWorker,
  webhookWorker,
  gracePeriodWorker,
  reconciliationWorker
};