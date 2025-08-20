const mongoose = require('mongoose');
const Participant = require('./models/Participant');
const Student = require('./models/Student');

// Connect to MongoDB
require('dotenv').config();

async function createTestParticipantsForNewMeeting() {
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('🔗 Connected to MongoDB');

    const newMeetingId = '85233671814'; // The meeting we just created
    const meetingStartTime = new Date();
    const meetingDuration = 60; // 60 minutes
    const now = new Date(meetingStartTime.getTime() + meetingDuration * 60 * 1000);

    // Create diverse test participants to thoroughly test 85% threshold
    const testParticipants = [
      // Participant 1: Exactly 85% attendance (threshold case)
      {
        meetingId: newMeetingId,
        participantId: 'test_85_001',
        participantName: 'Alice Johnson',
        email: 'alice.johnson@school.edu',
        joinTime: new Date(meetingStartTime.getTime() + 2 * 60 * 1000), // Joined 2 minutes late
        leaveTime: new Date(meetingStartTime.getTime() + 53 * 60 * 1000), // Attended 51 minutes
        duration: 51, // 51 minutes out of 60 = 85%
        isActive: false,
        connectionStatus: 'left',
        userType: 'student',
        createdAt: new Date(meetingStartTime.getTime() + 2 * 60 * 1000)
      },
      
      // Participant 2: Just above 85% (86%)
      {
        meetingId: newMeetingId,
        participantId: 'test_85_002',
        participantName: 'Bob Smith',
        email: 'bob.smith@school.edu',
        joinTime: meetingStartTime, // Joined on time
        leaveTime: new Date(meetingStartTime.getTime() + 52 * 60 * 1000), // Attended 52 minutes
        duration: 52, // 52 minutes out of 60 = 86%
        isActive: false,
        connectionStatus: 'left',
        userType: 'student',
        createdAt: meetingStartTime
      },
      
      // Participant 3: Just below 85% (84%)
      {
        meetingId: newMeetingId,
        participantId: 'test_85_003',
        participantName: 'Carol Davis',
        email: 'carol.davis@school.edu',
        joinTime: new Date(meetingStartTime.getTime() + 3 * 60 * 1000), // Joined 3 minutes late
        leaveTime: new Date(meetingStartTime.getTime() + 53 * 60 * 1000), // Attended 50 minutes
        duration: 50, // 50 minutes out of 60 = 83.33% (rounds to 83%)
        isActive: false,
        connectionStatus: 'left',
        userType: 'student',
        createdAt: new Date(meetingStartTime.getTime() + 3 * 60 * 1000)
      },
      
      // Participant 4: High attendance (95%)
      {
        meetingId: newMeetingId,
        participantId: 'test_85_004',
        participantName: 'David Wilson',
        email: 'david.wilson@school.edu',
        joinTime: meetingStartTime,
        leaveTime: new Date(meetingStartTime.getTime() + 57 * 60 * 1000), // Attended 57 minutes
        duration: 57, // 57 minutes out of 60 = 95%
        isActive: false,
        connectionStatus: 'left',
        userType: 'student',
        createdAt: meetingStartTime
      },
      
      // Participant 5: Low attendance (60%)
      {
        meetingId: newMeetingId,
        participantId: 'test_85_005',
        participantName: 'Eva Brown',
        email: 'eva.brown@school.edu',
        joinTime: new Date(meetingStartTime.getTime() + 10 * 60 * 1000), // Joined 10 minutes late
        leaveTime: new Date(meetingStartTime.getTime() + 46 * 60 * 1000), // Attended 36 minutes
        duration: 36, // 36 minutes out of 60 = 60%
        isActive: false,
        connectionStatus: 'left',
        userType: 'student',
        createdAt: new Date(meetingStartTime.getTime() + 10 * 60 * 1000)
      },
      
      // Participant 6: Currently in meeting (still active)
      {
        meetingId: newMeetingId,
        participantId: 'test_85_006',
        participantName: 'Frank Miller',
        email: 'frank.miller@school.edu',
        joinTime: new Date(meetingStartTime.getTime() + 5 * 60 * 1000), // Joined 5 minutes late
        leaveTime: null, // Still in meeting
        duration: null, // Will be calculated as current duration
        isActive: true,
        connectionStatus: 'in_meeting',
        userType: 'student',
        createdAt: new Date(meetingStartTime.getTime() + 5 * 60 * 1000)
      }
    ];

    // Delete existing test participants for this meeting
    await Participant.deleteMany({ meetingId: newMeetingId });
    console.log(`🗑️ Cleared existing participants for meeting ${newMeetingId}`);

    // Create test participants
    const createdParticipants = await Participant.insertMany(testParticipants);
    console.log(`✅ Created ${createdParticipants.length} test participants for meeting ${newMeetingId}:`);
    
    createdParticipants.forEach((p, index) => {
      const duration = p.isActive ? 'In Progress' : `${p.duration} min`;
      const percentage = p.isActive ? 'Calculating...' : `${Math.round((p.duration / 60) * 100)}%`;
      const expectedStatus = p.isActive ? 'In Progress' : (p.duration >= 51 ? 'Present' : 'Absent');
      console.log(`   ${index + 1}. ${p.participantName}: ${duration} (${percentage}) - Expected: ${expectedStatus}`);
    });

    console.log('\n📊 Expected 85% Attendance Results for meeting', newMeetingId, ':');
    console.log('   - Alice Johnson (85%): Present ✅ (threshold case)');
    console.log('   - Bob Smith (86%): Present ✅');  
    console.log('   - Carol Davis (83%): Absent ❌');
    console.log('   - David Wilson (95%): Present ✅');
    console.log('   - Eva Brown (60%): Absent ❌');
    console.log('   - Frank Miller (In Progress): In Progress 🔄');
    
    console.log('\n🎯 Test Summary:');
    console.log('   - 3 participants should be marked as Present (≥85%)');
    console.log('   - 2 participants should be marked as Absent (<85%)');
    console.log('   - 1 participant should be marked as In Progress');

    return {
      meetingId: newMeetingId,
      participants: createdParticipants,
      expectedResults: {
        present: 3,
        absent: 2,
        inProgress: 1,
        total: 6
      }
    };

  } catch (error) {
    console.error('❌ Error creating test participants:', error);
    throw error;
  } finally {
    await mongoose.connection.close();
    console.log('🔒 MongoDB connection closed');
  }
}

// Run if called directly
if (require.main === module) {
  createTestParticipantsForNewMeeting()
    .then((result) => {
      console.log('\n🎉 Test participants created successfully!');
      console.log(`📋 Meeting ID: ${result.meetingId}`);
      console.log('🧪 You can now test the 85% attendance endpoint with this meeting ID.');
    })
    .catch((error) => {
      console.error('💥 Failed to create test participants:', error);
      process.exit(1);
    });
}

module.exports = { createTestParticipantsForNewMeeting };
