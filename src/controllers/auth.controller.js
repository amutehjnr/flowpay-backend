// controllers/auth.controller.js
const jwt = require('jsonwebtoken');
const User = require('../models/User');
const Merchant = require('../models/Merchant');
const logger = require('../config/logger');
const redisClient = require('../config/redis');
const crypto = require('crypto');

class AuthController {
  constructor() {
    // Bind all methods to ensure 'this' works correctly
    this.register = this.register.bind(this);
    this.login = this.login.bind(this);
    this.refreshToken = this.refreshToken.bind(this);
    this.logout = this.logout.bind(this);
    this.getMe = this.getMe.bind(this);
    this.verifyEmail = this.verifyEmail.bind(this);
    this.generateTokens = this.generateTokens.bind(this);
    this.requestPasswordReset = this.requestPasswordReset.bind(this);
    this.resetPassword = this.resetPassword.bind(this);
  }

  async register(req, res) {
    try {
      const { firstName, lastName, email, password, country, phone, role } = req.body;

      // Validate required fields
      if (!firstName || !lastName || !email || !password || !country || !phone) {
        return res.status(400).json({ 
          error: 'Missing required fields',
          required: ['firstName', 'lastName', 'email', 'password', 'country', 'phone']
        });
      }

      // Check password strength
      if (password.length < 8) {
        return res.status(400).json({ 
          error: 'Password must be at least 8 characters long' 
        });
      }

      // Check if user exists
      const existingUser = await User.findOne({ 
        email: { $regex: new RegExp('^' + email + '$', 'i') } 
      });
      
      if (existingUser) {
        return res.status(409).json({ error: 'Email already registered' });
      }

      // Generate verification token
      const verificationToken = crypto.randomBytes(32).toString('hex');
      const verificationTokenExpiry = new Date();
      verificationTokenExpiry.setHours(verificationTokenExpiry.getHours() + 24);

      // Create user
      const user = new User({
        firstName,
        lastName,
        email: email.toLowerCase(),
        password,
        country: country.toUpperCase(),
        phone,
        role: role || 'user',
        verificationToken,
        verificationTokenExpiry,
        emailVerified: false,
        refreshTokens: []
      });

      await user.save();

      // If role is merchant, create merchant profile
      if (role === 'merchant') {
        try {
          const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', {
            modulusLength: 2048,
            publicKeyEncoding: {
              type: 'spki',
              format: 'pem'
            },
            privateKeyEncoding: {
              type: 'pkcs8',
              format: 'pem'
            }
          });

          const merchant = new Merchant({
            ownerId: user._id,
            brandName: `${firstName}'s Business`,
            brandStage: 'startup',
            publicKey,
            privateKeyHash: privateKey
          });

          await merchant.save();
          logger.info(`Merchant profile created for user: ${user.email}`);
        } catch (merchantError) {
          logger.error('Merchant creation failed:', merchantError);
        }
      }

      // Generate tokens - FIX: Use .call to ensure this context
      const tokens = await this.generateTokens(user, req);

      // Remove sensitive data
      const userResponse = user.toObject();
      delete userResponse.password;
      delete userResponse.__v;
      delete userResponse.refreshTokens;
      delete userResponse.verificationToken;
      delete userResponse.verificationTokenExpiry;

      logger.info(`✅ User registered successfully: ${user.email}`);

      res.status(201).json({
        message: 'Registration successful',
        user: userResponse,
        ...tokens
      });

    } catch (error) {
      logger.error('❌ Registration error:', {
        name: error.name,
        message: error.message,
        stack: error.stack
      });
      
      if (error.code === 11000) {
        const field = Object.keys(error.keyPattern)[0];
        return res.status(409).json({ error: `${field} already exists` });
      }
      
      if (error.name === 'ValidationError') {
        const errors = Object.values(error.errors).map(err => err.message);
        return res.status(400).json({ error: 'Validation failed', details: errors });
      }
      
      res.status(500).json({ error: 'Registration failed. Please try again.' });
    }
  }

  async generateTokens(user, req = null) {
    try {
      // Check if required secrets exist
      if (!process.env.JWT_ACCESS_SECRET || !process.env.JWT_REFRESH_SECRET) {
        throw new Error('JWT secrets not configured');
      }

      const accessToken = jwt.sign(
        { 
          userId: user._id.toString(), 
          email: user.email, 
          role: user.role 
        },
        process.env.JWT_ACCESS_SECRET,
        { expiresIn: process.env.JWT_ACCESS_EXPIRY || '15m' }
      );

      const refreshToken = jwt.sign(
        { userId: user._id.toString() },
        process.env.JWT_REFRESH_SECRET,
        { expiresIn: process.env.JWT_REFRESH_EXPIRY || '7d' }
      );

      // Store refresh token
      if (!user.refreshTokens) {
        user.refreshTokens = [];
      }

      const deviceInfo = req ? req.headers['user-agent'] || 'unknown' : 'unknown';

      user.refreshTokens.push({
        token: refreshToken,
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
        deviceInfo
      });

      // Keep only last 5 refresh tokens
      if (user.refreshTokens.length > 5) {
        user.refreshTokens = user.refreshTokens.slice(-5);
      }

      await user.save();

      return {
        accessToken,
        refreshToken,
        expiresIn: 15 * 60
      };
    } catch (error) {
      logger.error('Token generation error:', error);
      throw error;
    }
  }

  async login(req, res) {
    try {
      const { email, password } = req.body;

      if (!email || !password) {
        return res.status(400).json({ error: 'Email and password are required' });
      }

      const user = await User.findOne({ 
        email: { $regex: new RegExp('^' + email + '$', 'i') } 
      }).select('+password +refreshTokens');

      if (!user) {
        return res.status(401).json({ error: 'Invalid credentials' });
      }

      const isValid = await user.comparePassword(password);
      if (!isValid) {
        return res.status(401).json({ error: 'Invalid credentials' });
      }

      user.lastLogin = new Date();
      await user.save();

      const tokens = await this.generateTokens(user, req);

      const userResponse = user.toObject();
      delete userResponse.password;
      delete userResponse.__v;
      delete userResponse.refreshTokens;

      logger.info(`✅ User logged in: ${user.email}`);

      res.json({
        message: 'Login successful',
        user: userResponse,
        ...tokens
      });

    } catch (error) {
      logger.error('❌ Login error:', error);
      res.status(500).json({ error: 'Login failed. Please try again.' });
    }
  }

  async refreshToken(req, res) {
    try {
      const { refreshToken } = req.body;

      if (!refreshToken) {
        return res.status(401).json({ error: 'Refresh token required' });
      }

      const decoded = jwt.verify(refreshToken, process.env.JWT_REFRESH_SECRET);
      const user = await User.findById(decoded.userId).select('+refreshTokens');

      if (!user) {
        return res.status(401).json({ error: 'User not found' });
      }

      const tokenExists = user.refreshTokens.some(t => t.token === refreshToken);
      if (!tokenExists) {
        return res.status(401).json({ error: 'Invalid refresh token' });
      }

      const tokens = await this.generateTokens(user, req);

      user.refreshTokens = user.refreshTokens.filter(t => t.token !== refreshToken);
      await user.save();

      res.json(tokens);

    } catch (error) {
      if (error.name === 'TokenExpiredError') {
        return res.status(401).json({ error: 'Refresh token expired' });
      }
      logger.error('❌ Token refresh error:', error);
      res.status(500).json({ error: 'Token refresh failed' });
    }
  }

  async logout(req, res) {
    try {
      const { refreshToken } = req.body;
      const authHeader = req.headers.authorization;
      
      if (authHeader) {
        const accessToken = authHeader.split(' ')[1];
        const decoded = jwt.decode(accessToken);
        if (decoded && decoded.exp) {
          const expiry = decoded.exp - Math.floor(Date.now() / 1000);
          if (expiry > 0) {
            await redisClient.set(`blacklist:${accessToken}`, 'true', expiry);
          }
        }
      }

      if (refreshToken) {
        try {
          const decoded = jwt.verify(refreshToken, process.env.JWT_REFRESH_SECRET);
          const user = await User.findById(decoded.userId).select('+refreshTokens');
          if (user) {
            user.refreshTokens = user.refreshTokens.filter(t => t.token !== refreshToken);
            await user.save();
          }
        } catch (error) {
          logger.warn('Invalid refresh token during logout:', error.message);
        }
      }

      res.json({ message: 'Logout successful' });

    } catch (error) {
      logger.error('❌ Logout error:', error);
      res.status(500).json({ error: 'Logout failed' });
    }
  }

  async getMe(req, res) {
    try {
      const user = req.user;

      let merchant = null;
      if (user.role === 'merchant') {
        merchant = await Merchant.findOne({ ownerId: user._id });
      }

      const userResponse = user.toObject();
      delete userResponse.password;
      delete userResponse.__v;
      delete userResponse.refreshTokens;

      res.json({
        user: userResponse,
        merchant
      });

    } catch (error) {
      logger.error('❌ Get profile error:', error);
      res.status(500).json({ error: 'Failed to get profile' });
    }
  }

  async verifyEmail(req, res) {
    try {
      const { token } = req.params;
      const userId = req.user._id;

      const user = await User.findById(userId).select('+verificationToken +verificationTokenExpiry');
      
      if (!user) {
        return res.status(404).json({ error: 'User not found' });
      }

      if (user.verificationToken !== token) {
        return res.status(400).json({ error: 'Invalid verification token' });
      }

      if (user.verificationTokenExpiry < new Date()) {
        return res.status(400).json({ error: 'Verification token expired' });
      }

      user.emailVerified = true;
      user.verificationToken = undefined;
      user.verificationTokenExpiry = undefined;
      await user.save();

      logger.info(`✅ Email verified for user: ${user.email}`);

      res.json({ message: 'Email verified successfully' });

    } catch (error) {
      logger.error('❌ Email verification error:', error);
      res.status(500).json({ error: 'Email verification failed' });
    }
  }

  async requestPasswordReset(req, res) {
    try {
      const { email } = req.body;

      if (!email) {
        return res.status(400).json({ error: 'Email is required' });
      }

      const user = await User.findOne({ 
        email: { $regex: new RegExp('^' + email + '$', 'i') } 
      });
      
      if (!user) {
        logger.info(`Password reset requested for non-existent email: ${email}`);
        return res.json({ message: 'If your email is registered, you will receive a password reset link' });
      }

      const resetToken = crypto.randomBytes(32).toString('hex');
      const resetExpires = new Date(Date.now() + 3600000);

      user.resetPasswordToken = resetToken;
      user.resetPasswordExpires = resetExpires;
      await user.save();

      logger.info(`Password reset token generated for: ${email}`);

      res.json({ message: 'If your email is registered, you will receive a password reset link' });

    } catch (error) {
      logger.error('❌ Password reset request error:', error);
      res.status(500).json({ error: 'Password reset request failed' });
    }
  }

  async resetPassword(req, res) {
    try {
      const { token, newPassword } = req.body;

      if (!token || !newPassword) {
        return res.status(400).json({ error: 'Token and new password are required' });
      }

      if (newPassword.length < 8) {
        return res.status(400).json({ 
          error: 'Password must be at least 8 characters long' 
        });
      }

      const user = await User.findOne({
        resetPasswordToken: token,
        resetPasswordExpires: { $gt: new Date() }
      }).select('+password +resetPasswordToken +resetPasswordExpires +refreshTokens');

      if (!user) {
        return res.status(400).json({ error: 'Invalid or expired reset token' });
      }

      user.password = newPassword;
      user.resetPasswordToken = undefined;
      user.resetPasswordExpires = undefined;
      user.refreshTokens = [];
      
      await user.save();

      logger.info(`✅ Password reset successful for: ${user.email}`);

      res.json({ message: 'Password reset successful. Please login with your new password.' });

    } catch (error) {
      logger.error('❌ Password reset error:', error);
      res.status(500).json({ error: 'Password reset failed' });
    }
  }
}

module.exports = new AuthController();