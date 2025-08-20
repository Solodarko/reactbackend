const mongoose = require('mongoose');
const ZoomMeeting = require('./models/ZoomMeeting');

// Connect to MongoDB
require('dotenv').config();

async function addTestMeetingToDatabase() {
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('🔗 Connected to MongoDB');

    const meetingData = {
      meetingId: '85233671814',
      meetingUuid: 'test-uuid-85233671814',
      topic: '85% Attendance Test Meeting',
      hostId: 'test_host',
      hostEmail: 'admin@school.edu',
      type: 1, // Instant meeting
      startTime: new Date('2025-08-20T01:09:00.000Z'),
      duration: 60,
      timezone: 'UTC',
      joinUrl: 'https://us05web.zoom.us/j/85233671814?pwd=r3x3bpmsinzJuxbhxRShmIiFFDs98W.1',
      startUrl: 'https://us05web.zoom.us/s/85233671814',
      status: 'started',
      actualStartTime: new Date('2025-08-20T01:09:00.000Z'),
      participants: [],
      settings: {
        hostVideo: true,
        participantVideo: true,
        joinBeforeHost: true,
        muteUponEntry: false,
        waitingRoom: false,
        autoRecording: 'none',
        approvalType: 0
      },
      metadata: {
        createdBy: 'test-script',
        purpose: '85% attendance threshold testing',
        tags: ['test', '85-percent', 'attendance-tracking']
      },
      totalParticipants: 6,
      activeParticipants: 1,
      createdAt: new Date('2025-08-20T01:09:00.000Z'),
      lastActivity: new Date()
    };

    // Check if meeting already exists
    const existingMeeting = await ZoomMeeting.findOne({ meetingId: '85233671814' });
    
    if (existingMeeting) {
      console.log('📝 Meeting already exists, updating...');
      await ZoomMeeting.updateOne(
        { meetingId: '85233671814' },
        { $set: meetingData }
      );
      console.log('✅ Test meeting updated in database');
    } else {
      console.log('➕ Creating new meeting record...');
      const zoomMeeting = new ZoomMeeting(meetingData);
      await zoomMeeting.save();
      console.log('✅ Test meeting added to database');
    }

    // Verify it was saved
    const savedMeeting = await ZoomMeeting.findOne({ meetingId: '85233671814' });
    if (savedMeeting) {
      console.log('\n📋 Meeting Details in Database:');
      console.log('Meeting ID:', savedMeeting.meetingId);
      console.log('Topic:', savedMeeting.topic);
      console.log('Status:', savedMeeting.status);
      console.log('Duration:', savedMeeting.duration, 'minutes');
      console.log('Total Participants:', savedMeeting.totalParticipants);
      console.log('Join URL:', savedMeeting.joinUrl);
      
      console.log('\n✅ Meeting should now appear in the frontend dropdown!');
      
      // Test the meetings API endpoint
      console.log('\n🧪 Testing meetings API...');
      const response = await fetch('http://localhost:5000/api/zoom/meetings');
      if (response.ok) {
        const data = await response.json();
        const ourMeeting = data.meetings?.find(m => m.meetingId === '85233671814' || m.id === '85233671814');
        if (ourMeeting) {
          console.log('✅ Meeting found in API response!');
        } else {
          console.log('⚠️ Meeting not found in API response');
        }
      }
      
    } else {
      console.log('❌ Failed to save meeting to database');
    }

  } catch (error) {
    console.error('❌ Error adding meeting to database:', error);
    throw error;
  } finally {
    await mongoose.connection.close();
    console.log('🔒 MongoDB connection closed');
  }
}

// Run if called directly
if (require.main === module) {
  addTestMeetingToDatabase()
    .then(() => {
      console.log('\n🎉 Test meeting setup completed!');
      console.log('\n📱 Next Steps:');
      console.log('1. Refresh your frontend application');
      console.log('2. Navigate to Admin Dashboard → Zoom Integration');
      console.log('3. Look for "ZoomAttendanceDurationTracker" component');
      console.log('4. Select meeting "85% Attendance Test Meeting" from dropdown');
      console.log('5. Verify the statistics show:');
      console.log('   - Total Participants: 6');
      console.log('   - Present (≥85%): 3');
      console.log('   - Absent (<85%): 3');
      console.log('   - Meeting Duration: 60 minutes');
    })
    .catch((error) => {
      console.error('💥 Failed to setup test meeting:', error);
      process.exit(1);
    });
}

module.exports = { addTestMeetingToDatabase };
