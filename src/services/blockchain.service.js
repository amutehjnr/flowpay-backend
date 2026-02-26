// services/blockchain.service.js
const { ethers } = require('ethers');
const logger = require('../config/logger');
const Plan = require('../models/Plan');
const Subscription = require('../models/Subscription');
const Transaction = require('../models/Transaction');
const Merchant = require('../models/Merchant');
const { queues } = require('../config/queue');
const redisClient = require('../config/redis');

class BlockchainService {
  constructor() {
    this.provider = null;
    this.contract = null;
    this.contractAddress = process.env.CONTRACT_ADDRESS;
    this.abi = null;
    this.startBlock = parseInt(process.env.START_BLOCK) || 0;
    this.lastProcessedBlock = this.startBlock;
    this.isPolling = false; // Track polling state
  }

  async initialize(abi) {
    try {
      this.abi = abi;
      
      // Create provider with network configuration that disables ENS
      const network = {
        name: 'avalanche-fuji',
        chainId: 43113,
        ensAddress: null
      };

      // Create provider with static network to prevent ENS lookups
      this.provider = new ethers.JsonRpcProvider(
        process.env.BLOCKCHAIN_RPC_URL || 'https://api.avax-test.network/ext/bc/C/rpc',
        network,
        {
          staticNetwork: true,
          ensAddress: null
        }
      );

      // Override the resolveName method to prevent ENS lookups
      this.provider.resolveName = async (name) => {
        if (name && name.includes('.')) {
          logger.debug(`ENS resolution attempted for ${name} - returning null`);
          return null;
        }
        return name;
      };

      // SUPPRESS FILTER ERRORS - This is the key addition
      this._suppressFilterErrors();

      this.contract = new ethers.Contract(this.contractAddress, this.abi, this.provider);
      
      // Get last processed block from Redis
      const lastBlock = await redisClient.get('last_processed_block');
      if (lastBlock) {
        this.lastProcessedBlock = parseInt(lastBlock);
      }

      // Verify connection with a simple call
      const blockNumber = await this.provider.getBlockNumber();
      logger.info(`✅ Blockchain service initialized on Avalanche Fuji (block ${blockNumber})`);

      // Start event listeners
      this.startEventListeners();
      
    } catch (error) {
      logger.error('❌ Blockchain service initialization failed:', error);
      logger.warn('Server continuing without blockchain service');
    }
  }

  /**
   * Suppress the annoying "filter not found" errors from Ethers.js polling
   * This intercepts and filters out the specific UNKNOWN_ERROR with "filter not found"
   */
  _suppressFilterErrors() {
    if (!this.provider) return;

    // Store the original emit function
    const originalEmit = this.provider.emit;
    
    // Override the emit function to filter specific errors
    this.provider.emit = (eventName, ...args) => {
      // Only filter error events
      if (eventName === 'error') {
        const error = args[0];
        
        // Check if this is the filter not found error we want to suppress
        if (this._isFilterNotFoundError(error)) {
          // Log at debug level instead of error (or don't log at all)
          logger.debug('Filter not found (expected) - auto-recovering');
          return true; // Pretend it was handled
        }
      }
      
      // Pass through all other events
      return originalEmit.call(this.provider, eventName, ...args);
    };

    // Also suppress the specific polling errors
    if (this.provider.polling) {
      const originalPoll = this.provider._poll;
      this.provider._poll = async () => {
        try {
          await originalPoll.call(this.provider);
        } catch (error) {
          if (!this._isFilterNotFoundError(error)) {
            throw error; // Re-throw non-filter errors
          }
          // Silently ignore filter errors during polling
        }
      };
    }

    logger.info('✅ Filter error suppression enabled');
  }

  /**
   * Check if an error is the "filter not found" error we want to suppress
   */
  _isFilterNotFoundError(error) {
    return error && 
           error.code === 'UNKNOWN_ERROR' && 
           error.error && 
           error.error.message === 'filter not found';
  }

  startEventListeners() {
    try {
      // Plan Events
      this.contract.on('PlanCreated', this.handlePlanCreated.bind(this));
      this.contract.on('PlanDeactivated', this.handlePlanDeactivated.bind(this));
      this.contract.on('PlanUpdated', this.handlePlanUpdated.bind(this));

      // Subscription Events
      this.contract.on('Subscribed', this.handleSubscribed.bind(this));
      this.contract.on('SubscriptionCanceled', this.handleSubscriptionCanceled.bind(this));
      this.contract.on('SubscriptionPaused', this.handleSubscriptionPaused.bind(this));
      this.contract.on('SubscriptionResumed', this.handleSubscriptionResumed.bind(this));

      // Payment Events
      this.contract.on('PaymentExecuted', this.handlePaymentExecuted.bind(this));

      // Other Events
      this.contract.on('AllowanceUpdated', this.handleAllowanceUpdated.bind(this));
      this.contract.on('EmergencyWithdraw', this.handleEmergencyWithdraw.bind(this));

      logger.info('✅ Event listeners started');
    } catch (error) {
      logger.error('Failed to start event listeners:', error);
    }
  }

  // Alternative approach: Use polling with error handling
  async startPolling(interval = 15000) {
    if (this.isPolling) return;
    
    this.isPolling = true;
    logger.info(`Starting event polling every ${interval}ms`);
    
    const poll = async () => {
      if (!this.isPolling) return;
      
      try {
        // Poll for filter changes
        const filter = this.contract.filters.PaymentExecuted();
        const events = await this.contract.queryFilter(filter, -1000); // Last 1000 blocks
        
        for (const event of events) {
          await this.handlePaymentExecuted(...event.args, event);
        }
      } catch (error) {
        if (!this._isFilterNotFoundError(error)) {
          logger.error('Polling error:', error.message);
        }
      }
      
      // Schedule next poll
      setTimeout(poll, interval);
    };
    
    poll();
  }

  async handlePlanCreated(planId, creator, amountPerInterval, interval, totalIntervals, paymentToken, gracePeriod, event) {
    try {
      logger.info(`PlanCreated event received: ${planId}`);

      // Find merchant by wallet address
      const merchant = await Merchant.findOne({ publicKey: creator.toLowerCase() });
      if (!merchant) {
        logger.error(`Merchant not found for address: ${creator}`);
        return;
      }

      // Create plan in database
      const plan = new Plan({
        merchantId: merchant._id,
        planId: Number(planId),
        amountPerInterval: amountPerInterval.toString(),
        interval: Number(interval),
        totalIntervals: Number(totalIntervals),
        paymentToken: paymentToken.toLowerCase(),
        gracePeriod: Number(gracePeriod),
        isActive: true
      });

      await plan.save();

      // Cache plan
      await redisClient.set(
        `plan:${planId}`,
        JSON.stringify(plan.toObject()),
        3600
      );

      // Trigger webhook
      await queues.webhookDelivery.add('plan-created', {
        merchantId: merchant._id,
        eventType: 'plan.created',
        payload: {
          planId: plan.planId,
          amountPerInterval: plan.amountPerInterval,
          interval: plan.interval,
          paymentToken: plan.paymentToken,
          createdAt: plan.createdAt
        }
      });

    } catch (error) {
      logger.error('Error handling PlanCreated event:', error);
    }
  }

  async handleSubscribed(subscriptionId, planId, subscriber, startTime, event) {
    try {
      logger.info(`Subscribed event received: ${subscriptionId}`);

      // Get plan details
      const plan = await Plan.findOne({ planId: Number(planId) });
      if (!plan) {
        logger.error(`Plan not found: ${planId}`);
        return;
      }

      // Calculate next payment due
      const startDate = new Date(Number(startTime) * 1000);
      const nextPaymentDue = new Date(startDate.getTime() + (plan.interval * 1000));

      // Create subscription
      const subscription = new Subscription({
        subscriptionId: Number(subscriptionId),
        planId: Number(planId),
        merchantId: plan.merchantId,
        subscriberWallet: subscriber.toLowerCase(),
        startTime: startDate,
        nextPaymentDue: nextPaymentDue,
        paymentsRemaining: plan.totalIntervals - 1,
        paymentsMade: 1,
        status: 'active'
      });

      await subscription.save();

      // Cache subscription
      await redisClient.set(
        `subscription:${subscriptionId}`,
        JSON.stringify(subscription.toObject()),
        3600
      );

      // Schedule monitoring job
      await queues.subscriptionMonitoring.add(
        `monitor-${subscriptionId}`,
        { subscriptionId: Number(subscriptionId) },
        { delay: plan.interval * 1000 }
      );

      // Trigger webhook
      await queues.webhookDelivery.add('subscription-created', {
        merchantId: plan.merchantId,
        eventType: 'subscription.created',
        payload: {
          subscriptionId: subscription.subscriptionId,
          planId: subscription.planId,
          subscriberWallet: subscription.subscriberWallet,
          startTime: subscription.startTime,
          nextPaymentDue: subscription.nextPaymentDue
        }
      });

    } catch (error) {
      logger.error('Error handling Subscribed event:', error);
    }
  }

  async handlePaymentExecuted(subscriptionId, subscriber, merchant, amount, paymentNumber, paymentToken, event) {
    try {
      logger.info(`PaymentExecuted event received: ${subscriptionId}`);

      const txHash = event.log.transactionHash;
      const blockNumber = event.log.blockNumber;

      // Get subscription
      const subscription = await Subscription.findOne({ 
        subscriptionId: Number(subscriptionId) 
      });

      if (!subscription) {
        logger.error(`Subscription not found: ${subscriptionId}`);
        return;
      }

      // Create transaction record
      const transaction = new Transaction({
        txHash,
        subscriptionId: Number(subscriptionId),
        planId: subscription.planId,
        merchantId: subscription.merchantId,
        subscriberWallet: subscription.subscriberWallet,
        amount: amount.toString(),
        token: paymentToken.toLowerCase(),
        paymentNumber: Number(paymentNumber),
        status: 'confirmed',
        blockNumber: Number(blockNumber),
        timestamp: new Date()
      });

      await transaction.save();

      // Update subscription
      subscription.recordPayment(amount.toString(), txHash);
      subscription.nextPaymentDue = new Date(
        subscription.nextPaymentDue.getTime() + 
        (subscription.interval * 1000)
      );
      await subscription.save();

      // Update cache
      await redisClient.del(`subscription:${subscriptionId}`);

      // Trigger webhook
      await queues.webhookDelivery.add('payment-success', {
        merchantId: subscription.merchantId,
        eventType: 'payment.success',
        payload: {
          subscriptionId: subscription.subscriptionId,
          txHash,
          amount: amount.toString(),
          token: paymentToken,
          paymentNumber: Number(paymentNumber),
          timestamp: new Date()
        }
      });

    } catch (error) {
      logger.error('Error handling PaymentExecuted event:', error);
    }
  }

  async handleSubscriptionCanceled(subscriptionId, subscriber, remainingPayments, event) {
    try {
      logger.info(`SubscriptionCanceled event received: ${subscriptionId}`);

      const subscription = await Subscription.findOne({ 
        subscriptionId: Number(subscriptionId) 
      });

      if (!subscription) {
        logger.error(`Subscription not found: ${subscriptionId}`);
        return;
      }

      subscription.status = 'canceled';
      await subscription.save();

      // Update cache
      await redisClient.del(`subscription:${subscriptionId}`);

      // Trigger webhook
      await queues.webhookDelivery.add('subscription-canceled', {
        merchantId: subscription.merchantId,
        eventType: 'subscription.canceled',
        payload: {
          subscriptionId: subscription.subscriptionId,
          subscriberWallet: subscription.subscriberWallet,
          remainingPayments: Number(remainingPayments),
          canceledAt: new Date()
        }
      });

    } catch (error) {
      logger.error('Error handling SubscriptionCanceled event:', error);
    }
  }

  async handleSubscriptionPaused(subscriptionId, subscriber, event) {
    try {
      logger.info(`SubscriptionPaused event received: ${subscriptionId}`);

      const subscription = await Subscription.findOne({ 
        subscriptionId: Number(subscriptionId) 
      });

      if (!subscription) {
        logger.error(`Subscription not found: ${subscriptionId}`);
        return;
      }

      subscription.isPaused = true;
      subscription.pauseTime = new Date();
      await subscription.save();

      // Update cache
      await redisClient.del(`subscription:${subscriptionId}`);

      // Trigger webhook
      await queues.webhookDelivery.add('subscription-paused', {
        merchantId: subscription.merchantId,
        eventType: 'subscription.paused',
        payload: {
          subscriptionId: subscription.subscriptionId,
          subscriberWallet: subscription.subscriberWallet,
          pausedAt: new Date()
        }
      });

    } catch (error) {
      logger.error('Error handling SubscriptionPaused event:', error);
    }
  }

  async handleSubscriptionResumed(subscriptionId, subscriber, event) {
    try {
      logger.info(`SubscriptionResumed event received: ${subscriptionId}`);

      const subscription = await Subscription.findOne({ 
        subscriptionId: Number(subscriptionId) 
      });

      if (!subscription) {
        logger.error(`Subscription not found: ${subscriptionId}`);
        return;
      }

      subscription.isPaused = false;
      subscription.pauseTime = null;
      await subscription.save();

      // Update cache
      await redisClient.del(`subscription:${subscriptionId}`);

      // Trigger webhook
      await queues.webhookDelivery.add('subscription-resumed', {
        merchantId: subscription.merchantId,
        eventType: 'subscription.resumed',
        payload: {
          subscriptionId: subscription.subscriptionId,
          subscriberWallet: subscription.subscriberWallet,
          resumedAt: new Date()
        }
      });

    } catch (error) {
      logger.error('Error handling SubscriptionResumed event:', error);
    }
  }

  async handlePlanDeactivated(planId, creator, event) {
    try {
      logger.info(`PlanDeactivated event received: ${planId}`);

      const plan = await Plan.findOne({ planId: Number(planId) });
      if (!plan) {
        logger.error(`Plan not found: ${planId}`);
        return;
      }

      plan.isActive = false;
      await plan.save();

      // Update cache
      await redisClient.del(`plan:${planId}`);

    } catch (error) {
      logger.error('Error handling PlanDeactivated event:', error);
    }
  }

  async handlePlanUpdated(planId, gracePeriod, isActive, event) {
    try {
      logger.info(`PlanUpdated event received: ${planId}`);

      const plan = await Plan.findOne({ planId: Number(planId) });
      if (!plan) {
        logger.error(`Plan not found: ${planId}`);
        return;
      }

      plan.gracePeriod = Number(gracePeriod);
      plan.isActive = isActive;
      await plan.save();

      // Update cache
      await redisClient.del(`plan:${planId}`);

    } catch (error) {
      logger.error('Error handling PlanUpdated event:', error);
    }
  }

  async handleAllowanceUpdated(subscriber, token, amount, event) {
    try {
      logger.debug(`AllowanceUpdated event received: ${subscriber}`);
    } catch (error) {
      logger.error('Error handling AllowanceUpdated event:', error);
    }
  }

  async handleEmergencyWithdraw(token, amount, to, event) {
    try {
      logger.warn(`EmergencyWithdraw event: ${amount} ${token} withdrawn to ${to}`);
    } catch (error) {
      logger.error('Error handling EmergencyWithdraw event:', error);
    }
  }

  async reconcileEvents(fromBlock, toBlock) {
    try {
      logger.info(`Reconciling events from block ${fromBlock} to ${toBlock}`);

      // Query events in range
      const filter = this.contract.filters.PaymentExecuted();
      const events = await this.contract.queryFilter(filter, fromBlock, toBlock);

      for (const event of events) {
        const txHash = event.transactionHash;
        
        // Check if transaction exists
        const existingTx = await Transaction.findOne({ txHash });
        if (!existingTx) {
          await this.handlePaymentExecuted(...event.args, event);
        }
      }

      logger.info(`Reconciled ${events.length} events`);

    } catch (error) {
      logger.error('Error reconciling events:', error);
    }
  }

  async getSubscriptionStatus(subscriptionId) {
    try {
      return await this.contract.getSubscriptionStatus(subscriptionId);
    } catch (error) {
      logger.error('Error getting subscription status:', error);
      throw error;
    }
  }

  async getUserActiveSubscriptions(walletAddress) {
    try {
      return await this.contract.getUserActiveSubscriptions(walletAddress);
    } catch (error) {
      logger.error('Error getting user subscriptions:', error);
      throw error;
    }
  }

  async getPlanDetails(planId) {
    try {
      return await this.contract.plans(planId);
    } catch (error) {
      logger.error('Error getting plan details:', error);
      throw error;
    }
  }
}

module.exports = new BlockchainService();