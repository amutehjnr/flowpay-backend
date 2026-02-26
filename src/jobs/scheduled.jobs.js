const cron = require('node-cron');
const logger = require('../config/logger');
const { queues } = require('../config/queue');
const subscriptionService = require('../services/subscription.service');
const paymentService = require('../services/payment.service');
const webhookService = require('../services/webhook.service');
const blockchainService = require('../services/blockchain.service');

class ScheduledJobs {
  initialize() {
    // Check for due payments every hour
    cron.schedule('0 * * * *', async () => {
      logger.info('Running scheduled payment check');
      try {
        await paymentService.processBatchPayments();
      } catch (error) {
        logger.error('Scheduled payment check failed:', error);
      }
    });

    // Check pending transactions every 15 minutes
    cron.schedule('*/15 * * * *', async () => {
      logger.info('Running pending transaction check');
      try {
        await subscriptionService.checkPendingTransactions();
      } catch (error) {
        logger.error('Pending transaction check failed:', error);
      }
    });

    // Retry failed webhooks every 5 minutes
    cron.schedule('*/5 * * * *', async () => {
      logger.info('Running webhook retry check');
      try {
        await webhookService.retryFailedWebhooks();
      } catch (error) {
        logger.error('Webhook retry failed:', error);
      }
    });

    // Reconcile blockchain events every 6 hours
    cron.schedule('0 */6 * * *', async () => {
      logger.info('Running blockchain reconciliation');
      try {
        const currentBlock = await blockchainService.provider.getBlockNumber();
        const fromBlock = currentBlock - 10000; // Last ~2 days
        const toBlock = currentBlock;

        await queues.eventReconciliation.add('reconcile', {
          fromBlock,
          toBlock
        });
      } catch (error) {
        logger.error('Blockchain reconciliation failed:', error);
      }
    });

    // Send payment reminders daily
    cron.schedule('0 9 * * *', async () => {
      logger.info('Sending payment reminders');
      try {
        const dueSoon = await Subscription.find({
          status: 'active',
          isPaused: false,
          nextPaymentDue: {
            $lte: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000), // 3 days
            $gt: new Date()
          }
        }).populate('planId merchantId');

        for (const subscription of dueSoon) {
          await queues.paymentReminders.add('reminder', {
            subscriptionId: subscription.subscriptionId,
            subscriberWallet: subscription.subscriberWallet,
            merchantId: subscription.merchantId,
            dueDate: subscription.nextPaymentDue,
            amount: subscription.planId.amountPerInterval
          });
        }
      } catch (error) {
        logger.error('Payment reminders failed:', error);
      }
    });

    // Clean up old logs weekly
    cron.schedule('0 0 * * 0', async () => {
      logger.info('Cleaning up old logs');
      try {
        const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
        
        await WebhookLog.deleteMany({
          createdAt: { $lt: thirtyDaysAgo },
          status: { $in: ['delivered', 'failed'] }
        });

        logger.info('Old logs cleaned up');
      } catch (error) {
        logger.error('Log cleanup failed:', error);
      }
    });

    logger.info('Scheduled jobs initialized');
  }
}

module.exports = new ScheduledJobs();