const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const userSchema = new mongoose.Schema({
  firstName: {
    type: String,
    required: true,
    trim: true,
    maxlength: 50
  },
  lastName: {
    type: String,
    required: true,
    trim: true,
    maxlength: 50
  },
  email: {
    type: String,
    required: true,
    unique: true,
    lowercase: true,
    trim: true,
    match: [/^\w+([.-]?\w+)*@\w+([.-]?\w+)*(\.\w{2,3})+$/, 'Invalid email']
  },
  password: {
    type: String,
    required: true,
    select: false
  },
  country: {
    type: String,
    required: true,
    minlength: 2,
    maxlength: 2
  },
  phone: {
    type: String,
    required: true,
    trim: true
  },
  walletAddress: {
    type: String,
    lowercase: true,
    sparse: true,
    match: [/^0x[a-fA-F0-9]{40}$/, 'Invalid wallet address']
  },
  role: {
    type: String,
    enum: ['merchant', 'user'],
    default: 'user'
  },
  emailVerified: {
    type: Boolean,
    default: false
  },
  twoFactorEnabled: {
    type: Boolean,
    default: false
  },
  twoFactorSecret: {
    type: String,
    select: false
  },
  // NEW ACCOUNT STATUS FIELDS
  isActive: {
    type: Boolean,
    default: true,
    index: true
  },
  accountStatus: {
    type: String,
    enum: ['active', 'suspended', 'deactivated'],
    default: 'active',
    index: true
  },
  deactivatedAt: {
    type: Date,
    default: null
  },
  deactivationReason: {
    type: String,
    default: null
  },
  deactivatedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    default: null
  },
  lastLogin: {
    type: Date
  },
  refreshTokens: [{
    token: String,
    expiresAt: Date,
    deviceInfo: String
  }],
  resetPasswordToken: {
    type: String,
    select: false
  },
  resetPasswordExpires: {
    type: Date,
    select: false
  },
  verificationToken: {
    type: String,
    select: false
  },
  verificationTokenExpiry: {
    type: Date,
    select: false
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

// Hash password before saving
userSchema.pre('save', async function(next) {
  if (!this.isModified('password')) return next();
  
  try {
    const salt = await bcrypt.genSalt(12);
    this.password = await bcrypt.hash(this.password, salt);
    next();
  } catch (error) {
    next(error);
  }
});

// Update timestamp
userSchema.pre('save', function(next) {
  this.updatedAt = Date.now();
  next();
});

// Compare password method
userSchema.methods.comparePassword = async function(candidatePassword) {
  return bcrypt.compare(candidatePassword, this.password);
};

// Remove sensitive info when converting to JSON
userSchema.methods.toJSON = function() {
  const user = this.toObject();
  delete user.password;
  delete user.twoFactorSecret;
  delete user.refreshTokens;
  delete user.resetPasswordToken;
  delete user.resetPasswordExpires;
  delete user.verificationToken;
  delete user.verificationTokenExpiry;
  delete user.deactivationReason;
  delete user.deactivatedBy;
  delete user.__v;
  return user;
};

// Static methods
userSchema.statics.findByEmail = function(email) {
  return this.findOne({ email: email.toLowerCase() });
};

userSchema.statics.findByWallet = function(walletAddress) {
  return this.findOne({ walletAddress: walletAddress.toLowerCase() });
};

// Instance methods for account management
userSchema.methods.deactivate = async function(reason, adminId = null) {
  this.isActive = false;
  this.accountStatus = 'deactivated';
  this.deactivatedAt = new Date();
  this.deactivationReason = reason;
  this.deactivatedBy = adminId;
  
  // Revoke all refresh tokens
  this.refreshTokens = [];
  
  await this.save();
  return this;
};

userSchema.methods.reactivate = async function() {
  this.isActive = true;
  this.accountStatus = 'active';
  this.deactivatedAt = null;
  this.deactivationReason = null;
  this.deactivatedBy = null;
  
  await this.save();
  return this;
};

userSchema.methods.suspend = async function(reason, adminId = null) {
  this.isActive = false;
  this.accountStatus = 'suspended';
  this.deactivatedAt = new Date();
  this.deactivationReason = reason;
  this.deactivatedBy = adminId;
  
  await this.save();
  return this;
};

// Check if account is accessible
userSchema.methods.isAccessible = function() {
  return this.isActive === true && this.accountStatus === 'active';
};

module.exports = mongoose.model('User', userSchema);