#!/usr/bin/env node

const axios = require('axios');
const io = require('socket.io-client');

const BACKEND_URL = 'http://localhost:5000';
const TEST_MEETING_ID = '83798262639'; // Your meeting ID

async function simulateParticipants() {
  try {
    console.log('🧪 Testing real-time participant updates...\n');
    
    // Connect to WebSocket first
    console.log('1. Connecting to WebSocket...');
    const socket = io(BACKEND_URL, {
      transports: ['websocket', 'polling']
    });
    
    socket.on('connect', () => {
      console.log('   ✅ WebSocket connected:', socket.id);
    });
    
    socket.on('participantUpdate', (data) => {
      console.log('   📊 Real-time participant update:', data.participant?.name);
    });
    
    socket.on('notification', (notification) => {
      console.log('   🔔 Notification:', notification.message);
    });
    
    // Wait a moment for socket to connect
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    // Test 1: Add some test participants via webhook simulation
    console.log('\n2. Simulating participants joining...');
    
    const testParticipants = [
      {
        name: 'John Doe',
        email: 'john.doe@student.com',
        joinTime: new Date(Date.now() - 10 * 60 * 1000) // 10 minutes ago
      },
      {
        name: 'Jane Smith', 
        email: 'jane.smith@student.com',
        joinTime: new Date(Date.now() - 8 * 60 * 1000) // 8 minutes ago
      },
      {
        name: 'Bob Wilson',
        email: 'bob.wilson@student.com', 
        joinTime: new Date(Date.now() - 5 * 60 * 1000) // 5 minutes ago
      }
    ];
    
    // Simulate participant joined events
    for (let participant of testParticipants) {
      console.log(`   👤 Adding participant: ${participant.name}`);
      
      try {
        const response = await axios.post(`${BACKEND_URL}/api/webhooks/test-webhook`, {
          eventType: 'meeting.participant_joined',
          meetingId: TEST_MEETING_ID,
          participant: participant
        });
        
        if (response.data.success) {
          console.log(`   ✅ ${participant.name} added successfully`);
        }
        
        // Wait between additions
        await new Promise(resolve => setTimeout(resolve, 1000));
        
      } catch (error) {
        console.error(`   ❌ Failed to add ${participant.name}:`, error.response?.data || error.message);
      }
    }
    
    // Test 2: Check attendance data
    console.log('\n3. Checking updated attendance data...');
    
    try {
      const attendanceResponse = await axios.get(`${BACKEND_URL}/api/zoom/meeting/${TEST_MEETING_ID}/attendance-tracker`);
      const data = attendanceResponse.data;
      
      console.log('   📊 Updated Statistics:');
      console.log(`      Total Participants: ${data.statistics?.totalParticipants || 0}`);
      console.log(`      Present Count: ${data.statistics?.presentCount || 0}`);
      console.log(`      Attendance Rate: ${data.statistics?.attendanceRate || 0}%`);
      console.log(`      Participants: ${data.participants?.length || 0} records`);
      
      if (data.participants && data.participants.length > 0) {
        console.log('\n   👥 Participant Details:');
        data.participants.forEach((p, i) => {
          console.log(`      ${i + 1}. ${p.participantName || p.name} (${p.attendanceStatus || 'Unknown'})`);
        });
      }
      
    } catch (error) {
      console.error('   ❌ Failed to get attendance data:', error.response?.data || error.message);
    }
    
    // Test 3: Test real-time endpoint
    console.log('\n4. Testing real-time data endpoint...');
    
    try {
      const realtimeResponse = await axios.get(`${BACKEND_URL}/api/zoom/real-time`);
      console.log(`   📡 Active meetings: ${realtimeResponse.data.activeMeetings?.length || 0}`);
      console.log(`   👥 Active participants: ${realtimeResponse.data.participants?.length || 0}`);
      
    } catch (error) {
      console.error('   ❌ Real-time endpoint error:', error.response?.data || error.message);
    }
    
    console.log('\n' + '='.repeat(60));
    console.log('🎉 SIMULATION COMPLETE!');
    console.log('\n📝 What to check next:');
    console.log('1. Look at your frontend dashboard - it should show participants');
    console.log('2. Check browser console for real-time WebSocket events');
    console.log('3. Verify statistics are updating correctly');
    console.log('4. Test with actual Zoom meeting for full verification');
    
    // Keep socket open for a few seconds to see any delayed events
    setTimeout(() => {
      socket.disconnect();
      process.exit(0);
    }, 5000);
    
  } catch (error) {
    console.error('\n❌ Simulation failed:', error.message);
    process.exit(1);
  }
}

// Run the simulation
simulateParticipants();
