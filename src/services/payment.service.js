const { ethers } = require('ethers');
const Subscription = require('../models/Subscription');
const Transaction = require('../models/Transaction');
const Plan = require('../models/Plan');
const Merchant = require('../models/Merchant');
const blockchainService = require('./blockchain.service');
const webhookService = require('./webhook.service');
const logger = require('../config/logger');
const { queues } = require('../config/queue');

class PaymentService {
  constructor() {
    this.provider = null;
    this.signer = null;
  }

  async initialize() {
    try {
      this.provider = new ethers.JsonRpcProvider(process.env.BLOCKCHAIN_RPC_URL);
      // Note: We don't initialize signer as we never hold private keys
      logger.info('Payment service initialized');
    } catch (error) {
      logger.error('Payment service initialization failed:', error);
      throw error;
    }
  }

  async processPayment(subscriptionId, executeImmediately = false) {
    try {
      logger.info(`Processing payment for subscription: ${subscriptionId}`);

      const subscription = await Subscription.findOne({ subscriptionId });
      if (!subscription) {
        logger.error(`Subscription not found: ${subscriptionId}`);
        return;
      }

      const plan = await Plan.findOne({ planId: subscription.planId });
      if (!plan) {
        logger.error(`Plan not found: ${subscription.planId}`);
        return;
      }

      // Check if payment should be processed
      if (!executeImmediately && !subscription.isPaymentDue()) {
        logger.info(`Payment not due for subscription: ${subscriptionId}`);
        return;
      }

      // Get on-chain status
      const onChainStatus = await blockchainService.getSubscriptionStatus(subscriptionId);
      
      if (onChainStatus.isPaymentDue) {
        // Payment is due on-chain as well
        logger.info(`Payment due on-chain for subscription: ${subscriptionId}`);

        // Wait for payment to be executed on-chain
        // Since we never initiate transactions, we just monitor
        await this.monitorPaymentExecution(subscriptionId);
      } else {
        // Payment already processed on-chain, sync status
        await this.syncPaymentStatus(subscription, onChainStatus);
      }

    } catch (error) {
      logger.error(`Error processing payment for subscription ${subscriptionId}:`, error);
      
      // Notify merchant of payment failure
      const subscription = await Subscription.findOne({ subscriptionId });
      if (subscription) {
        subscription.recordFailedPayment();
        await subscription.save();

        await webhookService.deliverWebhook(
          subscription.merchantId,
          'payment.failed',
          {
            subscriptionId: subscription.subscriptionId,
            subscriberWallet: subscription.subscriberWallet,
            error: error.message,
            timestamp: new Date()
          }
        );

        // Enter grace period if enabled
        if (subscription.failedPayments === 1) {
          const plan = await Plan.findOne({ planId: subscription.planId });
          if (plan && plan.gracePeriod > 0) {
            const gracePeriodEnd = new Date(Date.now() + (plan.gracePeriod * 1000));
            subscription.enterGracePeriod(gracePeriodEnd);
            await subscription.save();

            // Schedule grace period expiry
            await queues.gracePeriodExpiry.add(
              `grace-${subscriptionId}`,
              { subscriptionId },
              { delay: plan.gracePeriod * 1000 }
            );
          }
        }
      }
    }
  }

  async monitorPaymentExecution(subscriptionId) {
    try {
      // Look for recent transactions for this subscription
      const recentTxs = await Transaction.find({
        subscriptionId,
        status: 'pending',
        timestamp: { $gte: new Date(Date.now() - 3600000) } // Last hour
      });

      if (recentTxs.length > 0) {
        // Check if any transaction has been confirmed
        for (const tx of recentTxs) {
          const receipt = await this.provider.getTransactionReceipt(tx.txHash);
          
          if (receipt) {
            if (receipt.status === 1) {
              await this.handleConfirmedTransaction(tx, receipt);
            } else {
              tx.status = 'failed';
              await tx.save();
            }
          }
        }
      } else {
        // No recent transactions, check on-chain status again
        const onChainStatus = await blockchainService.getSubscriptionStatus(subscriptionId);
        
        if (!onChainStatus.isPaymentDue) {
          // Payment was made, need to sync
          const subscription = await Subscription.findOne({ subscriptionId });
          await this.syncPaymentStatus(subscription, onChainStatus);
        }
      }
    } catch (error) {
      logger.error(`Error monitoring payment execution for subscription ${subscriptionId}:`, error);
    }
  }

  async handleConfirmedTransaction(tx, receipt) {
    try {
      tx.status = 'confirmed';
      tx.blockNumber = receipt.blockNumber;
      tx.confirmations = receipt.confirmations || 0;
      await tx.save();

      // Update subscription
      const subscription = await Subscription.findOne({ 
        subscriptionId: tx.subscriptionId 
      });

      if (subscription) {
        subscription.recordPayment(tx.amount, tx.txHash);
        await subscription.save();

        // Clear cache
        await redisClient.del(`subscription:${subscription.subscriptionId}`);

        // Notify merchant
        await webhookService.deliverWebhook(
          subscription.merchantId,
          'payment.success',
          {
            subscriptionId: subscription.subscriptionId,
            txHash: tx.txHash,
            amount: tx.amount,
            token: tx.token,
            paymentNumber: tx.paymentNumber,
            timestamp: tx.timestamp
          }
        );
      }

      logger.info(`Payment confirmed for subscription ${tx.subscriptionId}: ${tx.txHash}`);
    } catch (error) {
      logger.error('Error handling confirmed transaction:', error);
    }
  }

  async syncPaymentStatus(subscription, onChainStatus) {
    try {
      // Check if payment was made
      if (subscription.paymentsMade < onChainStatus.totalPaid / subscription.amountPerInterval) {
        // Payment was made on-chain, need to sync
        const newPaymentCount = Math.floor(onChainStatus.totalPaid / subscription.amountPerInterval);
        const paymentsToSync = newPaymentCount - subscription.paymentsMade;

        for (let i = 0; i < paymentsToSync; i++) {
          const paymentNumber = subscription.paymentsMade + i + 1;
          
          // Create transaction record
          const tx = new Transaction({
            txHash: `sync-${subscription.subscriptionId}-${paymentNumber}`, // Placeholder
            subscriptionId: subscription.subscriptionId,
            planId: subscription.planId,
            merchantId: subscription.merchantId,
            subscriberWallet: subscription.subscriberWallet,
            amount: subscription.amountPerInterval,
            token: subscription.paymentToken,
            paymentNumber,
            status: 'confirmed',
            timestamp: new Date(),
            metadata: {
              synced: 'true',
              reason: 'reconciliation'
            }
          });

          await tx.save();
        }

        // Update subscription
        subscription.paymentsMade = newPaymentCount;
        subscription.paymentsRemaining = onChainStatus.paymentsRemaining;
        subscription.totalPaid = onChainStatus.totalPaid.toString();
        subscription.nextPaymentDue = new Date(onChainStatus.nextPaymentDue * 1000);
        await subscription.save();

        logger.info(`Synced ${paymentsToSync} payments for subscription ${subscription.subscriptionId}`);
      }
    } catch (error) {
      logger.error('Error syncing payment status:', error);
    }
  }

  async getPaymentHistory(subscriptionId, limit = 50) {
    return Transaction.findBySubscription(subscriptionId, limit);
  }

  async getPendingPayments() {
    return Subscription.findDueForPayment();
  }

  async processBatchPayments() {
    try {
      const duePayments = await this.getPendingPayments();
      
      for (const subscription of duePayments) {
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
              delay: 60000
            }
          }
        );
      }

      logger.info(`Queued ${duePayments.length} payments for processing`);
    } catch (error) {
      logger.error('Error processing batch payments:', error);
    }
  }

  async getPaymentMetrics(merchantId, period = '30d') {
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

    const metrics = await Transaction.aggregate([
      {
        $match: {
          merchantId,
          timestamp: { $gte: startDate, $lte: endDate }
        }
      },
      {
        $group: {
          _id: '$status',
          count: { $sum: 1 },
          total: { $sum: { $toDecimal: '$amount' } }
        }
      }
    ]);

    const success = metrics.find(m => m._id === 'confirmed') || { count: 0, total: 0 };
    const failed = metrics.find(m => m._id === 'failed') || { count: 0, total: 0 };
    const pending = metrics.find(m => m._id === 'pending') || { count: 0, total: 0 };

    const successRate = (success.count + failed.count) > 0
      ? (success.count / (success.count + failed.count)) * 100
      : 0;

    return {
      period,
      metrics: {
        totalPayments: success.count + failed.count + pending.count,
        successfulPayments: success.count,
        failedPayments: failed.count,
        pendingPayments: pending.count,
        successRate: successRate.toFixed(2),
        totalVolume: success.total.toString(),
        averagePayment: success.count > 0
          ? (parseFloat(success.total) / success.count).toFixed(2)
          : '0'
      }
    };
  }
}

module.exports = new PaymentService();