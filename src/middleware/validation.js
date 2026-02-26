const { body, param, query, validationResult } = require('express-validator');

// Validation result handler
const validate = (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ 
      error: 'Validation failed',
      details: errors.array().map(err => ({
        field: err.param,
        message: err.msg
      }))
    });
  }
  next();
};

// Auth validations
const registerValidation = [
  body('firstName').trim().isLength({ min: 2, max: 50 }).withMessage('First name must be 2-50 characters'),
  body('lastName').trim().isLength({ min: 2, max: 50 }).withMessage('Last name must be 2-50 characters'),
  body('email').isEmail().normalizeEmail().withMessage('Valid email required'),
  body('password').isLength({ min: 8 }).matches(/^(?=.*[A-Za-z])(?=.*\d)(?=.*[@$!%*#?&])[A-Za-z\d@$!%*#?&]{8,}$/)
    .withMessage('Password must be at least 8 characters with 1 letter, 1 number, and 1 special character'),
  body('country').isLength({ min: 2, max: 2 }).withMessage('Country must be 2-letter code'),
  body('phone').matches(/^\+?[1-9]\d{1,14}$/).withMessage('Valid phone number required'),
  validate
];

const loginValidation = [
  body('email').isEmail().normalizeEmail().withMessage('Valid email required'),
  body('password').notEmpty().withMessage('Password required'),
  validate
];

// Wallet validations
const walletConnectValidation = [
  body('walletAddress').matches(/^0x[a-fA-F0-9]{40}$/).withMessage('Invalid wallet address'),
  body('signature').isString().notEmpty().withMessage('Signature required'),
  body('message').isString().notEmpty().withMessage('Message required'),
  validate
];

// Plan validations
const createPlanValidation = [
  body('amountPerInterval').isString().matches(/^\d+$/).withMessage('Amount must be number string'),
  body('interval').isInt({ min: 86400, max: 31536000 }).withMessage('Interval must be 1 day to 1 year in seconds'),
  body('totalIntervals').isInt({ min: 1, max: 1000 }).withMessage('Total intervals must be 1-1000'),
  body('paymentToken').matches(/^0x[a-fA-F0-9]{40}$/).withMessage('Invalid token address'),
  body('gracePeriod').isInt({ min: 0, max: 2592000 }).withMessage('Grace period must be 0-30 days in seconds'),
  validate
];

// Subscription validations
const subscribeValidation = [
  body('planId').isInt({ min: 1 }).withMessage('Valid plan ID required'),
  body('subscriberWallet').matches(/^0x[a-fA-F0-9]{40}$/).withMessage('Invalid wallet address'),
  validate
];

// Webhook validations
const webhookConfigValidation = [
  body('webhookUrl').isURL().withMessage('Valid webhook URL required'),
  body('webhookEvents').optional().isArray().withMessage('Events must be array'),
  body('webhookEvents.*').isIn([
    'subscription.created', 'subscription.canceled', 'subscription.paused',
    'subscription.resumed', 'payment.success', 'payment.failed'
  ]).withMessage('Invalid event type'),
  validate
];

// Pagination validation
const paginationValidation = [
  query('page').optional().isInt({ min: 1 }).toInt(),
  query('limit').optional().isInt({ min: 1, max: 100 }).toInt(),
  validate
];

// Transaction validation
const transactionQueryValidation = [
  param('wallet').optional().matches(/^0x[a-fA-F0-9]{40}$/).withMessage('Invalid wallet address'),
  query('from').optional().isISO8601().toDate(),
  query('to').optional().isISO8601().toDate(),
  ...paginationValidation
];

module.exports = {
  registerValidation,
  loginValidation,
  walletConnectValidation,
  createPlanValidation,
  subscribeValidation,
  webhookConfigValidation,
  paginationValidation,
  transactionQueryValidation
};