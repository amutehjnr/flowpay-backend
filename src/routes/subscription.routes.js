const express = require('express');
const router = express.Router();
const subscriptionController = require('../controllers/subscription.controller');
const { authenticateJWT, optionalAuth, authenticateApiKey } = require('../middleware/auth');
const { subscribeValidation } = require('../middleware/validation');

/**
 * @swagger
 * tags:
 *   name: Subscriptions
 *   description: Subscription management
 */

/**
 * @swagger
 * /subscriptions/create:
 *   post:
 *     summary: Create a new subscription
 *     tags: [Subscriptions]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - planId
 *               - subscriberWallet
 *             properties:
 *               planId:
 *                 type: integer
 *               subscriberWallet:
 *                 type: string
 *     responses:
 *       201:
 *         description: Subscription created
 */
router.post('/create', subscribeValidation, subscriptionController.subscribe);

/**
 * @swagger
 * /subscriptions/user/{wallet}:
 *   get:
 *     summary: Get user's subscriptions
 *     tags: [Subscriptions]
 *     parameters:
 *       - in: path
 *         name: wallet
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: List of subscriptions
 */
router.get('/user/:wallet', optionalAuth, subscriptionController.getUserSubscriptions);

/**
 * @swagger
 * /subscriptions/{id}:
 *   get:
 *     summary: Get subscription details
 *     tags: [Subscriptions]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *     responses:
 *       200:
 *         description: Subscription details
 *       404:
 *         description: Subscription not found
 */
router.get('/:id', subscriptionController.getSubscription);

/**
 * @swagger
 * /subscriptions/{subscriptionId}/status:
 *   get:
 *     summary: Get on-chain subscription status
 *     tags: [Subscriptions]
 *     parameters:
 *       - in: path
 *         name: subscriptionId
 *         required: true
 *         schema:
 *           type: integer
 *     responses:
 *       200:
 *         description: Subscription status
 */
router.get('/:subscriptionId/status', subscriptionController.getSubscriptionStatus);

/**
 * @swagger
 * /subscriptions/{subscriptionId}/cancel:
 *   post:
 *     summary: Cancel subscription
 *     tags: [Subscriptions]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: subscriptionId
 *         required: true
 *         schema:
 *           type: integer
 *     responses:
 *       200:
 *         description: Subscription cancelled
 */
router.post('/:subscriptionId/cancel', authenticateJWT, subscriptionController.cancelSubscription);

/**
 * @swagger
 * /subscriptions/{subscriptionId}/pause:
 *   post:
 *     summary: Pause subscription
 *     tags: [Subscriptions]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: subscriptionId
 *         required: true
 *         schema:
 *           type: integer
 *     responses:
 *       200:
 *         description: Subscription paused
 */
router.post('/:subscriptionId/pause', authenticateJWT, subscriptionController.pauseSubscription);

/**
 * @swagger
 * /subscriptions/{subscriptionId}/resume:
 *   post:
 *     summary: Resume subscription
 *     tags: [Subscriptions]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: subscriptionId
 *         required: true
 *         schema:
 *           type: integer
 *     responses:
 *       200:
 *         description: Subscription resumed
 */
router.post('/:subscriptionId/resume', authenticateJWT, subscriptionController.resumeSubscription);

/**
 * @swagger
 * /subscriptions/{subscriptionId}/execute-payment:
 *   post:
 *     summary: Execute payment for subscription
 *     tags: [Subscriptions]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: subscriptionId
 *         required: true
 *         schema:
 *           type: integer
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               callerIsSubscriber:
 *                 type: boolean
 *                 default: true
 *     responses:
 *       200:
 *         description: Payment executed
 */
router.post('/:subscriptionId/execute-payment', authenticateJWT, subscriptionController.executePayment);

/**
 * @swagger
 * /subscriptions/upcoming/renewals:
 *   get:
 *     summary: Get upcoming subscription renewals
 *     tags: [Subscriptions]
 *     security:
 *       - apiKey: []
 *     parameters:
 *       - in: query
 *         name: days
 *         schema:
 *           type: integer
 *           default: 7
 *     responses:
 *       200:
 *         description: Upcoming renewals
 */
router.get('/upcoming/renewals', authenticateApiKey, subscriptionController.getUpcomingRenewals);

module.exports = router;