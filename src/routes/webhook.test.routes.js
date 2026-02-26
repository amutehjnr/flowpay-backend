const express = require('express');
const router = express.Router();
const webhookService = require('../services/webhook.service');
const { webhookLimiter } = require('../middleware/rateLimiter');

/**
 * @swagger
 * /webhooks/test:
 *   post:
 *     summary: Test webhook endpoint
 *     tags: [Webhooks]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - webhookUrl
 *               - secret
 *             properties:
 *               webhookUrl:
 *                 type: string
 *                 format: uri
 *               secret:
 *                 type: string
 *               eventType:
 *                 type: string
 *                 default: test.event
 *     responses:
 *       200:
 *         description: Webhook test result
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 statusCode:
 *                   type: integer
 *                 response:
 *                   type: object
 *                 error:
 *                   type: string
 */
router.post('/test', webhookLimiter, async (req, res) => {
  try {
    const { webhookUrl, secret, eventType } = req.body;

    if (!webhookUrl || !secret) {
      return res.status(400).json({ error: 'webhookUrl and secret are required' });
    }

    const result = await webhookService.testWebhook(
      null, // No merchant ID for test
      webhookUrl,
      secret,
      eventType || 'test.event'
    );

    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;