const express = require('express');
const router = express.Router();
const planController = require('../controllers/plan.controller');
const { authenticateJWT, requireRole, authenticateApiKey } = require('../middleware/auth');
const { createPlanValidation } = require('../middleware/validation');
const { createTieredLimiter } = require('../middleware/rateLimiter');

/**
 * @swagger
 * tags:
 *   name: Plans
 *   description: Subscription plan management
 */

/**
 * @swagger
 * /plans/create:
 *   post:
 *     summary: Create a new subscription plan
 *     tags: [Plans]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - amountPerInterval
 *               - interval
 *               - totalIntervals
 *               - paymentToken
 *               - gracePeriod
 *             properties:
 *               amountPerInterval:
 *                 type: string
 *                 description: Amount per interval in wei
 *               interval:
 *                 type: integer
 *                 description: Interval in seconds (86400 - 31536000)
 *               totalIntervals:
 *                 type: integer
 *                 description: Total number of intervals (1-1000)
 *               paymentToken:
 *                 type: string
 *                 description: Token contract address
 *               gracePeriod:
 *                 type: integer
 *                 description: Grace period in seconds (0-2592000)
 *               metadata:
 *                 type: object
 *                 properties:
 *                   name:
 *                     type: string
 *                   description:
 *                     type: string
 *                   image:
 *                     type: string
 *     responses:
 *       201:
 *         description: Plan created successfully
 *       400:
 *         description: Validation error
 *       403:
 *         description: Unauthorized
 */
router.post('/create', 
  authenticateJWT, 
  requireRole(['merchant']), 
  createPlanValidation, 
  planController.createPlan
);

/**
 * @swagger
 * /plans/{merchantId}:
 *   get:
 *     summary: Get plans for a merchant
 *     tags: [Plans]
 *     parameters:
 *       - in: path
 *         name: merchantId
 *         required: true
 *         schema:
 *           type: string
 *       - in: query
 *         name: active
 *         schema:
 *           type: boolean
 *           default: true
 *     responses:
 *       200:
 *         description: List of plans
 */
router.get('/:merchantId', planController.getPlans);

/**
 * @swagger
 * /plans/detail/{planId}:
 *   get:
 *     summary: Get plan details
 *     tags: [Plans]
 *     parameters:
 *       - in: path
 *         name: planId
 *         required: true
 *         schema:
 *           type: integer
 *     responses:
 *       200:
 *         description: Plan details
 *       404:
 *         description: Plan not found
 */
router.get('/detail/:planId', planController.getPlan);

/**
 * @swagger
 * /plans/deactivate/{planId}:
 *   put:
 *     summary: Deactivate a plan
 *     tags: [Plans]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: planId
 *         required: true
 *         schema:
 *           type: integer
 *     responses:
 *       200:
 *         description: Plan deactivated
 *       403:
 *         description: Unauthorized
 *       404:
 *         description: Plan not found
 */
router.put('/deactivate/:planId', 
  authenticateJWT, 
  requireRole(['merchant']), 
  planController.deactivatePlan
);

/**
 * @swagger
 * /plans/{planId}/grace-period:
 *   put:
 *     summary: Update plan grace period
 *     tags: [Plans]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: planId
 *         required: true
 *         schema:
 *           type: integer
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - gracePeriod
 *             properties:
 *               gracePeriod:
 *                 type: integer
 *     responses:
 *       200:
 *         description: Plan updated
 */
router.put('/:planId/grace-period', 
  authenticateJWT, 
  requireRole(['merchant']), 
  planController.updateGracePeriod
);

/**
 * @swagger
 * /plans/{planId}/metrics:
 *   get:
 *     summary: Get plan metrics
 *     tags: [Plans]
 *     security:
 *       - apiKey: []
 *     parameters:
 *       - in: path
 *         name: planId
 *         required: true
 *         schema:
 *           type: integer
 *     responses:
 *       200:
 *         description: Plan metrics
 */
router.get('/:planId/metrics', 
  authenticateApiKey, 
  planController.getPlanMetrics
);

module.exports = router;