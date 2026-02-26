const mongoose = require('mongoose');

const transactionSchema = new mongoose.Schema({
  txHash: {
    type: String,
    required: true,
    unique: true,
    index: true,
    lowercase: true
  },
  subscriptionId: {
    type: Number,
    required: true,
    index: true,
    ref: 'Subscription'
  },
  planId: {
    type: Number,
    required: true
  },
  merchantId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Merchant',
    required: true
  },
  subscriberWallet: {
    type: String,
    required: true,
    lowercase: true,
    index: true
  },
  amount: {
    type: String,
    required: true
  },
  token: {
    type: String,
    required: true,
    lowercase: true
  },
  paymentNumber: {
    type: Number,
    required: true
  },
  status: {
    type: String,
    enum: ['pending', 'confirmed', 'failed'],
    default: 'pending',
    index: true
  },
  blockNumber: {
    type: Number,
    index: true
  },
  timestamp: {
    type: Date,
    required: true,
    index: true
  },
  gasUsed: String,
  gasPrice: String,
  confirmations: {
    type: Number,
    default: 0
  },
  metadata: {
    type: Map,
    of: String
  },
  createdAt: {
    type: Date,
    default: Date.now,
    immutable: true
  }
});

// Indexes
transactionSchema.index({ subscriberWallet: 1, timestamp: -1 });
transactionSchema.index({ merchantId: 1, timestamp: -1 });
transactionSchema.index({ subscriptionId: 1, timestamp: -1 });

// Methods
transactionSchema.methods.confirm = function(blockNumber) {
  this.status = 'confirmed';
  this.blockNumber = blockNumber;
};

transactionSchema.methods.markFailed = function() {
  this.status = 'failed';
};

// Static methods
transactionSchema.statics.findByTxHash = function(txHash) {
  return this.findOne({ txHash: txHash.toLowerCase() });
};

transactionSchema.statics.findBySubscription = function(subscriptionId) {
  return this.find({ subscriptionId }).sort({ timestamp: -1 });
};

transactionSchema.statics.findBySubscriber = function(walletAddress, limit = 50) {
  return this.find({ 
    subscriberWallet: walletAddress.toLowerCase() 
  })
  .sort({ timestamp: -1 })
  .limit(limit);
};

transactionSchema.statics.getTotalRevenue = function(merchantId, startDate, endDate) {
  return this.aggregate([
    {
      $match: {
        merchantId,
        status: 'confirmed',
        timestamp: { $gte: startDate, $lte: endDate }
      }
    },
    {
      $group: {
        _id: null,
        total: { $sum: { $toDecimal: '$amount' } },
        count: { $sum: 1 }
      }
    }
  ]);
};

module.exports = mongoose.model('Transaction', transactionSchema);