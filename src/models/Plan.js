const mongoose = require('mongoose');

const planSchema = new mongoose.Schema({
  merchantId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Merchant',
    required: true,
    index: true
  },
  planId: {
    type: Number,
    required: true,
    unique: true,
    index: true
  },
  amountPerInterval: {
    type: String,
    required: true,
    validate: {
      validator: function(v) {
        return /^\d+$/.test(v);
      },
      message: 'Amount must be a valid number string'
    }
  },
  interval: {
    type: Number,
    required: true,
    min: 86400, // Minimum 1 day in seconds
    max: 31536000 // Maximum 1 year in seconds
  },
  totalIntervals: {
    type: Number,
    required: true,
    min: 1,
    max: 1000
  },
  paymentToken: {
    type: String,
    required: true,
    lowercase: true,
    match: [/^0x[a-fA-F0-9]{40}$/, 'Invalid token address']
  },
  gracePeriod: {
    type: Number,
    required: true,
    min: 0,
    max: 2592000 // Maximum 30 days in seconds
  },
  metadata: {
    name: String,
    description: String,
    image: String
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

// Update timestamp
planSchema.pre('save', function(next) {
  this.updatedAt = Date.now();
  next();
});

// Index for queries
planSchema.index({ merchantId: 1, isActive: 1 });
planSchema.index({ paymentToken: 1 });

// Virtual for total amount
planSchema.virtual('totalAmount').get(function() {
  return (BigInt(this.amountPerInterval) * BigInt(this.totalIntervals)).toString();
});

// Methods
planSchema.methods.deactivate = function() {
  this.isActive = false;
};

planSchema.methods.updateGracePeriod = function(newGracePeriod) {
  if (newGracePeriod < 0 || newGracePeriod > 2592000) {
    throw new Error('Invalid grace period');
  }
  this.gracePeriod = newGracePeriod;
};

// Static methods
planSchema.statics.findByPlanId = function(planId) {
  return this.findOne({ planId });
};

planSchema.statics.findActiveByMerchant = function(merchantId) {
  return this.find({ merchantId, isActive: true }).sort({ createdAt: -1 });
};

module.exports = mongoose.model('Plan', planSchema);