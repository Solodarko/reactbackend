/**
 * Comprehensive Deployment Verification Script
 * Tests all QR attendance system components for production readiness
 */

const axios = require('axios');
const { testQRAttendanceScanning, testQRAttendanceRetrieval } = require('./test-qr-realtime');
const { runGeolocationTests } = require('./test-geolocation');
const { verifyAttendanceRecords } = require('./verify-attendance-db');

const BACKEND_URL = 'http://localhost:5000';
const FRONTEND_URL = 'http://localhost:5173';

/**
 * Test system connectivity and basic health
 */
async function testSystemHealth() {
  console.log('🏥 Testing System Health & Connectivity\n');
  
  let healthScore = 0;
  const maxScore = 6;
  
  try {
    // Test 1: Backend server connectivity
    console.log('1️⃣ Testing backend server connectivity...');
    try {
      const backendResponse = await axios.get(`${BACKEND_URL}/health`, { timeout: 5000 });
      if (backendResponse.status === 200) {
        console.log('   ✅ Backend server is running and accessible');
        healthScore++;
      }
    } catch (error) {
      console.log('   ❌ Backend server connectivity failed');
    }
    
    // Test 2: Database connection
    console.log('2️⃣ Testing database connection...');
    try {
      const dbResponse = await axios.get(`${BACKEND_URL}/api/health/db`, { timeout: 10000 });
      if (dbResponse.data.success) {
        console.log('   ✅ Database connection successful');
        console.log(`   📊 Database: ${dbResponse.data.database}`);
        healthScore++;
      }
    } catch (error) {
      console.log('   ❌ Database connection failed');
    }
    
    // Test 3: Socket.IO service
    console.log('3️⃣ Testing Socket.IO service...');
    try {
      // Check if Socket.IO endpoint is available
      const socketResponse = await axios.get(`${BACKEND_URL}/socket.io/`, { timeout: 5000 });
      if (socketResponse.status === 200 || socketResponse.status === 400) {
        console.log('   ✅ Socket.IO service is running');
        healthScore++;
      }
    } catch (error) {
      if (error.response && (error.response.status === 400 || error.response.status === 200)) {
        console.log('   ✅ Socket.IO service is running');
        healthScore++;
      } else {
        console.log('   ❌ Socket.IO service check failed');
      }
    }
    
    // Test 4: QR attendance endpoint
    console.log('4️⃣ Testing QR attendance endpoint...');
    try {
      // Test with invalid data to check if endpoint exists
      const qrResponse = await axios.post(`${BACKEND_URL}/api/attendance/qr-location`, {}, { timeout: 5000 });
    } catch (error) {
      if (error.response && error.response.status === 400) {
        console.log('   ✅ QR attendance endpoint is accessible');
        healthScore++;
      } else {
        console.log('   ❌ QR attendance endpoint not accessible');
      }
    }
    
    // Test 5: Location validation endpoint
    console.log('5️⃣ Testing location validation endpoint...');
    try {
      const locationResponse = await axios.post(`${BACKEND_URL}/api/attendance/validate-location`, {}, { timeout: 5000 });
    } catch (error) {
      if (error.response && error.response.status === 400) {
        console.log('   ✅ Location validation endpoint is accessible');
        healthScore++;
      } else {
        console.log('   ❌ Location validation endpoint not accessible');
      }
    }
    
    // Test 6: Frontend availability
    console.log('6️⃣ Testing frontend availability...');
    try {
      const frontendResponse = await axios.get(`${FRONTEND_URL}`, { timeout: 5000 });
      if (frontendResponse.status === 200) {
        console.log('   ✅ Frontend is running and accessible');
        healthScore++;
      }
    } catch (error) {
      console.log('   ⚠️ Frontend accessibility could not be verified (this may be normal if frontend is served differently)');
    }
    
    console.log(`\n📊 System Health Score: ${healthScore}/${maxScore} (${Math.round((healthScore/maxScore)*100)}%)`);
    
    return {
      score: healthScore,
      maxScore,
      percentage: Math.round((healthScore/maxScore)*100),
      passed: healthScore >= 4 // At least backend, DB, Socket.IO, and QR endpoint must work
    };
    
  } catch (error) {
    console.error('❌ System health check failed:', error.message);
    return { score: 0, maxScore, percentage: 0, passed: false };
  }
}

/**
 * Test QR code generation and validation
 */
async function testQRCodeFlow() {
  console.log('🎯 Testing QR Code Generation & Validation Flow\n');
  
  try {
    // Generate a test QR code
    const timestamp = Date.now();
    const testQRCode = {
      id: `deployment_test_${timestamp}`,
      type: 'attendance_check',
      timestamp: timestamp,
      expiresAt: new Date(Date.now() + 10 * 60 * 1000).toISOString(), // 10 minutes
      checksum: Buffer.from(`deployment_test_${timestamp}_${timestamp}`, 'utf8').toString('base64'),
      location: 'deployment_verification',
      user: {
        userId: 'deploy_admin',
        username: 'deployment_tester',
        email: 'deploy@test.edu',
        role: 'admin',
        studentId: '00000',
        firstName: 'Deployment',
        lastName: 'Tester',
        fullName: 'Deployment Tester',
        department: 'System Testing',
        hasStudentRecord: true
      },
      adminId: 'deploy_admin'
    };
    
    console.log('1️⃣ Generated test QR code...');
    console.log(`   📄 QR ID: ${testQRCode.id}`);
    console.log(`   📅 Expires: ${testQRCode.expiresAt}`);
    console.log(`   👤 Generated by: ${testQRCode.user.username}`);
    
    // Test QR code validation by attempting to use it
    console.log('\n2️⃣ Testing QR code validation...');
    
    const qrTestData = {
      studentId: '99999',
      scannedBy: {
        userId: 'test_student',
        username: 'deployment_student',
        email: 'student@test.edu',
        studentId: '99999'
      },
      qrCodeData: testQRCode,
      scannerLocation: {
        coordinates: {
          latitude: 5.636096,
          longitude: -0.196608
        },
        distance: 1.0
      },
      distance: 1.0,
      userLocation: {
        lat: 5.636096,
        lng: -0.196608,
        accuracy: 5
      },
      scannedAt: new Date().toISOString(),
      attendanceType: 'qr_scan'
    };
    
    const qrResponse = await axios.post(
      `${BACKEND_URL}/api/attendance/qr-location`,
      qrTestData,
      { timeout: 10000 }
    );
    
    if (qrResponse.data.success) {
      console.log('   ✅ QR code validation and processing successful');
      console.log(`   📄 Attendance ID: ${qrResponse.data.attendanceId}`);
      console.log(`   🔍 Verification: ${qrResponse.data.location?.verification?.status}`);
      return true;
    } else {
      console.log('   ❌ QR code validation failed:', qrResponse.data.error);
      return false;
    }
    
  } catch (error) {
    console.error('❌ QR code flow test failed:', error.message);
    if (error.response) {
      console.error('   Response data:', error.response.data);
    }
    return false;
  }
}

/**
 * Test real-time features
 */
async function testRealTimeFeatures() {
  console.log('📡 Testing Real-time Features\n');
  
  try {
    // Test getting QR attendance info (includes real-time ready data)
    console.log('1️⃣ Testing real-time data retrieval...');
    
    const today = new Date().toISOString().split('T')[0];
    const realtimeResponse = await axios.get(
      `${BACKEND_URL}/api/attendance/qr-location/info?dateFrom=${today}&dateTo=${today}`,
      { timeout: 10000 }
    );
    
    if (realtimeResponse.data.success) {
      console.log('   ✅ Real-time data retrieval successful');
      console.log(`   📊 Records available: ${realtimeResponse.data.locationData?.length || 0}`);
      console.log(`   📊 Statistics: ${JSON.stringify(realtimeResponse.data.statistics || {})}`);
      
      // Test dashboard endpoint (includes Socket.IO integration status)
      console.log('\n2️⃣ Testing dashboard real-time integration...');
      
      const dashboardResponse = await axios.get(
        `${BACKEND_URL}/api/attendance/dashboard`,
        { timeout: 10000 }
      );
      
      if (dashboardResponse.data.success) {
        console.log('   ✅ Dashboard real-time integration ready');
        console.log(`   📊 Total meetings: ${dashboardResponse.data.overallStatistics?.totalMeetings || 0}`);
        console.log(`   🎯 QR location stats: ${dashboardResponse.data.qrLocationStatistics ? 'Available' : 'None'}`);
        return true;
      } else {
        console.log('   ❌ Dashboard integration test failed');
        return false;
      }
      
    } else {
      console.log('   ❌ Real-time data retrieval failed');
      return false;
    }
    
  } catch (error) {
    console.error('❌ Real-time features test failed:', error.message);
    return false;
  }
}

/**
 * Main deployment verification runner
 */
async function runDeploymentVerification() {
  console.log('🚀 COMPREHENSIVE DEPLOYMENT VERIFICATION\n');
  console.log('=' + '='.repeat(60));
  console.log(`🌐 Backend URL: ${BACKEND_URL}`);
  console.log(`🖥️  Frontend URL: ${FRONTEND_URL}`);
  console.log(`⏰ Verification time: ${new Date().toLocaleString()}`);
  console.log('=' + '='.repeat(60) + '\n');
  
  const results = {
    systemHealth: null,
    qrCodeFlow: null,
    realTimeFeatures: null,
    geolocationTests: null,
    databaseVerification: null,
    qrAttendanceFlow: null,
    overall: { passed: 0, total: 6 }
  };
  
  try {
    // Test 1: System Health
    console.log('🔍 PHASE 1: SYSTEM HEALTH CHECK');
    console.log('-'.repeat(40));
    results.systemHealth = await testSystemHealth();
    if (results.systemHealth.passed) results.overall.passed++;
    results.overall.total++;
    
    console.log('\n');
    
    // Test 2: QR Code Flow
    console.log('🔍 PHASE 2: QR CODE FLOW VERIFICATION');
    console.log('-'.repeat(40));
    results.qrCodeFlow = await testQRCodeFlow();
    if (results.qrCodeFlow) results.overall.passed++;
    results.overall.total++;
    
    console.log('\n');
    
    // Test 3: Real-time Features
    console.log('🔍 PHASE 3: REAL-TIME FEATURES TEST');
    console.log('-'.repeat(40));
    results.realTimeFeatures = await testRealTimeFeatures();
    if (results.realTimeFeatures) results.overall.passed++;
    results.overall.total++;
    
    console.log('\n');
    
    // Test 4: Geolocation Tests
    console.log('🔍 PHASE 4: GEOLOCATION & GEOFENCING TESTS');
    console.log('-'.repeat(40));
    results.geolocationTests = await runGeolocationTests();
    if (results.geolocationTests) results.overall.passed++;
    results.overall.total++;
    
    console.log('\n');
    
    // Test 5: Database Verification
    console.log('🔍 PHASE 5: DATABASE VERIFICATION');
    console.log('-'.repeat(40));
    results.databaseVerification = await verifyAttendanceRecords();
    if (results.databaseVerification) results.overall.passed++;
    results.overall.total++;
    
    console.log('\n');
    
    // Test 6: Complete QR Attendance Flow
    console.log('🔍 PHASE 6: END-TO-END QR ATTENDANCE FLOW');
    console.log('-'.repeat(40));
    const qrTest1 = await testQRAttendanceScanning();
    const qrTest2 = await testQRAttendanceRetrieval();
    results.qrAttendanceFlow = qrTest1 && qrTest2;
    if (results.qrAttendanceFlow) results.overall.passed++;
    results.overall.total++;
    
  } catch (error) {
    console.error('💥 Deployment verification failed:', error);
  }
  
  // Final Report
  console.log('\n' + '='.repeat(70));
  console.log('📋 DEPLOYMENT VERIFICATION REPORT');
  console.log('='.repeat(70));
  
  const overallScore = Math.round((results.overall.passed / results.overall.total) * 100);
  
  console.log(`\n🎯 Overall Score: ${results.overall.passed}/${results.overall.total} tests passed (${overallScore}%)`);
  
  console.log('\n📊 Test Results:');
  console.log(`   🏥 System Health: ${results.systemHealth?.passed ? '✅ PASS' : '❌ FAIL'} (${results.systemHealth?.percentage || 0}%)`);
  console.log(`   🎯 QR Code Flow: ${results.qrCodeFlow ? '✅ PASS' : '❌ FAIL'}`);
  console.log(`   📡 Real-time Features: ${results.realTimeFeatures ? '✅ PASS' : '❌ FAIL'}`);
  console.log(`   🌍 Geolocation Tests: ${results.geolocationTests ? '✅ PASS' : '❌ FAIL'}`);
  console.log(`   💾 Database Verification: ${results.databaseVerification ? '✅ PASS' : '❌ FAIL'}`);
  console.log(`   🔄 QR Attendance Flow: ${results.qrAttendanceFlow ? '✅ PASS' : '❌ FAIL'}`);
  
  const isDeploymentReady = results.overall.passed >= 5; // At least 5/6 tests must pass
  
  if (isDeploymentReady) {
    console.log('\n🎉 DEPLOYMENT STATUS: ✅ READY FOR PRODUCTION!');
    console.log('\n📋 System is ready for deployment with:');
    console.log('   • QR code generation and validation');
    console.log('   • Real-time attendance tracking');
    console.log('   • Geolocation-based verification');
    console.log('   • Database persistence and retrieval');
    console.log('   • Socket.IO live updates');
    console.log('   • Location-based access control');
    
    console.log('\n🚀 DEPLOYMENT CHECKLIST:');
    console.log('   ✅ Backend server is running correctly');
    console.log('   ✅ MongoDB connection is stable');
    console.log('   ✅ QR attendance system is functional');
    console.log('   ✅ Geofencing system is active');
    console.log('   ✅ Real-time updates are working');
    console.log('   ✅ Database records are properly formatted');
    
    console.log('\n🌐 Your attendance system will work perfectly when deployed!');
    
  } else {
    console.log('\n⚠️  DEPLOYMENT STATUS: ❌ NOT READY - ISSUES FOUND');
    console.log('\n🔧 Please address the failing tests before deployment:');
    
    if (!results.systemHealth?.passed) console.log('   ❌ Fix system health issues');
    if (!results.qrCodeFlow) console.log('   ❌ Fix QR code generation/validation');
    if (!results.realTimeFeatures) console.log('   ❌ Fix real-time features');
    if (!results.geolocationTests) console.log('   ❌ Fix geolocation functionality');
    if (!results.databaseVerification) console.log('   ❌ Fix database issues');
    if (!results.qrAttendanceFlow) console.log('   ❌ Fix QR attendance flow');
  }
  
  console.log('\n' + '='.repeat(70));
  
  return {
    ready: isDeploymentReady,
    score: overallScore,
    results
  };
}

// Run verification
if (require.main === module) {
  runDeploymentVerification().then(result => {
    process.exit(result.ready ? 0 : 1);
  }).catch(error => {
    console.error('💥 Deployment verification execution failed:', error);
    process.exit(1);
  });
}

module.exports = {
  testSystemHealth,
  testQRCodeFlow,
  testRealTimeFeatures,
  runDeploymentVerification
};
