const jwt = require('jsonwebtoken');
require('dotenv').config();

console.log('🔍 AUTH DEBUG TEST');
console.log('===================');

// Test JWT_SECRET
console.log('JWT_SECRET exists:', !!process.env.JWT_SECRET);
console.log('JWT_SECRET length:', process.env.JWT_SECRET?.length || 0);

// Test token creation and verification
try {
  const testPayload = {
    userId: '507f1f77bcf86cd799439011',
    username: 'testuser',
    email: 'test@example.com',
    role: 'user'
  };
  
  console.log('\n📝 Creating test token...');
  const testToken = jwt.sign(testPayload, process.env.JWT_SECRET, { expiresIn: '7d' });
  console.log('Test token created:', !!testToken);
  console.log('Token length:', testToken.length);
  console.log('Token starts with:', testToken.substring(0, 20) + '...');
  
  console.log('\n🔐 Verifying test token...');
  const decoded = jwt.verify(testToken, process.env.JWT_SECRET);
  console.log('Token verification successful:', !!decoded);
  console.log('Decoded payload:', decoded);
  
  console.log('\n✅ JWT system is working correctly!');
} catch (error) {
  console.error('❌ JWT error:', error.message);
}

// Test cookie parsing
console.log('\n🍪 Testing cookie parsing...');
const sampleCookieString = 'authToken=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VySWQiOiI2NzYzNjI4YzZlMThjNzQ5NzBkMGE3MWYiLCJ1c2VybmFtZSI6InRlc3R1c2VyIiwiZW1haWwiOiJ0ZXN0QGV4YW1wbGUuY29tIiwicm9sZSI6InVzZXIiLCJpYXQiOjE3MzQ2MTI2ODQsImV4cCI6MTczNTIxNzQ4NH0.example; username=testuser; userRole=user';

const parsedCookies = {};
sampleCookieString.split('; ').forEach(cookie => {
  const [name, value] = cookie.split('=');
  if (name) parsedCookies[name] = value;
});

console.log('Parsed cookies:', parsedCookies);
console.log('Auth token found in cookies:', !!parsedCookies.authToken);

console.log('\n🔧 TROUBLESHOOTING RECOMMENDATIONS:');
console.log('1. Check if browser is sending cookies to the server');
console.log('2. Verify CORS settings allow credentials');
console.log('3. Check if cookie domain/path settings are correct');
console.log('4. Make sure frontend is using credentials: "include"');
console.log('5. Verify token format and expiration');
