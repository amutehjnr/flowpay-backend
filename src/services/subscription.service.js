const Subscription = require('../models/Subscription');
const Plan = require('../models/Plan');
const Transaction = require('../models/Transaction');
const Merchant = require('../models/Merchant');
const blockchainService = require('./blockchain.service');
const webhookService = require('./webhook.service');
const { queues } = require('../config/queue');
const logger = require('../config/logger');
const redisClient = require('../config/redis');

class SubscriptionService {
  async monitorSubscription(subscriptionId) {
    try {
      logger.info(`Monitoring subscription: ${subscriptionId}`);

      const subscription = await Subscription.findOne({ subscriptionId });
      if (!subscription) {
        logger.error(`Subscription not found: ${subscriptionId}`);
        return;
      }

      // Get on-chain status
      const onChainStatus = await blockchainService.getSubscriptionStatus(subscriptionId);

      // Check if payment is due
      if (subscription.isPaymentDue()) {
        await this.processDuePayment(subscription);
      }

      // Check grace period
      if (subscription.status === 'grace_period' && subscription.gracePeriodEnd <= new Date()) {
        await this.handleGracePeriodExpiry(subscription);
      }

      // Update subscription if needed
      if (subscription.paymentsRemaining !== onChainStatus.paymentsRemaining ||
          subscription.nextPaymentDue.getTime() !== onChainStatus.nextPaymentDue * 1000) {
        
        subscription.paymentsRemaining = onChainStatus.paymentsRemaining;
        subscription.nextPaymentDue = new Date(onChainStatus.nextPaymentDue * 1000);
        await subscription.save();

        // Update cache
        await redisClient.set(
          `subscription:${subscriptionId}`,
          JSON.stringify(subscription.toObject()),
          3600
        );
      }

      // Schedule next monitoring
      if (subscription.status === 'active' && !subscription.isPaused) {
        await queues.subscriptionMonitoring.add(
          `monitor-${subscriptionId}`,
          { subscriptionId },
          { delay: 3600000 } // Check every hour
        );
      }

    } catch (error) {
      logger.error(`Error monitoring subscription ${subscriptionId}:`, error);
    }
  }

  async processDuePayment(subscription) {
    try {
      logger.info(`Processing due payment for subscription: ${subscription.subscriptionId}`);

      const plan = await Plan.findOne({ planId: subscription.planId });
      if (!plan) {
        logger.error(`Plan not found: ${subscription.planId}`);
        return;
      }

      // Check if in grace period
      if (subscription.inGracePeriod()) {
        logger.info(`Subscription ${subscription.subscriptionId} in grace period`);
        return;
      }

      // Add to payment queue
      await queues.paymentProcessing.add(
        `payment-${subscription.subscriptionId}`,
        {
          subscriptionId: subscription.subscriptionId,
          executeImmediately: true
        },
        {
          attempts: 3,
          backoff: {
            type: 'exponential',
            delay: 60000 // 1 minute
          }
        }
      );

    } catch (error) {
      logger.error(`Error processing due payment:`, error);
    }
  }

  async handleGracePeriodExpiry(subscription) {
    try {
      logger.info(`Grace period expired for subscription: ${subscription.subscriptionId}`);

      // Get on-chain status
      const onChainStatus = await blockchainService.getSubscriptionStatus(subscription.subscriptionId);

      if (onChainStatus.isPaymentDue) {
        // Payment still due, cancel subscription
        subscription.status = 'canceled';
        await subscription.save();

        // Notify merchant
        await webhookService.deliverWebhook(
          subscription.merchantId,
          'subscription.canceled',
          {
            subscriptionId: subscription.subscriptionId,
            subscriberWallet: subscription.subscriberWallet,
            reason: 'grace_period_expired'
          }
        );
      } else {
        // Payment was made during grace period
        subscription.status = 'active';
        subscription.gracePeriodEnd = null;
        await subscription.save();
      }

    } catch (error) {
      logger.error(`Error handling grace period expiry:`, error);
    }
  }

  async checkPendingTransactions() {
    try {
      const pendingTxs = await Transaction.find({ 
        status: 'pending',
        timestamp: { $lt: new Date(Date.now() - 3600000) } // Older than 1 hour
      });

      for (const tx of pendingTxs) {
        // Check if transaction is confirmed
        const receipt = await blockchainService.provider.getTransactionReceipt(tx.txHash);
        
        if (receipt) {
          if (receipt.status === 1) {
            tx.status = 'confirmed';
            tx.blockNumber = receipt.blockNumber;
            await tx.save();
          } else {
            tx.status = 'failed';
            await tx.save();

            // Update subscription
            const subscription = await Subscription.findOne({ 
              subscriptionId: tx.subscriptionId 
            });
            if (subscription) {
              subscription.recordFailedPayment();
              await subscription.save();
            }
          }
        }
      }
    } catch (error) {
      logger.error('Error checking pending transactions:', error);
    }
  }

  async getSubscriptionDetails(subscriptionId) {
    // Check cache first
    const cached = await redisClient.get(`subscription:${subscriptionId}`);
    if (cached) {
      return JSON.parse(cached);
    }

    const subscription = await Subscription.findOne({ subscriptionId })
      .populate('planId')
      .lean();

    if (subscription) {
      // Cache for 1 hour
      await redisClient.set(
        `subscription:${subscriptionId}`,
        JSON.stringify(subscription),
        3600
      );
    }

    return subscription;
  }

  async getUserSubscriptions(walletAddress) {
    const subscriptions = await Subscription.findBySubscriber(walletAddress);
    
    // Get on-chain status for each
    const enrichedSubscriptions = await Promise.all(
      subscriptions.map(async (sub) => {
        try {
          const onChainStatus = await blockchainService.getSubscriptionStatus(sub.subscriptionId);
          return {
            ...sub.toObject(),
            onChainStatus
          };
        } catch (error) {
          logger.error(`Error getting on-chain status for subscription ${sub.subscriptionId}:`, error);
          return sub;
        }
      })
    );

    return enrichedSubscriptions;
  }

  async getMerchantSubscriptions(merchantId, filters = {}) {
    const query = { merchantId, ...filters };
    return Subscription.find(query).sort({ createdAt: -1 });
  }

  async getSubscriptionMetrics(merchantId, period = '30d') {
    const endDate = new Date();
    const startDate = new Date();

    switch (period) {
      case '7d':
        startDate.setDate(startDate.getDate() - 7);
        break;
      case '30d':
        startDate.setDate(startDate.getDate() - 30);
        break;
      case '90d':
        startDate.setDate(startDate.getDate() - 90);
        break;
      default:
        startDate.setDate(startDate.getDate() - 30);
    }

    const [
      activeSubscriptions,
      totalRevenue,
      newSubscriptions,
      canceledSubscriptions,
      failedPayments
    ] = await Promise.all([
      Subscription.countDocuments({ 
        merchantId, 
        status: 'active' 
      }),
      Transaction.getTotalRevenue(merchantId, startDate, endDate),
      Subscription.countDocuments({ 
        merchantId, 
        createdAt: { $gte: startDate, $lte: endDate } 
      }),
      Subscription.countDocuments({ 
        merchantId, 
        status: 'canceled',
        updatedAt: { $gte: startDate, $lte: endDate } 
      }),
      Transaction.countDocuments({ 
        merchantId, 
        status: 'failed',
        timestamp: { $gte: startDate, $lte: endDate } 
      })
    ]);

    // Calculate churn rate
    const churnRate = newSubscriptions > 0 
      ? (canceledSubscriptions / newSubscriptions) * 100 
      : 0;

    // Calculate MRR/ARR
    const plans = await Plan.find({ merchantId, isActive: true });
    let mrr = 0;
    let arr = 0;

    for (const plan of plans) {
      const activeCount = await Subscription.countDocuments({
        planId: plan.planId,
        status: 'active'
      });

      const monthlyAmount = this.calculateMonthlyAmount(
        plan.amountPerInterval,
        plan.interval
      );

      mrr += monthlyAmount * activeCount;
    }

    arr = mrr * 12;

    return {
      period,
      metrics: {
        activeSubscriptions,
        totalRevenue: totalRevenue[0]?.total?.toString() || '0',
        transactionCount: totalRevenue[0]?.count || 0,
        newSubscriptions,
        canceledSubscriptions,
        failedPayments,
        churnRate: churnRate.toFixed(2),
        mrr: mrr.toFixed(2),
        arr: arr.toFixed(2)
      }
    };
  }

  calculateMonthlyAmount(amount, intervalSeconds) {
    const secondsInMonth = 30 * 24 * 60 * 60; // 30 days in seconds
    const amountNum = parseFloat(amount);
    return (amountNum * secondsInMonth) / intervalSeconds;
  }
}

module.exports = new SubscriptionService();