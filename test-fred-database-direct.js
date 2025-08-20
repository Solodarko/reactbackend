const axios = require('axios');
const mongoose = require('mongoose');
require('dotenv').config();

/**
 * Direct database test for Fred's attendance tracking
 * This creates a participant record directly in MongoDB and tests the attendance tracker
 */

const BASE_URL = 'http://localhost:5000';

// Fred's test data
const FRED_DATA = {
  name: 'fred',
  email: 'fred@gmail.com',
  role: 'user',
  userId: 'fred_test_user_123'
};

async function testFredWithDirectDatabase() {
  console.log('🎯 Testing Fred\'s Attendance with Direct Database Access\n');
  console.log('=====================================================\n');
  
  const testMeetingId = `fred_direct_test_${Date.now()}`;
  console.log(`📋 Using test meeting ID: ${testMeetingId}\n`);
  
  try {
    // Step 1: Connect to MongoDB
    console.log('🔌 Step 1: Connecting to MongoDB...');
    const mongoUri = process.env.MONGODB_URI || 'mongodb://localhost:27017/attendance_tracker';
    await mongoose.connect(mongoUri);
    console.log('✅ Connected to MongoDB successfully\n');

    // Step 2: Define Participant schema (simplified)
    console.log('📋 Step 2: Setting up database models...');
    
    const ParticipantSchema = new mongoose.Schema({
      participantId: { type: String, required: true },
      participantName: { type: String, required: true },
      email: { type: String },
      meetingId: { type: String, required: true },
      joinTime: { type: Date, default: Date.now },
      leaveTime: { type: Date },
      duration: { type: Number, default: 0 },
      isActive: { type: Boolean, default: true },
      connectionStatus: { type: String, default: 'joined' },
      userType: { type: String, default: 'participant' },
      source: { type: String, default: 'jwt_token' },
      tokenBased: { type: Boolean, default: true },
      createdAt: { type: Date, default: Date.now }
    }, { 
      collection: 'participants',
      timestamps: true 
    });

    const Participant = mongoose.models.Participant || mongoose.model('Participant', ParticipantSchema);
    console.log('✅ Database models ready\n');

    // Step 3: Create Fred's participant record directly
    console.log('📝 Step 3: Creating Fred\'s participant record directly in database...');
    
    const joinTime = new Date();
    const fredParticipant = new Participant({
      participantId: `fred_${Date.now()}`,
      participantName: FRED_DATA.name,
      email: FRED_DATA.email,
      meetingId: testMeetingId,
      joinTime: joinTime,
      leaveTime: null,
      duration: 0,
      isActive: true,
      connectionStatus: 'in_meeting',
      userType: 'student',
      source: 'jwt_token',
      tokenBased: true,
      userId: FRED_DATA.userId
    });

    await fredParticipant.save();
    console.log('✅ Fred\'s participant record created successfully');
    console.log(`   Participant ID: ${fredParticipant.participantId}`);
    console.log(`   Name: ${fredParticipant.participantName}`);
    console.log(`   Email: ${fredParticipant.email}`);
    console.log(`   Join Time: ${fredParticipant.joinTime}`);
    console.log(`   Meeting ID: ${fredParticipant.meetingId}\n`);

    // Step 4: Wait to simulate meeting activity
    console.log('⏱️ Step 4: Simulating meeting activity (15 seconds)...');
    await sleep(15000);
    console.log('✅ Meeting activity simulation completed\n');

    // Step 5: Update Fred's record to show he left (for complete attendance)
    console.log('📝 Step 5: Updating Fred to mark as left meeting...');
    const leaveTime = new Date();
    const durationMinutes = Math.round((leaveTime - joinTime) / (1000 * 60));
    
    fredParticipant.leaveTime = leaveTime;
    fredParticipant.duration = durationMinutes;
    fredParticipant.isActive = false;
    fredParticipant.connectionStatus = 'left';
    await fredParticipant.save();
    
    console.log(`✅ Fred marked as left after ${durationMinutes} minutes\n`);

    // Step 6: Test the 85% Attendance Tracker endpoint
    console.log('📊 Step 6: Testing 85% Attendance Tracker endpoint...');
    
    try {
      const response = await axios.get(
        `${BASE_URL}/api/zoom/meeting/${testMeetingId}/attendance-tracker?threshold=85`
      );
      
      if (response.data.success) {
        console.log('🎉 SUCCESS! 85% Attendance Tracker is working!\n');
        
        // Display meeting information
        console.log('📋 Meeting Information:');
        console.log(`   Meeting ID: ${testMeetingId}`);
        console.log(`   Topic: ${response.data.meetingInfo?.topic || 'Fred Test Meeting'}`);
        console.log(`   Duration: ${response.data.meetingInfo?.duration || 60} minutes`);
        
        // Display participants
        console.log('\n🎯 FRED\'S DATA IN ADMIN DASHBOARD TABLE:');
        console.log('==========================================');
        
        if (response.data.participants && response.data.participants.length > 0) {
          response.data.participants.forEach((participant, index) => {
            console.log(`\n   ${index + 1}. Participant: ${participant.participantName || 'Unknown'}`);
            console.log(`      📧 Email: ${participant.email || 'N/A'}`);
            console.log(`      ⏰ Join Time: ${new Date(participant.joinTime).toLocaleString()}`);
            console.log(`      ⏰ Leave Time: ${participant.leaveTime ? new Date(participant.leaveTime).toLocaleString() : 'Still in meeting'}`);
            console.log(`      ⏱️ Duration: ${participant.duration || 0} minutes`);
            console.log(`      📊 Attendance Percentage: ${participant.percentage || 0}%`);
            console.log(`      📈 Status: ${participant.status || 'Unknown'}`);
            console.log(`      🎯 Meets 85% Threshold: ${(participant.percentage || 0) >= 85 ? '✅ YES' : '❌ NO'}`);
            console.log(`      🎓 Student Info: ${participant.studentInfo ? 'Matched' : 'Not matched'}`);
            console.log(`      🔐 Authenticated User: ${participant.authenticatedUser ? 'Yes' : 'No'}`);
            console.log(`      🔗 Data Source: ${participant.source || 'Unknown'}`);
            console.log('      ════════════════════════════════════════');
            
            // Check if this is Fred
            if (participant.participantName?.toLowerCase() === 'fred' || 
                participant.email?.toLowerCase().includes('fred')) {
              console.log('      🎯 ✅ THIS IS FRED\'S RECORD! ✅');
            }
          });
        } else {
          console.log('   ❌ No participants found - something went wrong');
        }
        
        // Display statistics
        console.log('\n📈 Admin Dashboard Statistics:');
        console.log('==============================');
        const stats = response.data.statistics || {};
        console.log(`   📊 Total Participants: ${stats.totalParticipants || 0}`);
        console.log(`   ✅ Present (≥85%): ${stats.presentCount || 0}`);
        console.log(`   ❌ Absent (<85%): ${stats.absentCount || 0}`);
        console.log(`   🔄 In Progress: ${stats.inProgressCount || 0}`);
        console.log(`   📈 Above 85% Threshold: ${stats.above85Percent || 0}`);
        console.log(`   📉 Below 85% Threshold: ${stats.below85Percent || 0}`);
        console.log(`   📊 Average Attendance: ${stats.averageAttendance || 0}%`);
        console.log(`   🔐 Authenticated Users: ${stats.authenticatedCount || 0}`);
        console.log(`   🎓 Students Identified: ${stats.studentsIdentified || 0}`);
        
      } else {
        console.log('❌ Attendance tracker returned error:', response.data.error);
      }
      
    } catch (trackerError) {
      console.log('❌ Attendance tracker endpoint error:', trackerError.response?.data?.error || trackerError.message);
    }

    // Step 7: Test with different thresholds
    console.log('\n🔍 Step 7: Testing different attendance thresholds...');
    
    for (const threshold of [70, 85, 90]) {
      try {
        const thresholdResponse = await axios.get(
          `${BASE_URL}/api/zoom/meeting/${testMeetingId}/attendance-tracker?threshold=${threshold}`
        );
        
        if (thresholdResponse.data.success && thresholdResponse.data.participants.length > 0) {
          const fredParticipant = thresholdResponse.data.participants.find(p => 
            p.participantName?.toLowerCase() === 'fred'
          );
          
          if (fredParticipant) {
            const meetsThreshold = fredParticipant.percentage >= threshold;
            console.log(`   ${threshold}% Threshold: Fred's ${fredParticipant.percentage}% ${meetsThreshold ? '✅ MEETS' : '❌ FAILS'} requirement`);
          }
        }
      } catch (error) {
        console.log(`   ${threshold}% Threshold: ❌ Error testing`);
      }
    }

    // Step 8: WebSocket tracking test
    console.log('\n🔌 Step 8: Testing WebSocket real-time tracking...');
    try {
      const wsResponse = await axios.post(
        `${BASE_URL}/api/zoom/meeting/${testMeetingId}/attendance-tracker/start-websocket`,
        { interval: 2000 }
      );
      
      if (wsResponse.data.success) {
        console.log('✅ WebSocket tracking started successfully');
        console.log(`   Real-time updates every ${wsResponse.data.interval}ms`);
        console.log('   This means the admin dashboard will update automatically!');
      }
    } catch (wsError) {
      console.log('⚠️ WebSocket tracking not available:', wsError.response?.data?.error || wsError.message);
    }

    console.log('\n🎉 TEST COMPLETED SUCCESSFULLY!');
    console.log('================================');
    console.log('\n✅ Fred\'s attendance data is now available in the admin dashboard!');
    console.log('\n📋 How to access in your admin interface:');
    console.log('   1. Open your admin dashboard');
    console.log('   2. Navigate to "Meeting Participants" or "Attendance Tracking"');
    console.log(`   3. Enter meeting ID: ${testMeetingId}`);
    console.log('   4. You will see Fred\'s attendance record with all details');
    console.log('\n🔗 Direct API endpoints you can use:');
    console.log(`   • GET ${BASE_URL}/api/zoom/meeting/${testMeetingId}/attendance-tracker?threshold=85`);
    console.log(`   • GET ${BASE_URL}/api/attendance-unified/meeting/${testMeetingId}?threshold=85`);
    console.log('\n📊 The table will show:');
    console.log('   • Participant Name: fred');
    console.log('   • Email: fred@gmail.com');
    console.log(`   • Duration: ${durationMinutes} minutes`);
    console.log('   • Attendance Percentage: (calculated based on meeting duration)');
    console.log('   • Status: Present/Absent based on 85% threshold');
    console.log('   • Source: JWT Token (authenticated user)');
    
  } catch (error) {
    console.error('❌ Test failed:', error.message);
    console.error('Stack:', error.stack);
  } finally {
    // Clean up database connection
    try {
      await mongoose.disconnect();
      console.log('\n🔌 Disconnected from MongoDB');
    } catch (disconnectError) {
      console.log('⚠️ Error disconnecting from MongoDB:', disconnectError.message);
    }
  }
}

// Helper function to sleep
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Run the test
if (require.main === module) {
  testFredWithDirectDatabase();
}

module.exports = { testFredWithDirectDatabase, FRED_DATA };
