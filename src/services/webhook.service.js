const crypto = require('crypto');
const axios = require('axios');
const logger = require('../config/logger');
const WebhookLog = require('../models/WebhookLog');
const Merchant = require('../models/Merchant');
const { queues } = require('../config/queue');

class WebhookService {
  constructor() {
    this.maxRetries = parseInt(process.env.WEBHOOK_MAX_RETRIES) || 5;
    this.retryDelay = parseInt(process.env.WEBHOOK_RETRY_DELAY) || 1000;
    this.timeout = parseInt(process.env.WEBHOOK_TIMEOUT) || 10000;
  }

  generateSignature(payload, secret) {
    const hmac = crypto.createHmac('sha256', secret);
    const signature = hmac.update(JSON.stringify(payload)).digest('hex');
    return signature;
  }

  verifySignature(payload, signature, secret) {
    const expectedSignature = this.generateSignature(payload, secret);
    return crypto.timingSafeEqual(
      Buffer.from(signature),
      Buffer.from(expectedSignature)
    );
  }

  async deliverWebhook(merchantId, eventType, payload, webhookUrl, secret) {
    try {
      // Create webhook log
      const webhookLog = new WebhookLog({
        merchantId,
        eventType,
        payload,
        webhookUrl,
        status: 'pending'
      });

      await webhookLog.save();

      // Generate signature
      const signature = this.generateSignature(payload, secret);

      // Prepare headers
      const headers = {
        'Content-Type': 'application/json',
        'X-FlowPay-Signature': signature,
        'X-FlowPay-Event': eventType,
        'X-FlowPay-Timestamp': Date.now().toString(),
        'X-FlowPay-Delivery': webhookLog._id.toString()
      };

      // Add merchant custom headers
      const merchant = await Merchant.findById(merchantId);
      if (merchant && merchant.webhookHeaders) {
        Object.entries(merchant.webhookHeaders).forEach(([key, value]) => {
          headers[key] = value;
        });
      }

      // Send webhook
      const response = await axios.post(webhookUrl, payload, {
        headers,
        timeout: this.timeout,
        validateStatus: null
      });

      // Record attempt
      webhookLog.recordAttempt(response.status, response.data);

      // Check if successful
      if (response.status >= 200 && response.status < 300) {
        webhookLog.markDelivered();
        logger.info(`Webhook delivered successfully to ${webhookUrl}`);
      } else {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      await webhookLog.save();

    } catch (error) {
      logger.error(`Webhook delivery failed: ${error.message}`);

      // Find or create webhook log
      let webhookLog = await WebhookLog.findOne({
        merchantId,
        eventType,
        'payload.subscriptionId': payload.subscriptionId,
        createdAt: { $gte: new Date(Date.now() - 60000) }
      });

      if (!webhookLog) {
        webhookLog = new WebhookLog({
          merchantId,
          eventType,
          payload,
          webhookUrl,
          status: 'failed'
        });
      }

      webhookLog.recordAttempt(null, null, error);

      // Schedule retry if attempts remain
      if (webhookLog.retryCount < this.maxRetries) {
        const delay = this.retryDelay * Math.pow(2, webhookLog.retryCount);
        webhookLog.scheduleRetry(delay);
        
        // Schedule retry job
        await queues.webhookDelivery.add(
          `retry-${webhookLog._id}`,
          {
            merchantId,
            eventType,
            payload,
            webhookUrl,
            secret
          },
          { delay }
        );
      } else {
        webhookLog.markFailed();
      }

      await webhookLog.save();
    }
  }

  async retryFailedWebhooks() {
    try {
      const pendingRetries = await WebhookLog.findPendingRetries();

      for (const log of pendingRetries) {
        const merchant = await Merchant.findById(log.merchantId).select('+webhookSecret');
        
        if (!merchant || !merchant.webhookEnabled) {
          log.markFailed();
          await log.save();
          continue;
        }

        await this.deliverWebhook(
          log.merchantId,
          log.eventType,
          log.payload,
          log.webhookUrl,
          merchant.webhookSecret
        );
      }
    } catch (error) {
      logger.error('Error retrying webhooks:', error);
    }
  }

  async testWebhook(merchantId, webhookUrl, secret, eventType = 'test.event') {
    const testPayload = {
      test: true,
      timestamp: new Date().toISOString(),
      message: 'This is a test webhook from FlowPay'
    };

    try {
      const signature = this.generateSignature(testPayload, secret);

      const response = await axios.post(webhookUrl, testPayload, {
        headers: {
          'Content-Type': 'application/json',
          'X-FlowPay-Signature': signature,
          'X-FlowPay-Event': eventType,
          'X-FlowPay-Timestamp': Date.now().toString(),
          'X-FlowPay-Test': 'true'
        },
        timeout: 5000
      });

      return {
        success: true,
        statusCode: response.status,
        response: response.data
      };

    } catch (error) {
      return {
        success: false,
        error: error.message,
        statusCode: error.response?.status
      };
    }
  }

  async getWebhookLogs(merchantId, limit = 50) {
    return WebhookLog.findByMerchant(merchantId, limit);
  }
}

module.exports = new WebhookService();