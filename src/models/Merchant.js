const mongoose = require('mongoose');
const crypto = require('crypto');

const merchantSchema = new mongoose.Schema({
  ownerId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true
  },
  brandName: {
    type: String,
    required: true,
    trim: true,
    maxlength: 100
  },
  brandStage: {
    type: String,
    enum: ['startup', 'growth', 'enterprise'],
    default: 'startup'
  },
  apiKey: {
    type: String,
    unique: true,
    required: true
  },
  apiKeyPrefix: {
    type: String,
    required: true
  },
  webhookSecret: {
    type: String,
    required: true,
    select: false
  },
  webhookUrl: {
    type: String,
    trim: true,
    match: [/^https?:\/\/.+/, 'Invalid URL']
  },
  webhookEnabled: {
    type: Boolean,
    default: true
  },
  webhookHeaders: {
    type: Map,
    of: String,
    default: {}
  },
  publicKey: {
    type: String,
    required: true
  },
  privateKeyHash: {
    type: String,
    required: true,
    select: false
  },
  webhookEvents: [{
    type: String,
    enum: [
      'subscription.created',
      'subscription.canceled',
      'subscription.paused',
      'subscription.resumed',
      'payment.success',
      'payment.failed',
      'plan.created',
      'plan.deactivated'
    ]
  }],
  settings: {
    autoRetry: {
      type: Boolean,
      default: true
    },
    retryAttempts: {
      type: Number,
      default: 3,
      min: 1,
      max: 10
    },
    webhookTimeout: {
      type: Number,
      default: 5000,
      min: 1000,
      max: 30000
    },
    ipWhitelist: [String]
  },
  isActive: {
    type: Boolean,
    default: true
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

// Generate API key and webhook secret before saving
merchantSchema.pre('validate', function(next) {
  if (this.isNew) {
    // Generate API key
    const apiKey = crypto.randomBytes(32).toString('hex');
    this.apiKey = apiKey;
    this.apiKeyPrefix = apiKey.substring(0, 8);
    
    // Generate webhook secret
    this.webhookSecret = crypto.randomBytes(32).toString('hex');
    
    // Set default webhook events
    if (!this.webhookEvents || this.webhookEvents.length === 0) {
      this.webhookEvents = [
        'subscription.created',
        'subscription.canceled',
        'payment.success',
        'payment.failed'
      ];
    }
  }
  next();
});

// Update timestamp
merchantSchema.pre('save', function(next) {
  this.updatedAt = Date.now();
  next();
});

// Virtual for full API key (only for internal use)
merchantSchema.virtual('fullApiKey').get(function() {
  return `${this.apiKeyPrefix}_${this.apiKey}`;
});

// Instance methods
merchantSchema.methods.regenerateApiKey = function() {
  this.apiKey = crypto.randomBytes(32).toString('hex');
  this.apiKeyPrefix = this.apiKey.substring(0, 8);
};

merchantSchema.methods.regenerateWebhookSecret = function() {
  this.webhookSecret = crypto.randomBytes(32).toString('hex');
};

// Static methods
merchantSchema.statics.findByApiKey = function(apiKey) {
  return this.findOne({ apiKey }).select('+webhookSecret');
};

merchantSchema.statics.findByOwner = function(ownerId) {
  return this.findOne({ ownerId });
};

module.exports = mongoose.model('Merchant', merchantSchema);