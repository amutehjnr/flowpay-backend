const request = require('supertest');
const app = require('../../src/app');
const User = require('../../src/models/User');
const mongoose = require('mongoose');

describe('Authentication Endpoints', () => {
  beforeAll(async () => {
    await mongoose.connect(process.env.MONGODB_URI_TEST);
  });

  afterAll(async () => {
    await mongoose.connection.close();
  });

  beforeEach(async () => {
    await User.deleteMany({});
  });

  describe('POST /api/v1/auth/register', () => {
    it('should register a new user', async () => {
      const res = await request(app)
        .post('/api/v1/auth/register')
        .send({
          firstName: 'John',
          lastName: 'Doe',
          email: 'john@example.com',
          password: 'Test123!@#',
          country: 'US',
          phone: '+1234567890'
        });

      expect(res.statusCode).toBe(201);
      expect(res.body).toHaveProperty('accessToken');
      expect(res.body).toHaveProperty('refreshToken');
      expect(res.body.user.email).toBe('john@example.com');
    });

    it('should not register with existing email', async () => {
      // Create user first
      await User.create({
        firstName: 'John',
        lastName: 'Doe',
        email: 'john@example.com',
        passwordHash: 'hashed',
        country: 'US',
        phone: '+1234567890'
      });

      const res = await request(app)
        .post('/api/v1/auth/register')
        .send({
          firstName: 'Jane',
          lastName: 'Doe',
          email: 'john@example.com',
          password: 'Test123!@#',
          country: 'US',
          phone: '+1234567890'
        });

      expect(res.statusCode).toBe(409);
      expect(res.body).toHaveProperty('error');
    });

    it('should validate input', async () => {
      const res = await request(app)
        .post('/api/v1/auth/register')
        .send({
          firstName: 'J',
          lastName: 'D',
          email: 'invalid-email',
          password: 'weak',
          country: 'USA',
          phone: '123'
        });

      expect(res.statusCode).toBe(400);
      expect(res.body).toHaveProperty('details');
    });
  });

  describe('POST /api/v1/auth/login', () => {
    it('should login with valid credentials', async () => {
      // Create user
      const user = new User({
        firstName: 'John',
        lastName: 'Doe',
        email: 'john@example.com',
        passwordHash: 'Test123!@#',
        country: 'US',
        phone: '+1234567890'
      });
      await user.save();

      const res = await request(app)
        .post('/api/v1/auth/login')
        .send({
          email: 'john@example.com',
          password: 'Test123!@#'
        });

      expect(res.statusCode).toBe(200);
      expect(res.body).toHaveProperty('accessToken');
    });

    it('should not login with invalid password', async () => {
      const user = new User({
        firstName: 'John',
        lastName: 'Doe',
        email: 'john@example.com',
        passwordHash: 'Test123!@#',
        country: 'US',
        phone: '+1234567890'
      });
      await user.save();

      const res = await request(app)
        .post('/api/v1/auth/login')
        .send({
          email: 'john@example.com',
          password: 'wrongpassword'
        });

      expect(res.statusCode).toBe(401);
    });
  });
});