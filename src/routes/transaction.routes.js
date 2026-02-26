const express = require('express');
const router = express.Router();
const transactionController = require('../controllers/transaction.controller');
const { authenticateJWT, optionalAuth, authenticateApiKey } = require('../middleware/auth');
const { transactionQueryValidation } = require('../middleware/validation');

/**
 * @swagger
 * tags:
 *   name: Transactions
 *   description: Transaction management
 */

/**
 * @swagger
 * /transactions/{wallet}:
 *   get:
 *     summary: Get transactions for a wallet
 *     tags: [Transactions]
 *     parameters:
 *       - in: path
 *         name: wallet
 *         required: true
 *         schema:
 *           type: string
 *       - in: query
 *         name: from
 *         schema:
 *           type: string
 *           format: date
 *       - in: query
 *         name: to
 *         schema:
 *           type: string
 *           format: date
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
 *         description: List of transactions
 */
router.get('/:wallet', optionalAuth, transactionQueryValidation, transactionController.getUserTransactions);

/**
 * @swagger
 * /transactions/subscription/{subscriptionId}:
 *   get:
 *     summary: Get transactions for a subscription
 *     tags: [Transactions]
 *     parameters:
 *       - in: path
 *         name: subscriptionId
 *         required: true
 *         schema:
 *           type: integer
 *     responses:
 *       200:
 *         description: List of transactions
 */
router.get('/subscription/:subscriptionId', transactionController.getSubscriptionTransactions);

/**
 * @swagger
 * /transactions/detail/{txHash}:
 *   get:
 *     summary: Get transaction details
 *     tags: [Transactions]
 *     parameters:
 *       - in: path
 *         name: txHash
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Transaction details
 *       404:
 *         description: Transaction not found
 */
router.get('/detail/:txHash', transactionController.getTransaction);

/**
 * @swagger
 * /transactions/{wallet}/stats:
 *   get:
 *     summary: Get transaction statistics
 *     tags: [Transactions]
 *     parameters:
 *       - in: path
 *         name: wallet
 *         required: true
 *         schema:
 *           type: string
 *       - in: query
 *         name: period
 *         schema:
 *           type: string
 *           enum: [7d, 30d, 90d]
 *           default: 30d
 *     responses:
 *       200:
 *         description: Transaction statistics
 */
router.get('/:wallet/stats', transactionController.getTransactionStats);

/**
 * @swagger
 * /transactions/{wallet}/export:
 *   get:
 *     summary: Export transactions
 *     tags: [Transactions]
 *     parameters:
 *       - in: path
 *         name: wallet
 *         required: true
 *         schema:
 *           type: string
 *       - in: query
 *         name: from
 *         schema:
 *           type: string
 *           format: date
 *       - in: query
 *         name: to
 *         schema:
 *           type: string
 *           format: date
 *       - in: query
 *         name: format
 *         schema:
 *           type: string
 *           enum: [json, csv]
 *           default: json
 *     responses:
 *       200:
 *         description: Exported transactions
 */
router.get('/:wallet/export', authenticateJWT, transactionController.exportTransactions);

module.exports = router;