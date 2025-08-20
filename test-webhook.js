#!/usr/bin/env node

/**
 * Zoom Webhook Testing Utility
 * 
 * This script helps test webhook functionality once the secret token is properly configured
 */

const crypto = require('crypto');

console.log('🧪 ZOOM WEBHOOK TESTING UTILITY\n');

// Configuration
const WEBHOOK_URL = 'http://localhost:5000/api/webhooks/zoom';
const SECRET_TOKEN = process.env.ZOOM_WEBHOOK_SECRET_TOKEN || 'your_webhook_secret_from_zoom_app';

/**
 * Generate webhook signature for validation
 */
function generateWebhookSignature(payload, timestamp, secretToken) {
  const message = `v0:${timestamp}:${payload}`;
  const signature = crypto
    .createHmac('sha256', secretToken)
    .update(message, 'utf8')
    .digest('hex');
  
  return `v0=${signature}`;
}

/**
 * Test webhook endpoints with proper signatures
 */
async function testWebhook() {
  console.log('1. Environment Check...');
  console.log(`   Webhook URL: ${WEBHOOK_URL}`);
  console.log(`   Secret Token: ${SECRET_TOKEN.length > 10 ? SECRET_TOKEN.substring(0, 10) + '...' : 'NOT_SET'}`);
  
  if (SECRET_TOKEN === 'your_webhook_secret_from_zoom_app') {
    console.log('❌ ZOOM_WEBHOOK_SECRET_TOKEN is not configured properly!');
    console.log('   Please update your .env file with the actual secret from your Zoom app');
    console.log('   Go to: https://marketplace.zoom.us/develop/create');
    console.log('   Find your app → Features → Webhooks → Secret Token');
    return;
  }

  console.log('\n2. Testing webhook endpoints...\n');

  // Test payloads for different webhook events
  const testEvents = [
    {
      name: 'Meeting Started',
      payload: {
        event: 'meeting.started',
        event_ts: Date.now(),
        payload: {
          account_id: process.env.ZOOM_ACCOUNT_ID,
          object: {
            id: 'test123456',
            topic: 'Test Meeting - Webhook Validation',
            start_time: new Date().toISOString(),
            host_id: 'test_host'
          }
        }
      }
    },
    {
      name: 'Participant Joined',
      payload: {
        event: 'meeting.participant_joined',
        event_ts: Date.now(),
        payload: {
          account_id: process.env.ZOOM_ACCOUNT_ID,
          object: {
            id: 'test123456',
            participant: {
              id: 'part_123',
              user_id: 'user_456',
              user_name: 'Test Participant',
              email: 'test@example.com',
              join_time: new Date().toISOString()
            }
          }
        }
      }
    },
    {
      name: 'Participant Left',
      payload: {
        event: 'meeting.participant_left',
        event_ts: Date.now(),
        payload: {
          account_id: process.env.ZOOM_ACCOUNT_ID,
          object: {
            id: 'test123456',
            participant: {
              id: 'part_123',
              user_id: 'user_456',
              user_name: 'Test Participant',
              email: 'test@example.com',
              leave_time: new Date().toISOString()
            }
          }
        }
      }
    },
    {
      name: 'Meeting Ended',
      payload: {
        event: 'meeting.ended',
        event_ts: Date.now(),
        payload: {
          account_id: process.env.ZOOM_ACCOUNT_ID,
          object: {
            id: 'test123456',
            topic: 'Test Meeting - Webhook Validation',
            start_time: new Date(Date.now() - 3600000).toISOString(),
            end_time: new Date().toISOString()
          }
        }
      }
    }
  ];

  for (const testEvent of testEvents) {
    await testSingleWebhook(testEvent.name, testEvent.payload);
  }

  console.log('\n📋 NEXT STEPS:');
  console.log('1. Update ZOOM_WEBHOOK_SECRET_TOKEN in .env with your actual secret');
  console.log('2. Restart your backend server: npm start');
  console.log('3. Configure your Zoom app webhook URL to: http://your-domain.com/api/webhooks/zoom');
  console.log('4. Subscribe to these webhook events:');
  console.log('   - Meeting Started');
  console.log('   - Meeting Ended'); 
  console.log('   - Participant Joined');
  console.log('   - Participant Left');
  console.log('5. Test with a real Zoom meeting to see dashboard updates');
}

async function testSingleWebhook(eventName, payload) {
  try {
    const timestamp = Math.floor(Date.now() / 1000);
    const payloadString = JSON.stringify(payload);
    const signature = generateWebhookSignature(payloadString, timestamp, SECRET_TOKEN);

    console.log(`🧪 Testing: ${eventName}...`);
    
    const response = await fetch(WEBHOOK_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-zm-request-timestamp': timestamp.toString(),
        'x-zm-signature': signature
      },
      body: payloadString
    });

    if (response.ok) {
      const result = await response.json();
      console.log(`   ✅ ${eventName}: ${response.status} ${response.statusText}`);
      console.log(`   📄 Response: ${result.message || 'Success'}`);
    } else {
      const errorText = await response.text();
      console.log(`   ❌ ${eventName}: ${response.status} ${response.statusText}`);
      console.log(`   📄 Error: ${errorText.substring(0, 200)}...`);
    }

  } catch (error) {
    console.log(`   ❌ ${eventName}: Connection failed`);
    console.log(`   📄 Error: ${error.message}`);
  }
}

// Health check first
async function healthCheck() {
  try {
    console.log('🏥 Backend Health Check...');
    const response = await fetch('http://localhost:5000/api/health');
    
    if (response.ok) {
      const health = await response.json();
      console.log('   ✅ Backend is running');
      console.log(`   📊 Active Meetings: ${health.activeMeetings || 0}`);
      console.log(`   👥 Active Participants: ${health.activeParticipants || 0}`);
      console.log(`   🔌 WebSocket: ${health.socketIO?.connected ? 'Connected' : 'Disconnected'}`);
      console.log(`   📡 Real-time Tracking: ${health.realTimeTracking?.enabled ? 'Enabled' : 'Disabled'}`);
      return true;
    } else {
      console.log('   ❌ Backend health check failed');
      return false;
    }
  } catch (error) {
    console.log('   ❌ Backend is not running or unreachable');
    console.log('   💡 Start your backend with: cd Backend && npm start');
    return false;
  }
}

// Run the tests
async function main() {
  const isHealthy = await healthCheck();
  
  if (isHealthy) {
    console.log('\n' + '='.repeat(60));
    await testWebhook();
  } else {
    console.log('\n❌ Cannot proceed with webhook tests - backend is not running');
  }
}

if (require.main === module) {
  main();
}

module.exports = { testWebhook, healthCheck, generateWebhookSignature };
