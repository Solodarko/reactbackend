const mongoose = require('mongoose');
const axios = require('axios');
require('dotenv').config();

// Test meeting creation for 85% attendance testing
async function createTestMeeting() {
  try {
    console.log('🚀 Creating test meeting for 85% attendance tracking...');
    
    const response = await axios.post('http://localhost:5000/api/simple-zoom/create-meeting', {
      topic: '85% Attendance Test Meeting',
      duration: 60, // 60 minutes for proper testing
      agenda: 'Testing the 85% attendance threshold functionality',
      settings: {
        host_video: true,
        participant_video: true,
        join_before_host: true,
        mute_upon_entry: false,
        waiting_room: false,
        auto_recording: 'none'
      }
    }, {
      headers: {
        'Content-Type': 'application/json'
      }
    });

    if (response.data.success) {
      const meeting = response.data.meeting;
      console.log('✅ Test meeting created successfully!');
      console.log('📋 Meeting Details:');
      console.log(`   Meeting ID: ${meeting.id}`);
      console.log(`   Topic: ${meeting.topic}`);
      console.log(`   Duration: ${meeting.duration} minutes`);
      console.log(`   Join URL: ${meeting.join_url}`);
      console.log(`   Start URL: ${meeting.start_url}`);
      
      console.log('\n🎯 Next Steps:');
      console.log('1. Check the Meeting Management dashboard to see the new meeting');
      console.log('2. Use the ZoomAttendanceDurationTracker to monitor 85% attendance');
      console.log('3. The test participants data (meeting ID: 84364369472) is ready for testing');
      
      return meeting;
    } else {
      throw new Error('Failed to create meeting: ' + response.data.message);
    }
  } catch (error) {
    console.error('❌ Error creating test meeting:', error.message);
    if (error.response?.data) {
      console.error('Response data:', error.response.data);
    }
    throw error;
  }
}

// Test the 85% attendance endpoint
async function testAttendanceEndpoint(meetingId = '84364369472') {
  try {
    console.log(`\n📊 Testing 85% attendance endpoint for meeting: ${meetingId}`);
    
    const response = await axios.get(`http://localhost:5000/api/attendance-tracker/zoom-duration-attendance/${meetingId}?threshold=85`);
    
    if (response.data.success) {
      const { participants, statistics } = response.data;
      
      console.log('✅ 85% Attendance Results:');
      console.log(`📈 Statistics:`);
      console.log(`   Total Participants: ${statistics.totalParticipants}`);
      console.log(`   Present (≥85%): ${statistics.presentCount}`);
      console.log(`   Absent (<85%): ${statistics.absentCount}`);
      console.log(`   In Progress: ${statistics.inProgressCount}`);
      console.log(`   Meeting Duration: ${statistics.meetingDuration} minutes`);
      console.log(`   Attendance Rate: ${statistics.attendanceRate || Math.round((statistics.presentCount / statistics.totalParticipants) * 100)}%`);
      
      console.log('\n👥 Participant Results:');
      participants.forEach((participant, index) => {
        const status = participant.attendanceStatus || participant.status;
        const percentage = participant.attendancePercentage || participant.percentage;
        const statusIcon = status === 'Present' ? '✅' : status === 'In Progress' ? '🔄' : '❌';
        
        console.log(`   ${index + 1}. ${participant.participantName}: ${percentage}% - ${status} ${statusIcon}`);
      });
      
      // Verify 85% threshold logic
      const correctResults = participants.every(p => {
        const percentage = p.attendancePercentage || p.percentage;
        const status = p.attendanceStatus || p.status;
        
        if (status === 'In Progress') return true; // In progress is always correct
        if (percentage >= 85 && status === 'Present') return true;
        if (percentage < 85 && status === 'Absent') return true;
        return false;
      });
      
      console.log(`\n🔍 85% Threshold Logic Verification: ${correctResults ? '✅ PASSED' : '❌ FAILED'}`);
      
      return { participants, statistics, correct: correctResults };
    } else {
      throw new Error('Failed to get attendance data: ' + response.data.message);
    }
  } catch (error) {
    console.error('❌ Error testing attendance endpoint:', error.message);
    if (error.response?.data) {
      console.error('Response data:', error.response.data);
    }
    throw error;
  }
}

// Main execution
async function main() {
  try {
    console.log('🧪 Starting 85% Attendance Test Suite\n');
    
    // Step 1: Create test meeting
    const meeting = await createTestMeeting();
    
    // Wait a moment for the meeting to be processed
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    // Step 2: Test the attendance endpoint with existing test data
    await testAttendanceEndpoint();
    
    console.log('\n🎉 85% Attendance Test Suite Completed Successfully!');
    console.log('\n📱 You can now:');
    console.log('   • Open the frontend application');
    console.log('   • Navigate to Admin Dashboard → Zoom Integration');
    console.log('   • Check the ZoomAttendanceDurationTracker component');
    console.log('   • Verify the 85% attendance calculations');
    
  } catch (error) {
    console.error('\n💥 Test suite failed:', error.message);
    process.exit(1);
  }
}

// Run if called directly
if (require.main === module) {
  main();
}

module.exports = { createTestMeeting, testAttendanceEndpoint };
