const axios = require('axios');

async function testAPI() {
  console.log('🧪 Testing Backend API Endpoints...\n');
  
  const tests = [
    {
      name: 'Health Check',
      url: 'http://localhost:5000/api/auth/verify',
      headers: {}
    },
    {
      name: 'Attendance Dashboard (No Auth)',
      url: 'http://localhost:5000/api/attendance/dashboard',
      headers: {}
    }
  ];

  for (const test of tests) {
    try {
      console.log(`🔍 Testing: ${test.name}`);
      console.log(`   URL: ${test.url}`);
      
      const response = await axios.get(test.url, { 
        headers: test.headers,
        timeout: 5000
      });
      
      console.log(`   ✅ SUCCESS - Status: ${response.status}`);
      
      if (response.data) {
        if (typeof response.data === 'object') {
          console.log(`   📊 Response keys: ${Object.keys(response.data).join(', ')}`);
        } else {
          console.log(`   📄 Response length: ${String(response.data).length} chars`);
        }
      }
      
    } catch (error) {
      console.log(`   ❌ FAILED`);
      if (error.response) {
        console.log(`   📊 Status: ${error.response.status}`);
        console.log(`   📄 Message: ${error.response.data?.message || error.message}`);
      } else {
        console.log(`   💥 Error: ${error.message}`);
      }
    }
    console.log('');
  }
}

testAPI().then(() => {
  console.log('🏁 API test completed');
  process.exit(0);
}).catch(error => {
  console.error('💥 Test script error:', error);
  process.exit(1);
});
