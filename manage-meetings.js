#!/usr/bin/env node

const axios = require('axios');

const BACKEND_URL = 'http://localhost:5000';

async function manageMeetings() {
  const command = process.argv[2];
  const meetingId = process.argv[3];
  const meetingTopic = process.argv[4] || 'New Meeting';

  console.log('🔧 Meeting Status Manager\n');

  try {
    switch (command) {
      case 'list':
        await listMeetings();
        break;
      case 'active':
        await listActiveMeetings();
        break;
      case 'promote':
        if (!meetingId) {
          console.log('❌ Usage: node manage-meetings.js promote MEETING_ID');
          return;
        }
        await promoteMeeting(meetingId);
        break;
      case 'create':
        if (!meetingId) {
          console.log('❌ Usage: node manage-meetings.js create MEETING_ID "Meeting Topic"');
          return;
        }
        await createActiveMeeting(meetingId, meetingTopic);
        break;
      case 'start':
        if (!meetingId) {
          console.log('❌ Usage: node manage-meetings.js start MEETING_ID');
          return;
        }
        await simulateMeetingStart(meetingId);
        break;
      case 'status':
        if (!meetingId) {
          console.log('❌ Usage: node manage-meetings.js status MEETING_ID');
          return;
        }
        await checkMeetingStatus(meetingId);
        break;
      default:
        showHelp();
    }
  } catch (error) {
    console.error('❌ Error:', error.message);
  }
}

async function listMeetings() {
  console.log('📋 Listing all meetings...');
  
  try {
    const response = await axios.get(`${BACKEND_URL}/api/meetings/active-with-created`);
    const meetings = response.data.meetings || [];
    
    console.log(`\n📊 Found ${meetings.length} meetings:`);
    meetings.forEach((meeting, i) => {
      console.log(`   ${i + 1}. ${meeting.topic} (ID: ${meeting.id})`);
      console.log(`      Status: ${meeting.status}`);
      console.log(`      Created: ${meeting.created_at || 'Unknown'}`);
      console.log('');
    });
  } catch (error) {
    console.error('❌ Failed to list meetings:', error.response?.data || error.message);
  }
}

async function listActiveMeetings() {
  console.log('🔴 Listing active meetings...');
  
  try {
    const response = await axios.get(`${BACKEND_URL}/api/zoom/real-time`);
    const activeMeetings = response.data.activeMeetings || [];
    
    console.log(`\n📊 Found ${activeMeetings.length} active meetings:`);
    activeMeetings.forEach((meeting, i) => {
      console.log(`   ${i + 1}. ${meeting.topic} (ID: ${meeting.id})`);
      console.log(`      Status: ${meeting.status}`);
      console.log(`      Participants: ${meeting.participantCount || 0}`);
      console.log(`      Join URL: ${meeting.join_url || 'N/A'}`);
      console.log('');
    });
  } catch (error) {
    console.error('❌ Failed to list active meetings:', error.response?.data || error.message);
  }
}

async function promoteMeeting(meetingId) {
  console.log(`🚀 Promoting meeting ${meetingId} to active status...`);
  
  try {
    const response = await axios.post(`${BACKEND_URL}/api/meetings/promote-to-active/${meetingId}`);
    
    if (response.data.success) {
      console.log('✅ Meeting promoted successfully!');
      console.log(`   Topic: ${response.data.meeting.topic}`);
      console.log(`   Status: ${response.data.meeting.status}`);
      console.log(`   ID: ${response.data.meeting.id}`);
    }
  } catch (error) {
    console.error('❌ Failed to promote meeting:', error.response?.data || error.message);
  }
}

async function createActiveMeeting(meetingId, topic) {
  console.log(`🆕 Creating new active meeting: "${topic}"...`);
  
  try {
    const response = await axios.post(`${BACKEND_URL}/api/zoom/test-register-meeting`, {
      meetingId: meetingId,
      topic: topic,
      status: 'started'
    });
    
    if (response.data.success) {
      console.log('✅ Active meeting created successfully!');
      console.log(`   Topic: ${response.data.meeting.topic}`);
      console.log(`   ID: ${response.data.meeting.id}`);
      console.log(`   Join URL: ${response.data.meeting.join_url}`);
    }
  } catch (error) {
    console.error('❌ Failed to create active meeting:', error.response?.data || error.message);
  }
}

async function simulateMeetingStart(meetingId) {
  console.log(`▶️ Simulating meeting start for ${meetingId}...`);
  
  try {
    const response = await axios.post(`${BACKEND_URL}/api/webhooks/test-webhook`, {
      eventType: 'meeting.started',
      meetingId: meetingId
    });
    
    if (response.data.success) {
      console.log('✅ Meeting start simulated successfully!');
      console.log(`   Event Type: ${response.data.testEvent.eventType}`);
      console.log(`   Meeting ID: ${response.data.testEvent.meetingId}`);
    }
  } catch (error) {
    console.error('❌ Failed to simulate meeting start:', error.response?.data || error.message);
  }
}

async function checkMeetingStatus(meetingId) {
  console.log(`🔍 Checking status for meeting ${meetingId}...`);
  
  try {
    const response = await axios.get(`${BACKEND_URL}/api/meetings/webhook-status/${meetingId}`);
    
    console.log('\n📊 Meeting Status Report:');
    console.log(`   Meeting ID: ${response.data.meetingId}`);
    console.log(`   In Global State: ${response.data.status.inGlobalState ? '✅' : '❌'}`);
    console.log(`   Has Webhook Events: ${response.data.status.hasWebhookEvents ? '✅' : '❌'}`);
    console.log(`   Global State Status: ${response.data.status.globalStateStatus || 'Not in global state'}`);
    console.log(`   Manually Promoted: ${response.data.status.manuallyPromoted ? '✅' : '❌'}`);
    
    if (response.data.meeting) {
      console.log(`   Database Status: ${response.data.meeting.status}`);
      console.log(`   Topic: ${response.data.meeting.topic}`);
    }
  } catch (error) {
    console.error('❌ Failed to check meeting status:', error.response?.data || error.message);
  }
}

function showHelp() {
  console.log(`
📖 Meeting Status Manager Help

Commands:
  list                    - List all meetings (database + active)
  active                  - List only active meetings
  promote MEETING_ID      - Promote existing meeting to active
  create MEETING_ID TOPIC - Create new active meeting
  start MEETING_ID        - Simulate meeting.started webhook
  status MEETING_ID       - Check detailed meeting status

Examples:
  node manage-meetings.js list
  node manage-meetings.js active
  node manage-meetings.js promote 83798262639
  node manage-meetings.js create 999888777 "My Test Meeting"
  node manage-meetings.js start 83798262639
  node manage-meetings.js status 83798262639
`);
}

// Run the manager
manageMeetings();
