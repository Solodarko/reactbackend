const mongoose = require('mongoose');
const Participant = require('./models/Participant');
const Student = require('./models/Student');

// Connect to MongoDB
require('dotenv').config();

async function createTestParticipants() {
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('Connected to MongoDB');

    const meetingId = '84364369472';
    const meetingStartTime = new Date('2025-08-19T15:15:14.526Z');
    const now = new Date();

    // Test participants with different attendance scenarios
    const testParticipants = [
      // Participant 1: High attendance (90% - Present)
      {
        meetingId: meetingId,
        participantId: 'test_001',
        participantName: 'John Smith',
        email: 'john.smith@email.com',
        joinTime: new Date(meetingStartTime.getTime() + 2 * 60 * 1000), // Joined 2 minutes after start
        leaveTime: new Date(now.getTime() - 3 * 60 * 1000), // Left 3 minutes ago
        duration: 54, // 54 minutes out of 60 = 90%
        isActive: false,
        connectionStatus: 'in_meeting',
        userType: 'student',
        createdAt: new Date(meetingStartTime.getTime() + 2 * 60 * 1000)
      },
      // Participant 2: Excellent attendance (95% - Present)  
      {
        meetingId: meetingId,
        participantId: 'test_002', 
        participantName: 'Sarah Johnson',
        email: 'sarah.johnson@email.com',
        joinTime: meetingStartTime, // Joined at start
        leaveTime: new Date(now.getTime() - 1 * 60 * 1000), // Left 1 minute ago
        duration: 57, // 57 minutes out of 60 = 95%
        isActive: false,
        connectionStatus: 'left',
        userType: 'student',
        createdAt: meetingStartTime
      },
      // Participant 3: Low attendance (70% - Absent)
      {
        meetingId: meetingId,
        participantId: 'test_003',
        participantName: 'Mike Wilson', 
        email: 'mike.wilson@email.com',
        joinTime: new Date(meetingStartTime.getTime() + 5 * 60 * 1000), // Joined 5 minutes late
        leaveTime: new Date(meetingStartTime.getTime() + 47 * 60 * 1000), // Left early
        duration: 42, // 42 minutes out of 60 = 70%
        isActive: false,
        connectionStatus: 'left',
        userType: 'student',
        createdAt: new Date(meetingStartTime.getTime() + 5 * 60 * 1000)
      },
      // Participant 4: Currently in meeting (In Progress)
      {
        meetingId: meetingId,
        participantId: 'test_004',
        participantName: 'Emma Davis',
        email: 'emma.davis@email.com', 
        joinTime: new Date(meetingStartTime.getTime() + 3 * 60 * 1000), // Joined 3 minutes late
        leaveTime: null, // Still in meeting
        duration: null, // Will be calculated as current time
        isActive: true,
        connectionStatus: 'in_meeting',
        userType: 'student',
        createdAt: new Date(meetingStartTime.getTime() + 3 * 60 * 1000)
      },
      // Participant 5: Borderline attendance (85% exactly - Present)
      {
        meetingId: meetingId,
        participantId: 'test_005',
        participantName: 'Alex Brown',
        email: 'alex.brown@email.com',
        joinTime: new Date(meetingStartTime.getTime() + 1 * 60 * 1000), // Joined 1 minute late
        leaveTime: new Date(meetingStartTime.getTime() + 52 * 60 * 1000), // Attended 51 minutes
        duration: 51, // 51 minutes out of 60 = 85%
        isActive: false,
        connectionStatus: 'left',
        userType: 'student',
        createdAt: new Date(meetingStartTime.getTime() + 1 * 60 * 1000)
      }
    ];

    // Delete existing test participants for this meeting
    await Participant.deleteMany({ meetingId: meetingId });
    console.log('Cleared existing participants for meeting', meetingId);

    // Create test participants
    const createdParticipants = await Participant.insertMany(testParticipants);
    console.log(`Created ${createdParticipants.length} test participants:`);
    
    createdParticipants.forEach(p => {
      const duration = p.isActive ? 'In Progress' : `${p.duration} min`;
      const percentage = p.isActive ? 'Calculating...' : `${Math.round((p.duration / 60) * 100)}%`;
      console.log(`- ${p.participantName}: ${duration} (${percentage})`);
    });

    console.log('\n✅ Test participants created successfully!');
    console.log('📊 Expected 85% Attendance Results:');
    console.log('- John Smith (90%): Present ✅');
    console.log('- Sarah Johnson (95%): Present ✅');  
    console.log('- Mike Wilson (70%): Absent ❌');
    console.log('- Emma Davis (In Progress): In Progress 🔄');
    console.log('- Alex Brown (85%): Present ✅');

  } catch (error) {
    console.error('Error creating test participants:', error);
  } finally {
    await mongoose.connection.close();
    console.log('MongoDB connection closed');
  }
}

createTestParticipants();
