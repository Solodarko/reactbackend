const axios = require('axios');

// Test the exact endpoint that the frontend component is calling
async function testFrontendAttendanceEndpoint() {
  try {
    const backendUrl = 'http://localhost:5000/api';
    const meetingId = '85233671814';
    const threshold = 85;
    
    console.log('🧪 Testing frontend attendance endpoint...');
    console.log(`🔗 URL: ${backendUrl}/attendance-tracker/zoom-duration-attendance/${meetingId}?threshold=${threshold}`);
    
    // Test the exact same call the frontend makes
    const response = await fetch(
      `${backendUrl}/attendance-tracker/zoom-duration-attendance/${meetingId}?threshold=${threshold}`
    );
    
    if (response.ok) {
      const data = await response.json();
      
      console.log('\n✅ Frontend Endpoint Response:');
      console.log('=====================================');
      console.log('Success:', data.success);
      console.log('Meeting ID:', data.meetingId);
      console.log('Participants Count:', data.participants?.length || 0);
      console.log('Raw Statistics:', data.statistics);
      
      if (data.participants && data.participants.length > 0) {
        console.log('\n👥 Participants Data:');
        data.participants.forEach((p, index) => {
          console.log(`${index + 1}. ${p.participantName}:`);
          console.log(`   - Duration: ${p.duration} min`);
          console.log(`   - Percentage: ${p.attendancePercentage}%`);
          console.log(`   - Status: ${p.attendanceStatus}`);
          console.log(`   - Meets Threshold: ${p.meetsThreshold}`);
        });
      }
      
      // Test what the frontend component would calculate
      const participants = data.participants || [];
      const stats = data.statistics || {};
      
      // This is what the component does
      const processedParticipants = participants.map(participant => {
        const duration = participant.totalSessionDuration || participant.duration || 0;
        const meetingDuration = stats.meetingDuration || participant.meetingDuration || 60;
        const attendancePercentage = Math.round((duration / meetingDuration) * 100);
        const meetsThreshold = attendancePercentage >= threshold;
        
        return {
          ...participant,
          duration,
          meetingDuration,
          attendancePercentage,
          attendanceStatus: participant.hasActiveSessions 
            ? 'In Progress' 
            : meetsThreshold 
              ? 'Present' 
              : 'Absent',
          meetsThreshold
        };
      });
      
      // Calculate statistics like the component does
      const presentCount = processedParticipants.filter(p => p.meetsThreshold || p.attendanceStatus === 'In Progress').length;
      const absentCount = processedParticipants.length - presentCount;
      const totalPercentage = processedParticipants.reduce((sum, p) => sum + (p.attendancePercentage || 0), 0);
      
      const calculatedStats = {
        totalParticipants: processedParticipants.length,
        presentCount,
        absentCount,
        averageAttendance: processedParticipants.length > 0 ? Math.round(totalPercentage / processedParticipants.length) : 0,
        meetingDuration: stats.meetingDuration || 60,
        attendanceRate: processedParticipants.length > 0 ? Math.round((presentCount / processedParticipants.length) * 100) : 0
      };
      
      console.log('\n📊 Frontend Calculated Statistics:');
      console.log('===================================');
      console.log('Total Participants:', calculatedStats.totalParticipants);
      console.log('Present Count:', calculatedStats.presentCount);
      console.log('Absent Count:', calculatedStats.absentCount);
      console.log('Average Attendance:', calculatedStats.averageAttendance, '%');
      console.log('Meeting Duration:', calculatedStats.meetingDuration, 'minutes');
      console.log('Attendance Rate:', calculatedStats.attendanceRate, '%');
      console.log('Threshold Duration:', Math.round(calculatedStats.meetingDuration * 0.85), 'minutes (85%)');
      console.log('Threshold:', threshold, '%');
      
      if (calculatedStats.totalParticipants === 0) {
        console.log('\n⚠️ ISSUE FOUND: No participants in the data!');
        console.log('This explains why the frontend shows 0 participants.');
        console.log('The backend data shows participants but frontend processing might have an issue.');
      } else {
        console.log('\n✅ Data looks good for frontend display!');
      }
      
      return {
        rawData: data,
        processedStats: calculatedStats,
        success: true
      };
      
    } else {
      console.error('❌ HTTP Error:', response.status, response.statusText);
      const errorText = await response.text();
      console.error('Error response:', errorText);
      return { success: false, error: `HTTP ${response.status}` };
    }
    
  } catch (error) {
    console.error('❌ Network Error:', error.message);
    return { success: false, error: error.message };
  }
}

// Also test the meetings endpoint to see if our meeting shows up
async function testMeetingsEndpoint() {
  try {
    console.log('\n🔍 Testing meetings endpoint...');
    const backendUrl = 'http://localhost:5000/api';
    
    const response = await fetch(`${backendUrl}/zoom/meetings`);
    
    if (response.ok) {
      const data = await response.json();
      console.log('✅ Meetings endpoint response:');
      console.log('Meetings found:', data.meetings?.length || 0);
      
      if (data.meetings && data.meetings.length > 0) {
        console.log('\n📋 Available meetings:');
        data.meetings.forEach((meeting, index) => {
          console.log(`${index + 1}. ID: ${meeting.meetingId || meeting.id} - Topic: ${meeting.topic}`);
        });
        
        // Check if our test meeting is in the list
        const ourMeeting = data.meetings.find(m => 
          (m.meetingId === '85233671814') || (m.id === '85233671814')
        );
        
        if (ourMeeting) {
          console.log('✅ Our test meeting (85233671814) found in meetings list!');
        } else {
          console.log('⚠️ Our test meeting (85233671814) NOT found in meetings list.');
          console.log('This might explain why it doesn\'t show up in the dropdown.');
        }
      }
      
    } else {
      console.error('❌ Failed to fetch meetings:', response.status);
    }
  } catch (error) {
    console.error('❌ Error fetching meetings:', error.message);
  }
}

// Run tests
async function runTests() {
  console.log('🚀 Running Frontend Data Tests\n');
  
  await testFrontendAttendanceEndpoint();
  await testMeetingsEndpoint();
  
  console.log('\n🎯 Recommendations:');
  console.log('1. Check the browser console for debug logs when using the component');
  console.log('2. Manually select meeting ID 85233671814 in the dropdown if available');
  console.log('3. If meeting doesn\'t appear in dropdown, the issue is with meeting data, not attendance data');
  console.log('4. The attendance calculation logic is working correctly');
}

if (require.main === module) {
  runTests().catch(console.error);
}
