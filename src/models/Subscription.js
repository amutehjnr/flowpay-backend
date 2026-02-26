const mongoose = require('mongoose');

const subscriptionSchema = new mongoose.Schema({
  subscriptionId: {
    type: Number,
    required: true,
    unique: true,
    index: true
  },
  planId: {
    type: Number,
    required: true,
    index: true,
    ref: 'Plan'
  },
  merchantId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Merchant',
    required: true,
    index: true
  },
  subscriberWallet: {
    type: String,
    required: true,
    lowercase: true,
    index: true,
    match: [/^0x[a-fA-F0-9]{40}$/, 'Invalid wallet address']
  },
  startTime: {
    type: Date,
    required: true
  },
  lastPaymentTime: {
    type: Date
  },
  nextPaymentDue: {
    type: Date,
    required: true,
    index: true
  },
  paymentsMade: {
    type: Number,
    default: 0,
    min: 0
  },
  paymentsRemaining: {
    type: Number,
    required: true,
    min: 0
  },
  totalPaid: {
    type: String,
    default: '0'
  },
  status: {
    type: String,
    enum: [
      'active',
      'paused',
      'canceled',
      'expired',
      'grace_period',
      'completed'
    ],
    default: 'active',
    index: true
  },
  isPaused: {
    type: Boolean,
    default: false
  },
  pauseTime: {
    type: Date
  },
  gracePeriodEnd: {
    type: Date
  },
  failedPayments: {
    type: Number,
    default: 0
  },
  lastFailedPayment: {
    type: Date
  },
  metadata: {
    type: Map,
    of: String
  },
  createdAt: {
    type: Date,
    default: Date.now,
    immutable: true
  },
  updatedAt: {
    type: Date,
    default: Date.now
  }
});

// Update timestamp
subscriptionSchema.pre('save', function(next) {
  this.updatedAt = Date.now();
  next();
});

// Indexes
subscriptionSchema.index({ status: 1, nextPaymentDue: 1 });
subscriptionSchema.index({ merchantId: 1, status: 1 });
subscriptionSchema.index({ subscriberWallet: 1, status: 1 });

// Virtual for contract status
subscriptionSchema.virtual('contractStatus').get(function() {
  if (this.isPaused) return 'paused';
  if (this.status === 'canceled') return 'canceled';
  if (this.status === 'completed') return 'completed';
  if (this.paymentsRemaining === 0) return 'completed';
  return 'active';
});

// Methods
subscriptionSchema.methods.isPaymentDue = function() {
  return this.nextPaymentDue <= new Date() && 
         this.status === 'active' && 
         !this.isPaused;
};

subscriptionSchema.methods.inGracePeriod = function() {
  if (!this.gracePeriodEnd) return false;
  return this.gracePeriodEnd > new Date();
};

subscriptionSchema.methods.enterGracePeriod = function(gracePeriodEnd) {
  this.status = 'grace_period';
  this.gracePeriodEnd = gracePeriodEnd;
};

subscriptionSchema.methods.recordPayment = function(amount, txHash) {
  this.paymentsMade += 1;
  this.paymentsRemaining -= 1;
  this.totalPaid = (BigInt(this.totalPaid) + BigInt(amount)).toString();
  this.lastPaymentTime = new Date();
  this.failedPayments = 0;
  this.status = 'active';
  this.gracePeriodEnd = null;
  this.nextPaymentDue = new Date(
    this.nextPaymentDue.getTime() + this.intervalMs
  );

  if (this.paymentsRemaining === 0) {
    this.status = 'completed';
  }
};

subscriptionSchema.methods.recordFailedPayment = function() {
  this.failedPayments += 1;
  this.lastFailedPayment = new Date();
};

// Static methods
subscriptionSchema.statics.findBySubscriptionId = function(subscriptionId) {
  return this.findOne({ subscriptionId });
};

subscriptionSchema.statics.findBySubscriber = function(walletAddress) {
  return this.find({ 
    subscriberWallet: walletAddress.toLowerCase(),
    status: { $in: ['active', 'grace_period'] }
  }).sort({ nextPaymentDue: 1 });
};

subscriptionSchema.statics.findDueForPayment = function() {
  return this.find({
    status: 'active',
    isPaused: false,
    nextPaymentDue: { $lte: new Date() },
    paymentsRemaining: { $gt: 0 }
  }).sort({ nextPaymentDue: 1 });
};

subscriptionSchema.statics.findGracePeriodExpiring = function() {
  return this.find({
    status: 'grace_period',
    gracePeriodEnd: { $lte: new Date() }
  });
};

module.exports = mongoose.model('Subscription', subscriptionSchema);