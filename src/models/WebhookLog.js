const mongoose = require('mongoose');

const webhookLogSchema = new mongoose.Schema({
  merchantId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Merchant',
    required: true,
    index: true
  },
  eventType: {
    type: String,
    required: true,
    enum: [
      'subscription.created',
      'subscription.canceled',
      'subscription.paused',
      'subscription.resumed',
      'payment.success',
      'payment.failed',
      'plan.created',
      'plan.deactivated'
    ],
    index: true
  },
  payload: {
    type: mongoose.Schema.Types.Mixed,
    required: true
  },
  signature: String,
  webhookUrl: String,
  status: {
    type: String,
    enum: ['pending', 'delivered', 'failed', 'retrying'],
    default: 'pending',
    index: true
  },
  attempts: [{
    timestamp: Date,
    statusCode: Number,
    response: String,
    error: String
  }],
  retryCount: {
    type: Number,
    default: 0
  },
  nextRetry: Date,
  deliveredAt: Date,
  createdAt: {
    type: Date,
    default: Date.now,
    immutable: true,
    index: true
  }
});

// Index for retry queries
webhookLogSchema.index({ status: 1, nextRetry: 1 });

// Methods
webhookLogSchema.methods.recordAttempt = function(statusCode, response, error = null) {
  this.attempts.push({
    timestamp: new Date(),
    statusCode,
    response: response?.substring(0, 500),
    error: error?.message
  });
};

webhookLogSchema.methods.markDelivered = function() {
  this.status = 'delivered';
  this.deliveredAt = new Date();
  this.nextRetry = null;
};

webhookLogSchema.methods.markFailed = function() {
  this.status = 'failed';
  this.nextRetry = null;
};

webhookLogSchema.methods.scheduleRetry = function(delay) {
  this.status = 'retrying';
  this.retryCount += 1;
  this.nextRetry = new Date(Date.now() + delay);
};

// Static methods
webhookLogSchema.statics.findPendingRetries = function() {
  return this.find({
    status: 'retrying',
    nextRetry: { $lte: new Date() },
    retryCount: { $lt: 5 }
  }).sort({ nextRetry: 1 });
};

webhookLogSchema.statics.findByMerchant = function(merchantId, limit = 50) {
  return this.find({ merchantId })
    .sort({ createdAt: -1 })
    .limit(limit);
};

module.exports = mongoose.model('WebhookLog', webhookLogSchema);