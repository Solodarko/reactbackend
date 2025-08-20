#!/usr/bin/env node

/**
 * Webhook Endpoint Accessibility Test
 * Tests if your webhook endpoint can receive Zoom webhook events
 */

const axios = require('axios');

console.log('🧪 WEBHOOK ENDPOINT ACCESSIBILITY TEST\n');

const WEBHOOK_URL = 'http://localhost:5000/api/webhooks/zoom';
const BACKEND_URL = 'http://localhost:5000';

async function testWebhookEndpoint() {
  try {
    console.log('1. Testing backend health...');
    const healthResponse = await axios.get(`${BACKEND_URL}/api/health`);
    console.log('   ✅ Backend is running');
    console.log(`   📊 Active Meetings: ${healthResponse.data.activeMeetings}`);
    console.log(`   👥 Active Participants: ${healthResponse.data.activeParticipants}`);
    console.log(`   🔌 WebSocket: ${healthResponse.data.socketIO?.connected || 0} connections`);
    
  } catch (error) {
    console.log('   ❌ Backend not running - start with: npm start');
    return false;
  }

  try {
    console.log('\n2. Testing webhook endpoint accessibility...');
    
    // Test webhook endpoint with sample participant joined event
    const sampleWebhookPayload = {
      event: 'meeting.participant_joined',
      event_ts: Date.now(),
      payload: {
        account_id: 'test_account',
        object: {
          id: 'test_meeting_123',
          topic: 'Test Meeting for Webhook',
          host_id: 'test_host',
          participant: {
            id: 'test_participant_456',
            user_id: 'test_user_789',
            user_name: 'Test User',
            email: 'test@example.com',
            join_time: new Date().toISOString()
          }
        }
      }
    };

    const webhookResponse = await axios.post(WEBHOOK_URL, sampleWebhookPayload, {
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'Zoom-Webhook-Test'
      },
      timeout: 5000
    });

    console.log('   ✅ Webhook endpoint is accessible');
    console.log(`   📄 Response: ${webhookResponse.status} - ${JSON.stringify(webhookResponse.data)}`);
    
    // Check if participant was added to database
    console.log('\n3. Checking if data was stored...');
    
    try {
      const attendanceResponse = await axios.get(`${BACKEND_URL}/api/zoom/meeting/test_meeting_123/live-participants`);
      console.log('   ✅ Participant data endpoint accessible');
      console.log(`   📊 Participants found: ${attendanceResponse.data.participants?.length || 0}`);
      
      if (attendanceResponse.data.participants?.length > 0) {
        console.log('   🎉 TEST PARTICIPANT WAS SUCCESSFULLY TRACKED!');
      } else {
        console.log('   ⚠️ No participants found - webhook processing may have issues');
      }
      
    } catch (error) {
      console.log('   ⚠️ Could not fetch participant data:', error.message);
    }

    return true;
    
  } catch (error) {
    console.log('   ❌ Webhook endpoint test failed:', error.message);
    return false;
  }
}

async function testRealTimeUpdates() {
  try {
    console.log('\n4. Testing real-time WebSocket connection...');
    
    const io = require('socket.io-client');
    const socket = io('http://localhost:5000', {
      transports: ['websocket', 'polling'],
      timeout: 5000
    });

    return new Promise((resolve) => {
      let hasConnected = false;
      
      socket.on('connect', () => {
        console.log('   ✅ WebSocket connection successful');
        console.log(`   🔌 Socket ID: ${socket.id}`);
        hasConnected = true;
        
        // Test emitting a participant update
        socket.emit('participantUpdate', {
          meetingId: 'test_meeting_123',
          participantData: {
            id: 'test_participant_456',
            name: 'Test User',
            attendanceStatus: 'Present'
          }
        });
        
        socket.disconnect();
        resolve(true);
      });

      socket.on('connect_error', (error) => {
        console.log('   ❌ WebSocket connection failed:', error.message);
        resolve(false);
      });

      socket.on('notification', (notification) => {
        console.log('   📢 Received notification:', notification.title);
      });

      socket.on('participantUpdate', (data) => {
        console.log('   📊 Received participant update:', data.participant?.name);
      });

      // Timeout after 10 seconds
      setTimeout(() => {
        if (!hasConnected) {
          console.log('   ⏰ WebSocket connection timeout');
          socket.disconnect();
          resolve(false);
        }
      }, 10000);
    });
    
  } catch (error) {
    console.log('   ❌ WebSocket test error:', error.message);
    return false;
  }
}

async function main() {
  console.log('Testing webhook endpoint and real-time system...\n');
  
  const webhookWorking = await testWebhookEndpoint();
  const websocketWorking = await testRealTimeUpdates();
  
  console.log('\n' + '='.repeat(60));
  console.log('📋 TEST RESULTS:');
  console.log(`   Webhook Endpoint: ${webhookWorking ? '✅ WORKING' : '❌ FAILED'}`);
  console.log(`   WebSocket System: ${websocketWorking ? '✅ WORKING' : '❌ FAILED'}`);
  
  if (webhookWorking && websocketWorking) {
    console.log('\n🎉 SYSTEM IS READY FOR REAL ZOOM MEETINGS!');
    console.log('\n📝 NEXT STEPS:');
    console.log('1. Configure your Zoom app webhook URL to point to your server');
    console.log('2. Enable webhook events: Participant Joined, Participant Left');
    console.log('3. Start a real Zoom meeting and have people join');
    console.log('4. Watch your dashboard update in real-time!');
  } else {
    console.log('\n🔧 ISSUES FOUND - Please fix before using with real meetings');
    
    if (!webhookWorking) {
      console.log('\nWebhook Issues:');
      console.log('- Check if backend server is running');
      console.log('- Verify webhook routes are properly configured');
      console.log('- Check database connection');
    }
    
    if (!websocketWorking) {
      console.log('\nWebSocket Issues:');
      console.log('- Check if Socket.IO is properly configured');
      console.log('- Verify CORS settings allow your frontend domain');
      console.log('- Test with frontend Socket.IO connection');
    }
  }
}

if (require.main === module) {
  main().catch(console.error);
}

module.exports = { testWebhookEndpoint, testRealTimeUpdates };
