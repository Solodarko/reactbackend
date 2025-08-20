const express = require('express');
const jwt = require('jsonwebtoken');
const TokenDebugger = require('../utils/tokenDebugger');
const { auth } = require('../middleware/auth');

const router = express.Router();

// ===========================
// TOKEN DEBUGGING ENDPOINT
// ===========================
router.post('/debug', async (req, res) => {
  try {
    const { token } = req.body;
    
    console.log('🧪 Token Debug Endpoint Called');
    console.log('Token received in body:', !!token);
    
    if (!token) {
      return res.status(400).json({
        success: false,
        message: 'Token is required in request body'
      });
    }

    const debugInfo = await TokenDebugger.debugToken(token);
    TokenDebugger.logDebugInfo(debugInfo);

    res.json({
      success: true,
      message: 'Token debug information',
      debug: debugInfo
    });
  } catch (error) {
    console.error('Token debug error:', error);
    res.status(500).json({
      success: false,
      message: 'Error debugging token',
      error: error.message
    });
  }
});

// ===========================
// TEST TOKEN CREATION
// ===========================
router.post('/create-test-token', async (req, res) => {
  try {
    const testPayload = {
      userId: '507f1f77bcf86cd799439011', // Test MongoDB ObjectId
      username: 'testuser',
      email: 'test@example.com',
      role: 'user'
    };

    const token = jwt.sign(testPayload, process.env.JWT_SECRET, { expiresIn: '1h' });

    res.json({
      success: true,
      message: 'Test token created',
      token: token,
      payload: testPayload,
      jwtSecret: !!process.env.JWT_SECRET
    });
  } catch (error) {
    console.error('Test token creation error:', error);
    res.status(500).json({
      success: false,
      message: 'Error creating test token',
      error: error.message
    });
  }
});

// ===========================
// TEST AUTHENTICATION MIDDLEWARE
// ===========================
router.get('/test-auth', auth, (req, res) => {
  try {
    res.json({
      success: true,
      message: 'Authentication middleware test successful',
      user: {
        id: req.user._id,
        username: req.user.username,
        email: req.user.email,
        role: req.user.role
      },
      tokenPresent: !!req.token
    });
  } catch (error) {
    console.error('Auth test error:', error);
    res.status(500).json({
      success: false,
      message: 'Auth test failed',
      error: error.message
    });
  }
});

// ===========================
// CHECK TOKEN FROM DIFFERENT SOURCES
// ===========================
router.get('/check-token-sources', (req, res) => {
  try {
    const cookieToken = req.cookies?.authToken;
    const authHeader = req.header('Authorization');
    const bearerToken = authHeader?.startsWith('Bearer ') ? 
      authHeader.replace('Bearer ', '').trim() : null;

    console.log('🔍 Token Source Check:', {
      hasCookie: !!cookieToken,
      hasAuthHeader: !!authHeader,
      hasBearerToken: !!bearerToken,
      authHeaderValue: authHeader?.substring(0, 30) + '...',
      cookieValue: cookieToken?.substring(0, 30) + '...'
    });

    res.json({
      success: true,
      message: 'Token sources checked',
      sources: {
        cookie: {
          present: !!cookieToken,
          length: cookieToken?.length || 0,
          preview: cookieToken?.substring(0, 20) + '...' || null
        },
        authHeader: {
          present: !!authHeader,
          value: authHeader?.substring(0, 30) + '...' || null,
          startsWithBearer: authHeader?.startsWith('Bearer ') || false
        },
        bearerToken: {
          present: !!bearerToken,
          length: bearerToken?.length || 0,
          preview: bearerToken?.substring(0, 20) + '...' || null
        }
      }
    });
  } catch (error) {
    console.error('Token source check error:', error);
    res.status(500).json({
      success: false,
      message: 'Error checking token sources',
      error: error.message
    });
  }
});

module.exports = router;
