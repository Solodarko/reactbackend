// Quick test to verify the auth fix
const express = require('express');
const cookieParser = require('cookie-parser');
require('dotenv').config();

const app = express();
app.use(express.json());
app.use(cookieParser());

// Test endpoint to check cookie parsing
app.get('/test-auth', (req, res) => {
  console.log('🔍 Testing auth fix...');
  console.log('Cookies received:', req.cookies);
  console.log('Authorization header:', req.header('Authorization'));
  console.log('Raw cookie header:', req.header('Cookie'));
  
  const token = req.cookies?.authToken || req.header('Authorization')?.replace('Bearer ', '');
  
  res.json({
    cookiesPresent: !!req.cookies,
    authTokenInCookies: !!req.cookies?.authToken,
    authHeaderPresent: !!req.header('Authorization'),
    tokenFound: !!token,
    tokenLength: token?.length || 0,
    tokenPreview: token ? token.substring(0, 20) + '...' : null,
    allCookies: req.cookies,
    timestamp: new Date().toISOString()
  });
});

app.listen(3001, () => {
  console.log('🧪 Auth test server running on port 3001');
  console.log('Test URL: http://localhost:3001/test-auth');
  console.log('Open this in your browser with cookies set');
});
