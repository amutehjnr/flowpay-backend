const { ethers } = require('ethers');
const User = require('../models/User');
const Merchant = require('../models/Merchant');
const Subscription = require('../models/Subscription');
const Transaction = require('../models/Transaction');
const blockchainService = require('../services/blockchain.service');
const logger = require('../config/logger');
const redisClient = require('../config/redis');
const crypto = require('crypto');

class WalletController {

  validateAddress(address) {
    if (!ethers.isAddress(address)) {
      throw new Error('Invalid wallet address');
    }
  }

  validateTokenAddress(address) {
    if (!ethers.isAddress(address)) {
      throw new Error('Invalid token address');
    }
  }

  async connect(req, res) {
    try {
      const { walletAddress } = req.body;
      this.validateAddress(walletAddress);

      const nonce = Math.floor(Math.random() * 1000000).toString();
      const message = `Connect to FlowPay\nNonce: ${nonce}`;

      // Store nonce in Redis for 5 minutes
      await redisClient.set(
        `walletNonce:${walletAddress.toLowerCase()}`,
        nonce,
        'EX',
        300
      );

      res.json({
        message: 'Please sign this message to verify ownership',
        messageToSign: message,
        nonce
      });
    } catch (error) {
      logger.error('Wallet connect error:', error);
      res.status(500).json({ error: 'Failed to initiate wallet connection' });
    }
  }

  async verifySignature(req, res) {
    try {
      const { walletAddress, signature, message } = req.body;
      this.validateAddress(walletAddress);

      const storedNonce = await redisClient.get(`walletNonce:${walletAddress.toLowerCase()}`);
      if (!storedNonce) {
        return res.status(400).json({ error: 'Invalid or expired nonce' });
      }

      // Recover address
      const recoveredAddress = ethers.verifyMessage(message, signature);
      if (recoveredAddress.toLowerCase() !== walletAddress.toLowerCase()) {
        return res.status(401).json({ error: 'Invalid signature' });
      }

      // Update user's wallet address
      const user = req.user;
      user.walletAddress = walletAddress.toLowerCase();
      await user.save();

      // Remove nonce from Redis
      await redisClient.del(`walletNonce:${walletAddress.toLowerCase()}`);

      logger.info(`Wallet connected for user: ${user.email}, wallet: ${walletAddress}`);

      res.json({
        message: 'Wallet connected successfully',
        walletAddress: user.walletAddress
      });
    } catch (error) {
      logger.error('Verify signature error:', error);
      res.status(500).json({ error: 'Failed to verify signature' });
    }
  }

  async disconnect(req, res) {
    try {
      const user = req.user;
      const oldWallet = user.walletAddress;
      user.walletAddress = undefined;
      await user.save();

      logger.info(`Wallet disconnected for user: ${user.email}, wallet: ${oldWallet}`);

      res.json({ message: 'Wallet disconnected successfully' });
    } catch (error) {
      logger.error('Wallet disconnect error:', error);
      res.status(500).json({ error: 'Failed to disconnect wallet' });
    }
  }

  async getWalletInfo(req, res) {
    try {
      const { walletAddress } = req.params;
      this.validateAddress(walletAddress);

      const user = await User.findByWallet(walletAddress.toLowerCase());
      const subscriptions = await Subscription.findBySubscriber(walletAddress.toLowerCase());
      const transactions = await Transaction.findBySubscriber(walletAddress.toLowerCase(), 10);

      res.json({
        walletAddress: walletAddress.toLowerCase(),
        user: user ? {
          id: user._id,
          name: `${user.firstName} ${user.lastName}`,
          email: user.email
        } : null,
        subscriptions: subscriptions.length,
        recentTransactions: transactions
      });
    } catch (error) {
      logger.error(`Get wallet info error for wallet ${req.params.walletAddress}:`, error);
      res.status(500).json({ error: 'Failed to get wallet information' });
    }
  }

  async checkAllowance(req, res) {
    try {
      const { walletAddress, tokenAddress, amount } = req.body;
      this.validateAddress(walletAddress);
      this.validateTokenAddress(tokenAddress);

      const allowance = await blockchainService.contract.tokenAllowances(
        walletAddress.toLowerCase(),
        tokenAddress.toLowerCase()
      );

      const hasEnoughAllowance = BigInt(allowance) >= BigInt(amount || 0);

      res.json({
        walletAddress,
        tokenAddress,
        allowance: allowance.toString(),
        hasEnoughAllowance
      });
    } catch (error) {
      logger.error(`Check allowance error for wallet ${req.body.walletAddress}:`, error);
      res.status(500).json({ error: 'Failed to check allowance' });
    }
  }

  async getBalance(req, res) {
    try {
      const { walletAddress, tokenAddress } = req.params;
      this.validateAddress(walletAddress);

      let balance;
      let decimals = 18;
      let symbol = 'AVAX';

      if (tokenAddress) {
        this.validateTokenAddress(tokenAddress);

        const tokenContract = new ethers.Contract(
          tokenAddress,
          [
            'function balanceOf(address) view returns (uint256)',
            'function decimals() view returns (uint8)',
            'function symbol() view returns (string)'
          ],
          blockchainService.provider
        );

        balance = await tokenContract.balanceOf(walletAddress);
        decimals = await tokenContract.decimals().catch(() => 18);
        symbol = await tokenContract.symbol().catch(() => 'TOKEN');
      } else {
        balance = await blockchainService.provider.getBalance(walletAddress);
      }

      res.json({
        walletAddress: walletAddress.toLowerCase(),
        tokenAddress: tokenAddress?.toLowerCase(),
        balance: balance.toString(),
        formatted: ethers.formatUnits(balance, decimals),
        symbol
      });
    } catch (error) {
      logger.error(`Get balance error for wallet ${req.params.walletAddress}:`, error);
      res.status(500).json({ error: 'Failed to get balance' });
    }
  }
}

module.exports = new WalletController();