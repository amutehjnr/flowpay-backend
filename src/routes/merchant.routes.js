const express = require('express');
const router = express.Router();
const merchantController = require('../controllers/merchant.controller');
const { authenticateJWT, requireRole } = require('../middleware/auth');
const { webhookConfigValidation } = require('../middleware/validation');
const { createTieredLimiter } = require('../middleware/rateLimiter');

/**
 * @swagger
 * tags:
 *   name: Merchant
 *   description: Merchant management endpoints
 */

// Apply authentication and role check to all routes
router.use(authenticateJWT);
router.use(requireRole(['merchant']));

/**
 * @swagger
 * /merchant/profile:
 *   get:
 *     summary: Get merchant profile
 *     tags: [Merchant]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Merchant profile
 *       404:
 *         description: Merchant not found
 */
router.get('/profile', merchantController.getProfile);

/**
 * @swagger
 * /merchant/profile:
 *   put:
 *     summary: Update merchant profile
 *     tags: [Merchant]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               brandName:
 *                 type: string
 *               brandStage:
 *                 type: string
 *                 enum: [startup, growth, enterprise]
 *               settings:
 *                 type: object
 *     responses:
 *       200:
 *         description: Profile updated
 */
router.put('/profile', merchantController.updateProfile);

/**
 * @swagger
 * /merchant/webhook:
 *   post:
 *     summary: Configure webhook
 *     tags: [Merchant]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               webhookUrl:
 *                 type: string
 *                 format: uri
 *               webhookEvents:
 *                 type: array
 *                 items:
 *                   type: string
 *               webhookEnabled:
 *                 type: boolean
 *               webhookHeaders:
 *                 type: object
 *     responses:
 *       200:
 *         description: Webhook configured
 */
router.post('/webhook', webhookConfigValidation, merchantController.configureWebhook);

/**
 * @swagger
 * /merchant/api-keys/regenerate:
 *   post:
 *     summary: Regenerate API key
 *     tags: [Merchant]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: New API key generated
 */
router.post('/api-keys/regenerate', merchantController.regenerateApiKey);

/**
 * @swagger
 * /merchant/webhook/regenerate-secret:
 *   post:
 *     summary: Regenerate webhook secret
 *     tags: [Merchant]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: New webhook secret generated
 */
router.post('/webhook/regenerate-secret', merchantController.regenerateWebhookSecret);

/**
 * @swagger
 * /merchant/webhook/logs:
 *   get:
 *     summary: Get webhook delivery logs
 *     tags: [Merchant]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 50
 *     responses:
 *       200:
 *         description: Webhook logs
 */
router.get('/webhook/logs', merchantController.getWebhookLogs);

/**
 * @swagger
 * /merchant/webhook/test:
 *   post:
 *     summary: Test webhook configuration
 *     tags: [Merchant]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Webhook test result
 */
router.post('/webhook/test', merchantController.testWebhook);

/**
 * @swagger
 * /merchant/dashboard/metrics:
 *   get:
 *     summary: Get dashboard metrics
 *     tags: [Merchant]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: period
 *         schema:
 *           type: string
 *           enum: [7d, 30d, 90d]
 *           default: 30d
 *     responses:
 *       200:
 *         description: Dashboard metrics
 */
router.get('/dashboard/metrics', merchantController.getDashboardMetrics);

/**
 * @swagger
 * /merchant/plans:
 *   get:
 *     summary: Get merchant plans
 *     tags: [Merchant]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: activeOnly
 *         schema:
 *           type: boolean
 *           default: true
 *     responses:
 *       200:
 *         description: List of plans
 */
router.get('/plans', merchantController.getPlans);

/**
 * @swagger
 * /merchant/subscriptions:
 *   get:
 *     summary: Get merchant subscriptions
 *     tags: [Merchant]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: status
 *         schema:
 *           type: string
 *           enum: [active, paused, canceled, expired, grace_period, completed]
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 50
 *       - in: query
 *         name: skip
 *         schema:
 *           type: integer
 *           default: 0
 *     responses:
 *       200:
 *         description: List of subscriptions
 */
router.get('/subscriptions', merchantController.getSubscriptions);

/**
 * @swagger
 * /merchant/revenue:
 *   get:
 *     summary: Get revenue report
 *     tags: [Merchant]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: startDate
 *         schema:
 *           type: string
 *           format: date
 *       - in: query
 *         name: endDate
 *         schema:
 *           type: string
 *           format: date
 *       - in: query
 *         name: groupBy
 *         schema:
 *           type: string
 *           enum: [hour, day, week, month]
 *           default: day
 *     responses:
 *       200:
 *         description: Revenue report
 */
router.get('/revenue', merchantController.getRevenueReport);

module.exports = router;