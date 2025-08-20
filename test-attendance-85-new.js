const axios = require('axios');

// Test the 85% attendance endpoint with our new meeting
async function testNewMeetingAttendance() {
  try {
    const meetingId = '85233671814';
    console.log('🧪 Testing 85% attendance tracking for meeting:', meetingId);
    console.log('🔗 API URL: http://localhost:5000/api/attendance-tracker/zoom-duration-attendance/' + meetingId + '?threshold=85');
    
    const response = await axios.get(`http://localhost:5000/api/attendance-tracker/zoom-duration-attendance/${meetingId}?threshold=85`);
    
    if (response.data.success) {
      const { participants, statistics } = response.data;
      
      console.log('\n✅ 85% Attendance Test Results:');
      console.log('==========================================');
      
      console.log('\n📊 Meeting Statistics:');
      console.log(`   Total Participants: ${statistics.totalParticipants}`);
      console.log(`   Present (≥85%): ${statistics.presentCount}`);
      console.log(`   Absent (<85%): ${statistics.absentCount}`);
      console.log(`   In Progress: ${statistics.inProgressCount}`);
      console.log(`   Meeting Duration: ${statistics.meetingDuration} minutes`);
      console.log(`   Threshold Required: ${statistics.thresholdDuration || Math.round(statistics.meetingDuration * 0.85)} minutes (85%)`);
      
      console.log('\n👥 Individual Participant Results:');
      console.log('------------------------------------------');
      
      participants.forEach((participant, index) => {
        const status = participant.attendanceStatus || participant.status;
        const percentage = participant.attendancePercentage || participant.percentage;
        const duration = participant.duration || participant.totalSessionDuration || 0;
        
        let statusIcon = '❓';
        let statusColor = '';
        
        switch (status) {
          case 'Present':
            statusIcon = '✅';
            statusColor = '\x1b[32m'; // Green
            break;
          case 'Absent':
            statusIcon = '❌';
            statusColor = '\x1b[31m'; // Red
            break;
          case 'In Progress':
            statusIcon = '🔄';
            statusColor = '\x1b[33m'; // Yellow
            break;
          default:
            statusIcon = '❓';
            statusColor = '\x1b[37m'; // White
        }
        
        console.log(`   ${index + 1}. ${participant.participantName}:`);
        console.log(`      Duration: ${duration} minutes`);
        console.log(`      Percentage: ${percentage}%`);
        console.log(`      Status: ${statusColor}${status} ${statusIcon}\x1b[0m`);
        console.log(`      Meets 85% Threshold: ${percentage >= 85 || status === 'In Progress' ? '✅ YES' : '❌ NO'}`);
        console.log('');
      });
      
      // Verify the logic is working correctly
      console.log('\n🔍 Verification Results:');
      console.log('========================');
      
      const expectedResults = {
        'Alice Johnson': { percentage: 85, status: 'Present' },
        'Bob Smith': { percentage: 87, status: 'Present' }, 
        'Carol Davis': { percentage: 83, status: 'Absent' },
        'David Wilson': { percentage: 95, status: 'Present' },
        'Eva Brown': { percentage: 60, status: 'Absent' },
        'Frank Miller': { percentage: null, status: 'In Progress' }
      };
      
      let allCorrect = true;
      const results = [];
      
      participants.forEach(participant => {
        const name = participant.participantName;
        const actualPercentage = participant.attendancePercentage || participant.percentage;
        const actualStatus = participant.attendanceStatus || participant.status;
        const expected = expectedResults[name];
        
        if (expected) {
          const percentageMatch = expected.percentage === null || Math.abs(actualPercentage - expected.percentage) <= 1; // Allow 1% tolerance
          const statusMatch = actualStatus === expected.status;
          const correct = percentageMatch && statusMatch;
          
          results.push({
            name,
            expected: expected.status,
            actual: actualStatus,
            correct,
            actualPercentage,
            expectedPercentage: expected.percentage
          });
          
          if (!correct) allCorrect = false;
          
          console.log(`   ${name}: ${correct ? '✅' : '❌'} ${actualStatus} (${actualPercentage || 'N/A'}%)`);
        }
      });
      
      console.log('\n🎯 Overall Test Result:');
      console.log(`   ${allCorrect ? '✅ PASSED' : '❌ FAILED'} - 85% Attendance Logic Working ${allCorrect ? 'Correctly' : 'Incorrectly'}`);
      
      if (allCorrect) {
        console.log('\n🎉 Success! The 85% attendance threshold is working perfectly!');
        console.log('   - Participants with ≥85% attendance are marked as "Present"');
        console.log('   - Participants with <85% attendance are marked as "Absent"');
        console.log('   - Active participants are marked as "In Progress"');
      } else {
        console.log('\n⚠️ Issues found with the 85% attendance logic:');
        results.filter(r => !r.correct).forEach(r => {
          console.log(`   - ${r.name}: Expected ${r.expected}, got ${r.actual}`);
        });
      }
      
      console.log('\n📱 Frontend Testing:');
      console.log('====================');
      console.log('To test this in the frontend application:');
      console.log('1. Open your browser and go to the frontend application');
      console.log('2. Navigate to Admin Dashboard → Zoom Integration');
      console.log('3. Look for the ZoomAttendanceDurationTracker component');
      console.log(`4. Select meeting ID: ${meetingId}`);
      console.log('5. Verify the 85% attendance calculations match these results');
      
      return {
        success: true,
        meetingId,
        participants,
        statistics,
        testPassed: allCorrect,
        results
      };
      
    } else {
      throw new Error('API call failed: ' + response.data.message);
    }
    
  } catch (error) {
    console.error('❌ Error testing attendance endpoint:', error.message);
    if (error.response?.data) {
      console.error('Response data:', JSON.stringify(error.response.data, null, 2));
    }
    throw error;
  }
}

// Run the test
if (require.main === module) {
  testNewMeetingAttendance()
    .then((result) => {
      console.log('\n✨ Test completed successfully!');
      if (result.testPassed) {
        process.exit(0);
      } else {
        process.exit(1);
      }
    })
    .catch((error) => {
      console.error('\n💥 Test failed:', error.message);
      process.exit(1);
    });
}

module.exports = { testNewMeetingAttendance };
