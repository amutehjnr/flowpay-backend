const Subscription = require('../models/Subscription');
const Plan = require('../models/Plan');
const Merchant = require('../models/Merchant');
const blockchainService = require('../services/blockchain.service');
const subscriptionService = require('../services/subscription.service');
const logger = require('../config/logger');
const redisClient = require('../config/redis');

class SubscriptionController {
  async subscribe(req, res) {
    try {
      const { planId, subscriberWallet } = req.body;

      const plan = await Plan.findOne({ planId: Number(planId), isActive: true });
      if (!plan) return res.status(404).json({ error: 'Plan not found or inactive' });

      const tx = await blockchainService.contract.subscribe(planId, { from: subscriberWallet });
      const receipt = await tx.wait();

      const event = receipt.logs.find(log => log.eventName === 'Subscribed');
      const subscriptionId = Number(event.args.subscriptionId);

      logger.info(`Subscription created: ${subscriptionId}`);

      res.status(201).json({
        message: 'Subscription created successfully',
        subscriptionId,
        transactionHash: receipt.transactionHash
      });
    } catch (error) {
      logger.error('Subscribe error:', error);
      res.status(500).json({ error: 'Failed to create subscription' });
    }
  }

  async getUserSubscriptions(req, res) {
    try {
      const { wallet } = req.params;
      const subscriptions = await subscriptionService.getUserSubscriptions(wallet);
      res.json(subscriptions);
    } catch (error) {
      logger.error('Get user subscriptions error:', error);
      res.status(500).json({ error: 'Failed to get subscriptions' });
    }
  }

  async getSubscription(req, res) {
    try {
      const subscriptionId = Number(req.params.id);
      const subscription = await subscriptionService.getSubscriptionDetails(subscriptionId);
      if (!subscription) return res.status(404).json({ error: 'Subscription not found' });

      const onChainStatus = await blockchainService.getSubscriptionStatus(subscriptionId);

      res.json({
        ...subscription,
        onChainStatus: {
          nextPaymentDue: new Date(onChainStatus.nextPaymentDue * 1000),
          paymentsRemaining: onChainStatus.paymentsRemaining,
          isPaymentDue: onChainStatus.isPaymentDue,
          isGracePeriodActive: onChainStatus.isGracePeriodActive,
          gracePeriodEnd: onChainStatus.gracePeriodEnd ? new Date(onChainStatus.gracePeriodEnd * 1000) : null,
          totalPaid: onChainStatus.totalPaid.toString()
        }
      });
    } catch (error) {
      logger.error('Get subscription error:', error);
      res.status(500).json({ error: 'Failed to get subscription' });
    }
  }

  async getSubscriptionStatus(req, res) {
    try {
      const subscriptionId = Number(req.params.subscriptionId);
      const status = await blockchainService.getSubscriptionStatus(subscriptionId);

      res.json({
        subscriptionId,
        ...status
      });
    } catch (error) {
      logger.error('Get subscription status error:', error);
      res.status(500).json({ error: 'Failed to get subscription status' });
    }
  }

  async cancelSubscription(req, res) {
    try {
      const subscriptionId = Number(req.params.subscriptionId);
      const subscription = await Subscription.findOne({ subscriptionId });
      if (!subscription) return res.status(404).json({ error: 'Subscription not found' });

      const user = req.user;
      const merchant = await Merchant.findOne({ ownerId: user._id });

      const isAuthorized =
        subscription.subscriberWallet === user.walletAddress ||
        (merchant && subscription.merchantId.toString() === merchant._id.toString());

      if (!isAuthorized) return res.status(403).json({ error: 'Unauthorized' });

      const tx = await blockchainService.contract.cancelSubscription(subscriptionId, { from: user.walletAddress || merchant.publicKey });
      await tx.wait();

      logger.info(`Subscription cancelled: ${subscriptionId}`);

      res.json({ message: 'Subscription cancelled successfully', transactionHash: tx.hash });
    } catch (error) {
      logger.error('Cancel subscription error:', error);
      res.status(500).json({ error: 'Failed to cancel subscription' });
    }
  }

  async pauseSubscription(req, res) {
    try {
      const subscriptionId = Number(req.params.subscriptionId);
      const subscription = await Subscription.findOne({ subscriptionId });
      if (!subscription) return res.status(404).json({ error: 'Subscription not found' });

      const user = req.user;
      if (subscription.subscriberWallet !== user.walletAddress) return res.status(403).json({ error: 'Unauthorized' });

      const tx = await blockchainService.contract.pauseSubscription(subscriptionId, { from: user.walletAddress });
      await tx.wait();

      logger.info(`Subscription paused: ${subscriptionId}`);
      res.json({ message: 'Subscription paused successfully', transactionHash: tx.hash });
    } catch (error) {
      logger.error('Pause subscription error:', error);
      res.status(500).json({ error: 'Failed to pause subscription' });
    }
  }

  async resumeSubscription(req, res) {
    try {
      const subscriptionId = Number(req.params.subscriptionId);
      const subscription = await Subscription.findOne({ subscriptionId });
      if (!subscription) return res.status(404).json({ error: 'Subscription not found' });

      const user = req.user;
      if (subscription.subscriberWallet !== user.walletAddress) return res.status(403).json({ error: 'Unauthorized' });

      const tx = await blockchainService.contract.resumeSubscription(subscriptionId, { from: user.walletAddress });
      await tx.wait();

      logger.info(`Subscription resumed: ${subscriptionId}`);
      res.json({ message: 'Subscription resumed successfully', transactionHash: tx.hash });
    } catch (error) {
      logger.error('Resume subscription error:', error);
      res.status(500).json({ error: 'Failed to resume subscription' });
    }
  }

  async executePayment(req, res) {
    try {
      const subscriptionId = Number(req.params.subscriptionId);
      const { callerIsSubscriber } = req.body;

      const subscription = await Subscription.findOne({ subscriptionId });
      if (!subscription) return res.status(404).json({ error: 'Subscription not found' });

      const tx = await blockchainService.contract.executePayment(subscriptionId, callerIsSubscriber, { from: req.user.walletAddress });
      await tx.wait();

      logger.info(`Payment executed for subscription: ${subscriptionId}`);
      res.json({ message: 'Payment executed successfully', transactionHash: tx.hash });
    } catch (error) {
      logger.error('Execute payment error:', error);
      res.status(500).json({ error: 'Failed to execute payment' });
    }
  }

  async getUpcomingRenewals(req, res) {
    try {
      const days = Number(req.query.days) || 7;
      const targetDate = new Date();
      targetDate.setDate(targetDate.getDate() + days);

      const subscriptions = await Subscription.find({
        status: 'active',
        isPaused: false,
        nextPaymentDue: { $lte: targetDate, $gte: new Date() }
      })
      .populate('planId')
      .limit(100);

      res.json({
        count: subscriptions.length,
        subscriptions: subscriptions.map(sub => ({
          subscriptionId: sub.subscriptionId,
          subscriberWallet: sub.subscriberWallet,
          planId: sub.planId,
          amount: sub.planId?.amountPerInterval,
          nextPaymentDue: sub.nextPaymentDue
        }))
      });
    } catch (error) {
      logger.error('Get upcoming renewals error:', error);
      res.status(500).json({ error: 'Failed to get upcoming renewals' });
    }
  }
}

module.exports = new SubscriptionController();