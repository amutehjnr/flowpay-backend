const Merchant = require('../models/Merchant');
const User = require('../models/User');
const webhookService = require('../services/webhook.service');
const subscriptionService = require('../services/subscription.service');
const paymentService = require('../services/payment.service');
const logger = require('../config/logger');
const crypto = require('crypto');
const Transaction = require('../models/Transaction');

class MerchantController {
  async getProfile(req, res) {
    try {
      const merchant = await Merchant.findOne({ ownerId: req.user._id });
      
      if (!merchant) {
        return res.status(404).json({ error: 'Merchant profile not found' });
      }

      res.json(merchant);
    } catch (error) {
      logger.error('Get merchant profile error:', error);
      res.status(500).json({ error: 'Failed to get merchant profile' });
    }
  }

  async updateProfile(req, res) {
    try {
      const { brandName, brandStage, settings } = req.body;

      const merchant = await Merchant.findOne({ ownerId: req.user._id });
      
      if (!merchant) {
        return res.status(404).json({ error: 'Merchant profile not found' });
      }

      if (brandName) merchant.brandName = brandName;
      if (brandStage) merchant.brandStage = brandStage;
      if (settings) {
        merchant.settings = {
          ...merchant.settings,
          ...settings
        };
      }

      await merchant.save();

      logger.info(`Merchant profile updated: ${merchant._id}`);

      res.json({
        message: 'Profile updated successfully',
        merchant
      });
    } catch (error) {
      logger.error('Update merchant profile error:', error);
      res.status(500).json({ error: 'Failed to update merchant profile' });
    }
  }

  async configureWebhook(req, res) {
    try {
      const { webhookUrl, webhookEvents, webhookEnabled, webhookHeaders } = req.body;

      const merchant = await Merchant.findOne({ ownerId: req.user._id }).select('+webhookSecret');
      
      if (!merchant) {
        return res.status(404).json({ error: 'Merchant profile not found' });
      }

      if (webhookUrl) merchant.webhookUrl = webhookUrl;
      if (webhookEvents) merchant.webhookEvents = webhookEvents;
      if (webhookEnabled !== undefined) merchant.webhookEnabled = webhookEnabled;
      if (webhookHeaders) merchant.webhookHeaders = webhookHeaders;

      await merchant.save();

      // Test the webhook if URL changed
      if (webhookUrl) {
        const testResult = await webhookService.testWebhook(
          merchant._id,
          merchant.webhookUrl,
          merchant.webhookSecret,
          'webhook.test'
        );

        logger.info(`Webhook test for merchant ${merchant._id}:`, testResult);
      }

      res.json({
        message: 'Webhook configuration updated',
        merchant: {
          webhookUrl: merchant.webhookUrl,
          webhookEvents: merchant.webhookEvents,
          webhookEnabled: merchant.webhookEnabled,
          webhookSecret: merchant.webhookSecret // Only returned on configure
        }
      });
    } catch (error) {
      logger.error('Configure webhook error:', error);
      res.status(500).json({ error: 'Failed to configure webhook' });
    }
  }

  async regenerateApiKey(req, res) {
    try {
      const merchant = await Merchant.findOne({ ownerId: req.user._id });
      
      if (!merchant) {
        return res.status(404).json({ error: 'Merchant profile not found' });
      }

      merchant.regenerateApiKey();
      await merchant.save();

      logger.info(`API key regenerated for merchant: ${merchant._id}`);

      res.json({
        message: 'API key regenerated successfully',
        apiKey: merchant.fullApiKey,
        apiKeyPrefix: merchant.apiKeyPrefix
      });
    } catch (error) {
      logger.error('Regenerate API key error:', error);
      res.status(500).json({ error: 'Failed to regenerate API key' });
    }
  }

  async regenerateWebhookSecret(req, res) {
    try {
      const merchant = await Merchant.findOne({ ownerId: req.user._id }).select('+webhookSecret');
      
      if (!merchant) {
        return res.status(404).json({ error: 'Merchant profile not found' });
      }

      merchant.regenerateWebhookSecret();
      await merchant.save();

      logger.info(`Webhook secret regenerated for merchant: ${merchant._id}`);

      res.json({
        message: 'Webhook secret regenerated successfully',
        webhookSecret: merchant.webhookSecret
      });
    } catch (error) {
      logger.error('Regenerate webhook secret error:', error);
      res.status(500).json({ error: 'Failed to regenerate webhook secret' });
    }
  }

  async getWebhookLogs(req, res) {
    try {
      const merchant = await Merchant.findOne({ ownerId: req.user._id });
      
      if (!merchant) {
        return res.status(404).json({ error: 'Merchant profile not found' });
      }

      const { limit = 50 } = req.query;
      const logs = await webhookService.getWebhookLogs(merchant._id, parseInt(limit));

      res.json(logs);
    } catch (error) {
      logger.error('Get webhook logs error:', error);
      res.status(500).json({ error: 'Failed to get webhook logs' });
    }
  }

  async testWebhook(req, res) {
    try {
      const merchant = await Merchant.findOne({ ownerId: req.user._id }).select('+webhookSecret');
      
      if (!merchant || !merchant.webhookUrl) {
        return res.status(400).json({ error: 'Webhook URL not configured' });
      }

      const result = await webhookService.testWebhook(
        merchant._id,
        merchant.webhookUrl,
        merchant.webhookSecret
      );

      res.json(result);
    } catch (error) {
      logger.error('Test webhook error:', error);
      res.status(500).json({ error: 'Failed to test webhook' });
    }
  }

  async getDashboardMetrics(req, res) {
    try {
      const merchant = await Merchant.findOne({ ownerId: req.user._id });
      
      if (!merchant) {
        return res.status(404).json({ error: 'Merchant profile not found' });
      }

      const { period = '30d' } = req.query;

      const [subscriptionMetrics, paymentMetrics] = await Promise.all([
        subscriptionService.getSubscriptionMetrics(merchant._id, period),
        paymentService.getPaymentMetrics(merchant._id, period)
      ]);

      res.json({
        period,
        subscriptionMetrics,
        paymentMetrics
      });
    } catch (error) {
      logger.error('Get dashboard metrics error:', error);
      res.status(500).json({ error: 'Failed to get dashboard metrics' });
    }
  }

  async getPlans(req, res) {
    try {
      const merchant = await Merchant.findOne({ ownerId: req.user._id });
      
      if (!merchant) {
        return res.status(404).json({ error: 'Merchant profile not found' });
      }

      const { activeOnly = true } = req.query;
      const plans = await Plan.find({ 
        merchantId: merchant._id,
        ...(activeOnly && { isActive: true })
      }).sort({ createdAt: -1 });

      res.json(plans);
    } catch (error) {
      logger.error('Get merchant plans error:', error);
      res.status(500).json({ error: 'Failed to get plans' });
    }
  }

  async getSubscriptions(req, res) {
    try {
      const merchant = await Merchant.findOne({ ownerId: req.user._id });
      
      if (!merchant) {
        return res.status(404).json({ error: 'Merchant profile not found' });
      }

      const { status, limit = 50, skip = 0 } = req.query;

      const query = { merchantId: merchant._id };
      if (status) query.status = status;

      const subscriptions = await Subscription.find(query)
        .sort({ createdAt: -1 })
        .limit(parseInt(limit))
        .skip(parseInt(skip))
        .populate('planId');

      const total = await Subscription.countDocuments(query);

      res.json({
        subscriptions,
        pagination: {
          total,
          limit: parseInt(limit),
          skip: parseInt(skip),
          pages: Math.ceil(total / parseInt(limit))
        }
      });
    } catch (error) {
      logger.error('Get merchant subscriptions error:', error);
      res.status(500).json({ error: 'Failed to get subscriptions' });
    }
  }

  async getRevenueReport(req, res) {
    try {
      const merchant = await Merchant.findOne({ ownerId: req.user._id });
      
      if (!merchant) {
        return res.status(404).json({ error: 'Merchant profile not found' });
      }

      const { startDate, endDate, groupBy = 'day' } = req.query;

      const start = startDate ? new Date(startDate) : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
      const end = endDate ? new Date(endDate) : new Date();

      const revenue = await Transaction.aggregate([
        {
          $match: {
            merchantId: merchant._id,
            status: 'confirmed',
            timestamp: { $gte: start, $lte: end }
          }
        },
        {
          $group: {
            _id: this.getGroupByExpression(groupBy, '$timestamp'),
            total: { $sum: { $toDecimal: '$amount' } },
            count: { $sum: 1 }
          }
        },
        { $sort: { '_id': 1 } }
      ]);

      res.json({
        period: { start, end },
        groupBy,
        revenue
      });
    } catch (error) {
      logger.error('Get revenue report error:', error);
      res.status(500).json({ error: 'Failed to get revenue report' });
    }
  }

  getGroupByExpression(groupBy, field) {
    switch (groupBy) {
      case 'hour':
        return {
          year: { $year: field },
          month: { $month: field },
          day: { $dayOfMonth: field },
          hour: { $hour: field }
        };
      case 'day':
        return {
          year: { $year: field },
          month: { $month: field },
          day: { $dayOfMonth: field }
        };
      case 'week':
        return {
          year: { $year: field },
          week: { $week: field }
        };
      case 'month':
        return {
          year: { $year: field },
          month: { $month: field }
        };
      default:
        return {
          year: { $year: field },
          month: { $month: field },
          day: { $dayOfMonth: field }
        };
    }
  }
}

module.exports = new MerchantController();