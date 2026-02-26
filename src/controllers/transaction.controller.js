const Transaction = require('../models/Transaction');
const Subscription = require('../models/Subscription');
const logger = require('../config/logger');

class TransactionController {
  async getUserTransactions(req, res) {
    try {
      const wallet = req.params.wallet.toLowerCase();
      const limit = Number(req.query.limit) || 50;
      const skip = Number(req.query.skip) || 0;
      const { from, to } = req.query;

      const query = { subscriberWallet: wallet };

      if (from || to) {
        query.timestamp = {};
        if (from) query.timestamp.$gte = new Date(from);
        if (to) query.timestamp.$lte = new Date(to);
      }

      const transactions = await Transaction.find(query)
        .sort({ timestamp: -1 })
        .limit(limit)
        .skip(skip);

      const total = await Transaction.countDocuments(query);

      res.json({
        transactions,
        pagination: {
          total,
          limit,
          skip,
          pages: Math.ceil(total / limit)
        }
      });
    } catch (error) {
      logger.error('Get user transactions error:', error);
      res.status(500).json({ error: 'Failed to get transactions' });
    }
  }

  async getSubscriptionTransactions(req, res) {
    try {
      const subscriptionId = Number(req.params.subscriptionId);
      const transactions = await Transaction.findBySubscription(subscriptionId);

      res.json(transactions);
    } catch (error) {
      logger.error('Get subscription transactions error:', error);
      res.status(500).json({ error: 'Failed to get transactions' });
    }
  }

  async getTransaction(req, res) {
    try {
      const { txHash } = req.params;
      const transaction = await Transaction.findByTxHash(txHash);

      if (!transaction) return res.status(404).json({ error: 'Transaction not found' });

      res.json(transaction);
    } catch (error) {
      logger.error('Get transaction error:', error);
      res.status(500).json({ error: 'Failed to get transaction' });
    }
  }

  async getTransactionStats(req, res) {
    try {
      const wallet = req.params.wallet.toLowerCase();
      const period = req.query.period || '30d';

      const endDate = new Date();
      const startDate = new Date();

      switch (period) {
        case '7d':
          startDate.setDate(startDate.getDate() - 7);
          break;
        case '30d':
          startDate.setDate(startDate.getDate() - 30);
          break;
        case '90d':
          startDate.setDate(startDate.getDate() - 90);
          break;
        default:
          startDate.setDate(startDate.getDate() - 30);
      }

      const stats = await Transaction.aggregate([
        { $match: { subscriberWallet: wallet, timestamp: { $gte: startDate, $lte: endDate } } },
        { $group: { _id: '$status', count: { $sum: 1 }, total: { $sum: { $toDecimal: '$amount' } } } }
      ]);

      const byToken = await Transaction.aggregate([
        { $match: { subscriberWallet: wallet, status: 'confirmed', timestamp: { $gte: startDate, $lte: endDate } } },
        { $group: { _id: '$token', count: { $sum: 1 }, total: { $sum: { $toDecimal: '$amount' } } } }
      ]);

      res.json({
        period: { start: startDate, end: endDate },
        summary: {
          totalTransactions: stats.reduce((acc, s) => acc + s.count, 0),
          successful: stats.find(s => s._id === 'confirmed')?.count || 0,
          failed: stats.find(s => s._id === 'failed')?.count || 0,
          pending: stats.find(s => s._id === 'pending')?.count || 0,
          totalSpent: stats.find(s => s._id === 'confirmed')?.total?.toString() || '0'
        },
        byToken
      });
    } catch (error) {
      logger.error('Get transaction stats error:', error);
      res.status(500).json({ error: 'Failed to get transaction stats' });
    }
  }

  async exportTransactions(req, res) {
    try {
      const wallet = req.params.wallet.toLowerCase();
      const { from, to, format = 'json' } = req.query;

      const query = { subscriberWallet: wallet };
      if (from || to) {
        query.timestamp = {};
        if (from) query.timestamp.$gte = new Date(from);
        if (to) query.timestamp.$lte = new Date(to);
      }

      const transactions = await Transaction.find(query).sort({ timestamp: -1 }).lean();

      if (format === 'csv') {
        const csv = this.generateCSV(transactions);
        res.setHeader('Content-Type', 'text/csv');
        res.setHeader('Content-Disposition', `attachment; filename=transactions-${wallet}.csv`);
        return res.send(csv);
      }

      res.json(transactions);
    } catch (error) {
      logger.error('Export transactions error:', error);
      res.status(500).json({ error: 'Failed to export transactions' });
    }
  }

  generateCSV(transactions) {
    const headers = ['Transaction Hash', 'Subscription ID', 'Amount', 'Token', 'Status', 'Date', 'Block Number'];
    const rows = transactions.map(tx => [
      tx.txHash,
      tx.subscriptionId,
      tx.amount,
      tx.token,
      tx.status,
      tx.timestamp.toISOString(),
      tx.blockNumber || ''
    ]);

    return [headers.join(','), ...rows.map(row => row.map(cell => `"${cell}"`).join(','))].join('\n');
  }
}

module.exports = new TransactionController();