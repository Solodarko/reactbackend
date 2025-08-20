const axios = require('axios');
const jwt = require('jsonwebtoken');
const mongoose = require('mongoose');

/**
 * Direct test for Fred's attendance tracking
 * This creates a participant record directly and tests the attendance tracker
 */

const BASE_URL = 'http://localhost:5000';
const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key';

// Fred's test data
const FRED_DATA = {
  name: 'fred',
  email: 'fred@gmail.com',
  role: 'user',
  userId: 'fred_test_user_123'
};

async function testFredAttendanceTracker() {
  console.log('🎯 Testing Fred\'s Attendance Tracking (Direct Method)\n');
  console.log('===================================================\n');
  
  const testMeetingId = `fred_test_meeting_${Date.now()}`;
  console.log(`📋 Using test meeting ID: ${testMeetingId}\n`);
  
  try {
    // Step 1: Generate JWT token for Fred
    console.log('🔐 Step 1: Generating JWT token for Fred...');
    const payload = {
      userId: FRED_DATA.userId,
      name: FRED_DATA.name,
      email: FRED_DATA.email,
      role: FRED_DATA.role,
      firstName: 'Fred',
      lastName: 'TestUser',
      iat: Math.floor(Date.now() / 1000),
      exp: Math.floor(Date.now() / 1000) + (60 * 60)
    };
    
    const fredToken = jwt.sign(payload, JWT_SECRET);
    console.log('✅ JWT token generated successfully');
    console.log(`   User: ${FRED_DATA.name} (${FRED_DATA.email})`);
    console.log(`   Token preview: ${fredToken.substring(0, 50)}...\n`);

    // Step 2: Create participant record directly via API
    console.log('📝 Step 2: Creating participant record directly...');
    
    try {
      // Method 1: Try unified attendance check-in
      const checkinResponse = await axios.post(
        `${BASE_URL}/api/attendance-unified/checkin/${testMeetingId}`,
        {
          participantData: {
            participantName: FRED_DATA.name,
            device: 'Web Browser Test',
            source: 'jwt_token'
          }
        },
        {
          headers: {
            'Authorization': `Bearer ${fredToken}`,
            'Content-Type': 'application/json'
          }
        }
      );
      
      if (checkinResponse.data.success) {
        console.log('✅ Participant record created via check-in');
        console.log(`   Join Time: ${checkinResponse.data.joinTime}`);
      }
    } catch (checkinError) {
      console.log('⚠️ Check-in failed, trying alternative method...');
      
      // Method 2: Try direct webhook simulation
      try {
        const webhookPayload = {
          event: 'meeting.participant_joined',
          payload: {
            object: {
              id: testMeetingId,
              participant: {
                participant_id: `fred_${Date.now()}`,
                participant_name: FRED_DATA.name,
                user_name: FRED_DATA.name,
                email: FRED_DATA.email,
                join_time: new Date().toISOString()
              }
            }
          }
        };
        
        const webhookResponse = await axios.post(
          `${BASE_URL}/api/attendance-unified/zoom/webhook`,
          webhookPayload
        );
        
        if (webhookResponse.data.success) {
          console.log('✅ Participant record created via webhook simulation');
        }
      } catch (webhookError) {
        console.log('⚠️ Webhook simulation also failed, but continuing test...');
      }
    }

    // Step 3: Wait a bit to simulate meeting time
    console.log('\n⏱️ Step 3: Simulating meeting time (10 seconds)...');
    await sleep(10000);
    console.log('✅ Meeting simulation completed\n');

    // Step 4: Test the 85% Attendance Tracker endpoint
    console.log('📊 Step 4: Testing 85% Attendance Tracker endpoint...');
    
    try {
      const response = await axios.get(
        `${BASE_URL}/api/zoom/meeting/${testMeetingId}/attendance-tracker?threshold=85&includeInactive=true`
      );
      
      if (response.data.success) {
        console.log('✅ 85% Attendance Tracker endpoint is working!\n');
        
        // Display meeting information
        console.log('📋 Meeting Information:');
        console.log(`   Meeting ID: ${testMeetingId}`);
        console.log(`   Topic: ${response.data.meetingInfo?.topic || 'Fred Test Meeting'}`);
        console.log(`   Duration: ${response.data.meetingInfo?.duration || 60} minutes`);
        
        // Display participants
        console.log('\n👥 Participants in Admin Dashboard Table:');
        if (response.data.participants && response.data.participants.length > 0) {
          response.data.participants.forEach((participant, index) => {
            console.log(`\n   ${index + 1}. ${participant.participantName || 'Unknown'}`);
            console.log(`      📧 Email: ${participant.email || 'N/A'}`);
            console.log(`      ⏰ Join Time: ${participant.joinTime || 'N/A'}`);
            console.log(`      ⏰ Leave Time: ${participant.leaveTime || 'Still in meeting'}`);
            console.log(`      ⏱️ Duration: ${participant.duration || 0} minutes`);
            console.log(`      📊 Percentage: ${participant.percentage || 0}%`);
            console.log(`      📈 Status: ${participant.status || 'Unknown'}`);
            console.log(`      🎯 85% Threshold: ${(participant.percentage || 0) >= 85 ? '✅ MET' : '❌ NOT MET'}`);
            console.log(`      🎓 Student Info: ${participant.studentInfo ? 'Matched' : 'Not matched'}`);
            console.log(`      🔐 Authenticated: ${participant.authenticatedUser ? 'Yes' : 'No'}`);
            console.log(`      🔗 Source: ${participant.source || 'Unknown'}`);
            console.log('      ---');
          });
        } else {
          console.log('   ❌ No participants found in the table');
          console.log('   📝 This means the participant record creation failed');
        }
        
        // Display statistics
        console.log('\n📈 Statistics for Admin Dashboard:');
        const stats = response.data.statistics || {};
        console.log(`   Total Participants: ${stats.totalParticipants || 0}`);
        console.log(`   Present (≥85%): ${stats.presentCount || 0}`);
        console.log(`   Absent (<85%): ${stats.absentCount || 0}`);
        console.log(`   In Progress: ${stats.inProgressCount || 0}`);
        console.log(`   Above 85% Threshold: ${stats.above85Percent || 0}`);
        console.log(`   Below 85% Threshold: ${stats.below85Percent || 0}`);
        console.log(`   Average Attendance: ${stats.averageAttendance || 0}%`);
        console.log(`   Authenticated Users: ${stats.authenticatedCount || 0}`);
        console.log(`   Students Identified: ${stats.studentsIdentified || 0}`);
        
        // Test WebSocket functionality
        console.log('\n🔌 Step 5: Testing WebSocket tracking...');
        try {
          const wsResponse = await axios.post(
            `${BASE_URL}/api/zoom/meeting/${testMeetingId}/attendance-tracker/start-websocket`,
            { interval: 3000 }
          );
          
          if (wsResponse.data.success) {
            console.log('✅ WebSocket tracking started successfully');
            console.log(`   Real-time updates every ${wsResponse.data.interval}ms`);
          }
        } catch (wsError) {
          console.log('⚠️ WebSocket tracking not available:', wsError.response?.data?.error || wsError.message);
        }
        
      } else {
        console.log('❌ Attendance tracker returned error:', response.data.error);
      }
      
    } catch (trackerError) {
      console.log('❌ Attendance tracker endpoint error:', trackerError.response?.data?.error || trackerError.message);
      
      // Try to get more details about the error
      if (trackerError.response?.status === 404) {
        console.log('💡 This might mean the meeting or participants weren\'t found');
      } else if (trackerError.response?.status === 500) {
        console.log('💡 This might be a server error - check your backend logs');
      }
    }

    // Step 6: Test alternative endpoints
    console.log('\n🔍 Step 6: Testing alternative endpoints...');
    
    // Test unified attendance endpoint
    try {
      const unifiedResponse = await axios.get(
        `${BASE_URL}/api/attendance-unified/meeting/${testMeetingId}?threshold=85`
      );
      
      if (unifiedResponse.data.success) {
        console.log('✅ Unified attendance endpoint working');
        console.log(`   Participants found: ${unifiedResponse.data.participants?.length || 0}`);
      }
    } catch (unifiedError) {
      console.log('⚠️ Unified attendance endpoint not working:', unifiedError.response?.data?.error || unifiedError.message);
    }

    // Step 7: Try to check out Fred
    console.log('\n📤 Step 7: Testing check-out...');
    try {
      const checkoutResponse = await axios.post(
        `${BASE_URL}/api/attendance-unified/checkout/${testMeetingId}`,
        {},
        {
          headers: {
            'Authorization': `Bearer ${fredToken}`,
            'Content-Type': 'application/json'
          }
        }
      );
      
      if (checkoutResponse.data.success) {
        console.log('✅ Check-out successful');
        console.log(`   Final Duration: ${checkoutResponse.data.duration} minutes`);
        console.log(`   Final Percentage: ${checkoutResponse.data.percentage}%`);
        console.log(`   Final Status: ${checkoutResponse.data.status}`);
      }
    } catch (checkoutError) {
      console.log('⚠️ Check-out failed:', checkoutError.response?.data?.error || checkoutError.message);
    }

    // Final test of the attendance tracker after checkout
    console.log('\n🔍 Step 8: Final attendance verification...');
    try {
      const finalResponse = await axios.get(
        `${BASE_URL}/api/zoom/meeting/${testMeetingId}/attendance-tracker?threshold=85`
      );
      
      if (finalResponse.data.success && finalResponse.data.participants.length > 0) {
        console.log('🎉 SUCCESS! Fred\'s attendance is now in the admin dashboard table!');
        
        const fredParticipant = finalResponse.data.participants.find(p => 
          p.participantName?.toLowerCase().includes('fred') || 
          p.email?.toLowerCase().includes('fred')
        );
        
        if (fredParticipant) {
          console.log('\n🎯 Fred\'s Final Attendance Record:');
          console.log(`   Name: ${fredParticipant.participantName}`);
          console.log(`   Email: ${fredParticipant.email}`);
          console.log(`   Duration: ${fredParticipant.duration} minutes`);
          console.log(`   Percentage: ${fredParticipant.percentage}%`);
          console.log(`   Status: ${fredParticipant.status}`);
          console.log(`   85% Threshold: ${fredParticipant.percentage >= 85 ? '✅ MET' : '❌ NOT MET'}`);
          console.log(`   Authenticated: ${fredParticipant.authenticatedUser ? '✅ Yes' : '❌ No'}`);
        }
      }
    } catch (finalError) {
      console.log('⚠️ Final verification failed:', finalError.response?.data?.error || finalError.message);
    }

    console.log('\n🏁 Test completed!');
    console.log('\n📋 How to view in Admin Dashboard:');
    console.log(`   1. Open your admin dashboard`);
    console.log(`   2. Navigate to Meeting Participants`);
    console.log(`   3. Select meeting ID: ${testMeetingId}`);
    console.log(`   4. You should see Fred's attendance data in the table`);
    console.log(`\n🔗 API Endpoint for Admin Dashboard:`);
    console.log(`   GET ${BASE_URL}/api/zoom/meeting/${testMeetingId}/attendance-tracker?threshold=85`);
    
  } catch (error) {
    console.error('❌ Test failed:', error.message);
  }
}

// Helper function to sleep
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Run the test
if (require.main === module) {
  testFredAttendanceTracker();
}

module.exports = { testFredAttendanceTracker, FRED_DATA };
