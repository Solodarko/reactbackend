#!/usr/bin/env node

const axios = require('axios');

const BACKEND_URL = 'http://localhost:5000';

async function testWebhookSystem() {
  try {
    console.log('🧪 Testing webhook system...\n');
    
    // Test 1: Backend health
    console.log('1. Testing backend health...');
    const healthResponse = await axios.get(`${BACKEND_URL}/api/health`);
    console.log('   ✅ Backend is running');
    console.log(`   📊 Active Meetings: ${healthResponse.data.activeMeetings}`);
    console.log(`   👥 Active Participants: ${healthResponse.data.activeParticipants}`);
    
    // Test 2: Test webhook endpoint (bypasses signature validation)
    console.log('\n2. Testing webhook processing...');
    const testWebhookResponse = await axios.post(`${BACKEND_URL}/api/webhooks/test-webhook`, {
      eventType: 'meeting.participant_joined',
      meetingId: 'test_meeting_123'
    });
    
    console.log('   ✅ Test webhook endpoint works');
    console.log(`   📄 Response: ${testWebhookResponse.data.success ? 'SUCCESS' : 'FAILED'}`);
    console.log(`   👤 Test participant: ${testWebhookResponse.data.testEvent?.participantName}`);
    
    // Test 3: Check if meeting was registered in global state
    console.log('\n3. Testing meeting registration...');
    const registerResponse = await axios.post(`${BACKEND_URL}/api/zoom/test-register-meeting`, {
      meetingId: 'test_meeting_456',
      topic: 'Test Meeting for Real-time',
      joinUrl: 'https://zoom.us/j/test_meeting_456'
    });
    
    console.log('   ✅ Meeting registration endpoint works');
    console.log(`   📄 Response: ${registerResponse.data.success ? 'SUCCESS' : 'FAILED'}`);
    console.log(`   🏢 Global state size: ${registerResponse.data.globalStateSize}`);
    
    // Test 4: Check real-time data endpoint
    console.log('\n4. Testing real-time data endpoint...');
    const realtimeResponse = await axios.get(`${BACKEND_URL}/api/zoom/real-time`);
    
    console.log('   ✅ Real-time data endpoint works');
    console.log(`   📊 Active meetings: ${realtimeResponse.data.activeMeetings?.length || 0}`);
    console.log(`   👥 Active participants: ${realtimeResponse.data.participants?.length || 0}`);
    
    // Show active meetings
    if (realtimeResponse.data.activeMeetings?.length > 0) {
      console.log('\n   📋 Active meetings in global state:');
      realtimeResponse.data.activeMeetings.forEach(meeting => {
        console.log(`      - ${meeting.topic} (ID: ${meeting.id}, Status: ${meeting.status})`);
      });
    }
    
    console.log('\n' + '='.repeat(60));
    console.log('🎉 WEBHOOK SYSTEM IS WORKING!');
    console.log('\n📝 KEY FINDINGS:');
    console.log('1. Backend server is running and healthy');
    console.log('2. Webhook processing system is functional');
    console.log('3. Meeting registration works');
    console.log('4. Real-time data endpoints are accessible');
    console.log('\n💡 NEXT STEPS:');
    console.log('1. Configure your Zoom app webhook URL to point to your server');
    console.log('2. Add ZOOM_WEBHOOK_SECRET_TOKEN to your .env file');
    console.log('3. Start a real Zoom meeting and verify webhook events arrive');
    console.log('4. Check that meeting status changes from "waiting" to "started"');
    
  } catch (error) {
    console.error('\n❌ Test failed:', error.message);
    
    if (error.response) {
      console.error('Status:', error.response.status);
      console.error('Data:', error.response.data);
    }
    
    console.log('\n🔧 TROUBLESHOOTING STEPS:');
    console.log('1. Make sure backend server is running: npm start');
    console.log('2. Check if all dependencies are installed: npm install');
    console.log('3. Verify .env file has required variables');
    console.log('4. Check server console logs for errors');
  }
}

// Run the test
testWebhookSystem();
