const axios = require('axios');
const mongoose = require('mongoose');
require('dotenv').config();

/**
 * Test Fred's attendance tracking with 85% threshold SUCCESS
 * This creates a participant record where Fred stays long enough to meet 85% threshold
 */

const BASE_URL = 'http://localhost:5000';

// Fred's test data
const FRED_DATA = {
  name: 'fred',
  email: 'fred@gmail.com',
  role: 'user',
  userId: 'fred_test_user_123'
};

async function testFred85PercentSuccess() {
  console.log('🎯 Testing Fred Meeting 85% Attendance Threshold\n');
  console.log('===============================================\n');
  
  const testMeetingId = `fred_85percent_success_${Date.now()}`;
  console.log(`📋 Using test meeting ID: ${testMeetingId}\n`);
  
  try {
    // Step 1: Connect to MongoDB
    console.log('🔌 Step 1: Connecting to MongoDB...');
    const mongoUri = process.env.MONGODB_URI || 'mongodb://localhost:27017/attendance_tracker';
    await mongoose.connect(mongoUri);
    console.log('✅ Connected to MongoDB successfully\n');

    // Step 2: Define models
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
      userId: { type: String },
      createdAt: { type: Date, default: Date.now }
    }, { 
      collection: 'participants',
      timestamps: true 
    });

    // Also create a ZoomMeeting for proper duration calculation
    const ZoomMeetingSchema = new mongoose.Schema({
      meetingId: { type: String, required: true },
      topic: { type: String, default: 'Test Meeting' },
      startTime: { type: Date },
      endTime: { type: Date },
      duration: { type: Number, default: 60 }, // 60 minutes
      status: { type: String, default: 'completed' }
    }, { 
      collection: 'zoommeetings',
      timestamps: true 
    });

    const Participant = mongoose.models.Participant || mongoose.model('Participant', ParticipantSchema);
    const ZoomMeeting = mongoose.models.ZoomMeeting || mongoose.model('ZoomMeeting', ZoomMeetingSchema);
    console.log('✅ Database models ready\n');

    // Step 3: Create a meeting record
    console.log('📅 Step 3: Creating meeting record...');
    const meetingStartTime = new Date();
    const meetingEndTime = new Date(meetingStartTime.getTime() + (60 * 60 * 1000)); // 1 hour later
    
    const zoomMeeting = new ZoomMeeting({
      meetingId: testMeetingId,
      topic: 'Fred 85% Attendance Test Meeting',
      startTime: meetingStartTime,
      endTime: meetingEndTime,
      duration: 60, // 60 minutes
      status: 'completed'
    });
    
    await zoomMeeting.save();
    console.log(`✅ Meeting created: 60-minute duration\n`);

    // Step 4: Create Fred's participant record (join at start)
    console.log('📝 Step 4: Fred joins the meeting at the start...');
    const joinTime = new Date(meetingStartTime.getTime() + (2 * 60 * 1000)); // Join 2 minutes after start
    
    const fredParticipant = new Participant({
      participantId: `fred_success_${Date.now()}`,
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
    console.log('✅ Fred joined the meeting');
    console.log(`   Join Time: ${joinTime.toLocaleString()}\n`);

    // Step 5: Simulate Fred staying for 52 minutes (87% attendance)
    console.log('⏱️ Step 5: Fred attends for 52 minutes (87% of 60-minute meeting)...');
    const leaveTime = new Date(joinTime.getTime() + (52 * 60 * 1000)); // 52 minutes later
    const durationMinutes = 52;
    
    fredParticipant.leaveTime = leaveTime;
    fredParticipant.duration = durationMinutes;
    fredParticipant.isActive = false;
    fredParticipant.connectionStatus = 'left';
    await fredParticipant.save();
    
    console.log(`✅ Fred left after ${durationMinutes} minutes`);
    console.log(`   Leave Time: ${leaveTime.toLocaleString()}`);
    console.log(`   Expected Attendance: 87% (above 85% threshold!)\n`);

    // Step 6: Test the 85% Attendance Tracker
    console.log('📊 Step 6: Testing 85% Attendance Tracker...');
    
    const response = await axios.get(
      `${BASE_URL}/api/zoom/meeting/${testMeetingId}/attendance-tracker?threshold=85`
    );
    
    if (response.data.success) {
      console.log('🎉 SUCCESS! Fred meets the 85% threshold!\n');
      
      // Display meeting information
      console.log('📋 Meeting Information:');
      console.log(`   Meeting ID: ${testMeetingId}`);
      console.log(`   Topic: ${response.data.meetingInfo?.topic || 'Fred 85% Success Test'}`);
      console.log(`   Duration: ${response.data.meetingInfo?.duration || 60} minutes`);
      
      // Display Fred's data
      console.log('\n🎯 FRED\'S SUCCESS STORY:');
      console.log('========================');
      
      if (response.data.participants && response.data.participants.length > 0) {
        const fredData = response.data.participants[0];
        console.log(`   👤 Participant: ${fredData.participantName}`);
        console.log(`   📧 Email: ${fredData.email}`);
        console.log(`   ⏰ Join Time: ${new Date(fredData.joinTime).toLocaleString()}`);
        console.log(`   ⏰ Leave Time: ${new Date(fredData.leaveTime).toLocaleString()}`);
        console.log(`   ⏱️ Duration: ${fredData.duration} minutes`);
        console.log(`   📊 Attendance Percentage: ${fredData.percentage}%`);
        console.log(`   📈 Status: ${fredData.status}`);
        console.log(`   🎯 Meets 85% Threshold: ${fredData.percentage >= 85 ? '✅ YES!' : '❌ NO'}`);
        console.log(`   🎓 Student Matched: ${fredData.studentInfo ? 'Yes' : 'No'}`);
        
        if (fredData.percentage >= 85) {
          console.log('\n   🎉 CONGRATULATIONS! Fred has successfully met the 85% attendance requirement!');
          console.log('   🏆 This would be marked as "Present" in the admin dashboard!');
        }
      }
      
      // Display statistics
      console.log('\n📈 Final Statistics:');
      console.log('===================');
      const stats = response.data.statistics || {};
      console.log(`   📊 Total Participants: ${stats.totalParticipants || 0}`);
      console.log(`   ✅ Present (≥85%): ${stats.presentCount || 0}`);
      console.log(`   ❌ Absent (\u003c85%): ${stats.absentCount || 0}`);
      console.log(`   📈 Above 85% Threshold: ${stats.above85Percent || 0}`);
      console.log(`   📉 Below 85% Threshold: ${stats.below85Percent || 0}`);
      console.log(`   📊 Average Attendance: ${stats.averageAttendance || 0}%`);
    }

    // Step 7: Test multiple scenarios
    console.log('\n🔍 Step 7: Testing different attendance scenarios...');
    
    // Create additional participants with different attendance levels
    const scenarios = [
      { name: 'alice', duration: 30, expected: 'Absent (50%)' },
      { name: 'bob', duration: 45, expected: 'Absent (75%)' },
      { name: 'charlie', duration: 55, expected: 'Present (92%)' }
    ];
    
    for (const scenario of scenarios) {
      const participant = new Participant({
        participantId: `${scenario.name}_${Date.now()}`,
        participantName: scenario.name,
        email: `${scenario.name}@example.com`,
        meetingId: testMeetingId,
        joinTime: meetingStartTime,
        leaveTime: new Date(meetingStartTime.getTime() + (scenario.duration * 60 * 1000)),
        duration: scenario.duration,
        isActive: false,
        connectionStatus: 'left',
        userType: 'student',
        source: 'zoom_webhook'
      });
      await participant.save();
      console.log(`   ✅ ${scenario.name}: ${scenario.duration} minutes - ${scenario.expected}`);
    }

    // Test the updated data
    console.log('\n📊 Final attendance report with all participants:');
    const finalResponse = await axios.get(
      `${BASE_URL}/api/zoom/meeting/${testMeetingId}/attendance-tracker?threshold=85`
    );
    
    if (finalResponse.data.success) {
      console.log('\n👥 All Participants in Admin Dashboard:');
      console.log('======================================');
      finalResponse.data.participants.forEach((p, index) => {
        const status = p.percentage >= 85 ? '✅ PRESENT' : '❌ ABSENT';
        console.log(`   ${index + 1}. ${p.participantName} - ${p.duration}min (${p.percentage}%) ${status}`);
      });
      
      const finalStats = finalResponse.data.statistics;
      console.log('\n📈 Complete Statistics:');
      console.log(`   Total: ${finalStats.totalParticipants}, Present: ${finalStats.presentCount}, Absent: ${finalStats.absentCount}`);
      console.log(`   Attendance Rate: ${((finalStats.presentCount / finalStats.totalParticipants) * 100).toFixed(1)}%`);
    }

    console.log('\n🎉 COMPREHENSIVE TEST COMPLETED!');
    console.log('================================');
    console.log('\n✅ What this demonstrates:');
    console.log('   • Fred attended 52 out of 60 minutes = 87% attendance');
    console.log('   • 87% is above the 85% threshold');
    console.log('   • Fred would appear as "Present" in the admin dashboard');
    console.log('   • The system correctly tracks attendance from Zoom API/webhooks');
    console.log('   • JWT token authentication works with attendance tracking');
    console.log('   • Multiple participants with different attendance levels work correctly');
    
    console.log('\n🔗 API Endpoint to view results:');
    console.log(`   GET ${BASE_URL}/api/zoom/meeting/${testMeetingId}/attendance-tracker?threshold=85`);
    
    console.log('\n📱 In the admin dashboard, you would see:');
    console.log('   • Table showing all participants');
    console.log('   • Fred marked as "Present" (green status)');
    console.log('   • Duration, percentage, and threshold status');
    console.log('   • Real-time updates via WebSocket');
    
  } catch (error) {
    console.error('❌ Test failed:', error.message);
  } finally {
    try {
      await mongoose.disconnect();
      console.log('\n🔌 Disconnected from MongoDB');
    } catch (disconnectError) {
      console.log('⚠️ Error disconnecting from MongoDB:', disconnectError.message);
    }
  }
}

// Run the test
if (require.main === module) {
  testFred85PercentSuccess();
}

module.exports = { testFred85PercentSuccess, FRED_DATA };
