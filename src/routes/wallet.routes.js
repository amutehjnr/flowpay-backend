const express = require('express');
const router = express.Router();
const walletController = require('../controllers/wallet.controller');
const { authenticateJWT, optionalAuth } = require('../middleware/auth');
const { walletConnectValidation } = require('../middleware/validation');

/**
 * @swagger
 * tags:
 *   name: Wallet
 *   description: Wallet management endpoints
 */

/**
 * @swagger
 * /wallet/connect:
 *   post:
 *     summary: Initiate wallet connection
 *     tags: [Wallet]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - walletAddress
 *             properties:
 *               walletAddress:
 *                 type: string
 *                 pattern: '^0x[a-fA-F0-9]{40}$'
 *     responses:
 *       200:
 *         description: Message to sign
 *       400:
 *         description: Invalid wallet address
 */
router.post('/connect', authenticateJWT, walletConnectValidation, walletController.connect);

/**
 * @swagger
 * /wallet/verify-signature:
 *   post:
 *     summary: Verify wallet signature
 *     tags: [Wallet]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - walletAddress
 *               - signature
 *               - message
 *             properties:
 *               walletAddress:
 *                 type: string
 *               signature:
 *                 type: string
 *               message:
 *                 type: string
 *     responses:
 *       200:
 *         description: Wallet verified and connected
 *       401:
 *         description: Invalid signature
 */
router.post('/verify-signature', authenticateJWT, walletConnectValidation, walletController.verifySignature);

/**
 * @swagger
 * /wallet/disconnect:
 *   post:
 *     summary: Disconnect wallet
 *     tags: [Wallet]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Wallet disconnected
 */
router.post('/disconnect', authenticateJWT, walletController.disconnect);

/**
 * @swagger
 * /wallet/{walletAddress}:
 *   get:
 *     summary: Get wallet information
 *     tags: [Wallet]
 *     parameters:
 *       - in: path
 *         name: walletAddress
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Wallet information
 *       400:
 *         description: Invalid wallet address
 */
router.get('/:walletAddress', optionalAuth, walletController.getWalletInfo);

/**
 * @swagger
 * /wallet/allowance/check:
 *   post:
 *     summary: Check token allowance
 *     tags: [Wallet]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - walletAddress
 *               - tokenAddress
 *             properties:
 *               walletAddress:
 *                 type: string
 *               tokenAddress:
 *                 type: string
 *               amount:
 *                 type: string
 *     responses:
 *       200:
 *         description: Allowance information
 */
router.post('/allowance/check', walletController.checkAllowance);

/**
 * @swagger
 * /wallet/{walletAddress}/balance:
 *   get:
 *     summary: Get wallet balance
 *     tags: [Wallet]
 *     parameters:
 *       - in: path
 *         name: walletAddress
 *         required: true
 *         schema:
 *           type: string
 *       - in: query
 *         name: tokenAddress
 *         schema:
 *           type: string
 *         description: Token address (optional, returns native balance if not provided)
 *     responses:
 *       200:
 *         description: Wallet balance
 */
router.get('/:walletAddress/balance', walletController.getBalance);

module.exports = router;