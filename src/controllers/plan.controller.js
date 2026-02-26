const Plan = require('../models/Plan');
const Merchant = require('../models/Merchant');
const Subscription = require('../models/Subscription');
const Transaction = require('../models/Transaction');
const blockchainService = require('../services/blockchain.service');
const logger = require('../config/logger');
const redisClient = require('../config/redis');

class PlanController {
  async createPlan(req, res) {
    try {
      const {
        amountPerInterval,
        interval,
        totalIntervals,
        paymentToken,
        gracePeriod,
        metadata
      } = req.body;

      const merchant = await Merchant.findOne({ ownerId: req.user._id });
      if (!merchant) return res.status(404).json({ error: 'Merchant profile not found' });

      // Create plan on blockchain
      const tx = await blockchainService.contract.createPlan(
        amountPerInterval,
        interval,
        totalIntervals,
        paymentToken,
        gracePeriod,
        { from: merchant.publicKey }
      );

      const receipt = await tx.wait();
      const event = receipt.logs.find(log => log.eventName === 'PlanCreated');
      const planId = event.args.planId;

      const plan = new Plan({
        merchantId: merchant._id,
        planId: Number(planId),
        amountPerInterval,
        interval,
        totalIntervals,
        paymentToken,
        gracePeriod,
        metadata,
        isActive: true
      });

      await plan.save();

      await redisClient.set(`plan:${planId}`, JSON.stringify(plan.toObject()), 'EX', 3600);

      logger.info(`Plan created: ${planId} for merchant: ${merchant._id}`);

      res.status(201).json({
        message: 'Plan created successfully',
        plan,
        transactionHash: receipt.transactionHash
      });
    } catch (error) {
      logger.error('Create plan error:', error);
      res.status(500).json({ error: 'Failed to create plan' });
    }
  }

  async getPlans(req, res) {
    try {
      const { merchantId } = req.params;
      const { active = true } = req.query;

      const plans = await Plan.find({ 
        merchantId,
        isActive: active
      }).sort({ createdAt: -1 });

      res.json(plans);
    } catch (error) {
      logger.error('Get plans error:', error);
      res.status(500).json({ error: 'Failed to get plans' });
    }
  }

  async getPlan(req, res) {
    try {
      const { planId } = req.params;

      const cached = await redisClient.get(`plan:${planId}`);
      if (cached) return res.json(JSON.parse(cached));

      const plan = await Plan.findOne({ planId: Number(planId) });
      if (!plan) return res.status(404).json({ error: 'Plan not found' });

      await redisClient.set(`plan:${planId}`, JSON.stringify(plan.toObject()), 'EX', 3600);

      res.json(plan);
    } catch (error) {
      logger.error('Get plan error:', error);
      res.status(500).json({ error: 'Failed to get plan' });
    }
  }

  async deactivatePlan(req, res) {
    try {
      const { planId } = req.params;

      const plan = await Plan.findOne({ planId: Number(planId) });
      if (!plan) return res.status(404).json({ error: 'Plan not found' });

      const merchant = await Merchant.findOne({ ownerId: req.user._id });
      if (plan.merchantId.toString() !== merchant._id.toString())
        return res.status(403).json({ error: 'Unauthorized' });

      const tx = await blockchainService.contract.deactivatePlan(planId, { from: merchant.publicKey });
      await tx.wait();

      plan.isActive = false;
      await plan.save();
      await redisClient.del(`plan:${planId}`);

      logger.info(`Plan deactivated: ${planId}`);

      res.json({ message: 'Plan deactivated successfully', plan });
    } catch (error) {
      logger.error('Deactivate plan error:', error);
      res.status(500).json({ error: 'Failed to deactivate plan' });
    }
  }

  async updateGracePeriod(req, res) {
    try {
      const { planId } = req.params;
      const { gracePeriod } = req.body;

      const plan = await Plan.findOne({ planId: Number(planId) });
      if (!plan) return res.status(404).json({ error: 'Plan not found' });

      const merchant = await Merchant.findOne({ ownerId: req.user._id });
      if (plan.merchantId.toString() !== merchant._id.toString())
        return res.status(403).json({ error: 'Unauthorized' });

      const tx = await blockchainService.contract.updatePlanGracePeriod(planId, gracePeriod, { from: merchant.publicKey });
      await tx.wait();

      plan.gracePeriod = gracePeriod;
      await plan.save();
      await redisClient.del(`plan:${planId}`);

      logger.info(`Plan grace period updated: ${planId}`);

      res.json({ message: 'Plan updated successfully', plan });
    } catch (error) {
      logger.error('Update plan error:', error);
      res.status(500).json({ error: 'Failed to update plan' });
    }
  }

  async getPlanMetrics(req, res) {
    try {
      const { planId } = req.params;
      const plan = await Plan.findOne({ planId: Number(planId) });
      if (!plan) return res.status(404).json({ error: 'Plan not found' });

      const activeSubscriptions = await Subscription.countDocuments({ planId: Number(planId), status: 'active' });
      const totalSubscriptions = await Subscription.countDocuments({ planId: Number(planId) });

      const revenue = await Transaction.aggregate([
        { $match: { planId: Number(planId), status: 'confirmed' } },
        { $group: { _id: null, total: { $sum: { $toDecimal: '$amount' } }, count: { $sum: 1 } } }
      ]);

      res.json({
        planId: plan.planId,
        metrics: {
          activeSubscriptions,
          totalSubscriptions,
          totalRevenue: revenue[0]?.total?.toString() || '0',
          totalPayments: revenue[0]?.count || 0,
          conversionRate: totalSubscriptions > 0 ? (activeSubscriptions / totalSubscriptions) * 100 : 0
        }
      });
    } catch (error) {
      logger.error('Get plan metrics error:', error);
      res.status(500).json({ error: 'Failed to get plan metrics' });
    }
  }
}

module.exports = new PlanController();