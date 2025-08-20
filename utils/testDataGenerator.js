const ZoomMeeting = require('../models/ZoomMeeting');
const Participant = require('../models/Participant');
const AttendanceSession = require('../models/AttendanceSession');

/**
 * Generate test data for Zoom attendance debugging
 */
const generateTestData = async () => {
  try {
    console.log('🧪 Generating test data for Zoom attendance...');

    // Create a test meeting
    const testMeeting = new ZoomMeeting({
      meetingId: 'TEST-MEETING-12345',
      meetingUuid: 'TEST-UUID-12345-ABCDEF',
      topic: 'Test Meeting for Attendance Debug',
      hostId: 'test-host-id',
      hostEmail: 'host@test.com',
      type: 2,
      status: 'ended',
      startTime: new Date(Date.now() - 90 * 60 * 1000), // 90 minutes ago
      actualStartTime: new Date(Date.now() - 85 * 60 * 1000), // 85 minutes ago
      endTime: new Date(Date.now() - 5 * 60 * 1000), // 5 minutes ago
      actualEndTime: new Date(Date.now() - 5 * 60 * 1000),
      duration: 90, // 90 minutes scheduled
      actualDuration: 80, // 80 minutes actual
      joinUrl: 'https://zoom.us/j/test-meeting-12345',
      startUrl: 'https://zoom.us/s/test-meeting-12345',
      attendanceGenerated: true,
      attendanceGeneratedAt: new Date(),
      reportGenerated: true,
      reportGeneratedAt: new Date()
    });

    await testMeeting.save();
    console.log('✅ Created test meeting:', testMeeting.meetingId);

    // Create test participants with varying attendance patterns
    const testParticipants = [
      {
        participantName: 'John Doe',
        participantId: 'participant-001',
        email: 'john.doe@test.com',
        meetingId: testMeeting.meetingId,
        joinTime: new Date(Date.now() - 80 * 60 * 1000), // Joined 80 min ago
        leaveTime: new Date(Date.now() - 10 * 60 * 1000), // Left 10 min ago
        duration: 70, // 70 minutes = 87.5% attendance
        attendanceStatus: 'Present',
        isActive: false,
        studentFirstName: 'John',
        studentLastName: 'Doe',
        studentId: 1001,
        studentEmail: 'john.doe@student.edu',
        studentDepartment: 'Computer Science'
      },
      {
        participantName: 'Jane Smith',
        participantId: 'participant-002',
        email: 'jane.smith@test.com',
        meetingId: testMeeting.meetingId,
        joinTime: new Date(Date.now() - 75 * 60 * 1000), // Joined 75 min ago
        leaveTime: new Date(Date.now() - 15 * 60 * 1000), // Left 15 min ago
        duration: 60, // 60 minutes = 75% attendance
        attendanceStatus: 'Partial',
        isActive: false,
        studentFirstName: 'Jane',
        studentLastName: 'Smith',
        studentId: 1002,
        studentEmail: 'jane.smith@student.edu',
        studentDepartment: 'Mathematics'
      },
      {
        participantName: 'Bob Wilson',
        participantId: 'participant-003',
        email: 'bob.wilson@test.com',
        meetingId: testMeeting.meetingId,
        joinTime: new Date(Date.now() - 25 * 60 * 1000), // Joined 25 min ago
        leaveTime: new Date(Date.now() - 20 * 60 * 1000), // Left 20 min ago
        duration: 5, // 5 minutes = 6.25% attendance
        attendanceStatus: 'Absent',
        isActive: false,
        studentFirstName: 'Bob',
        studentLastName: 'Wilson',
        studentId: 1003,
        studentEmail: 'bob.wilson@student.edu',
        studentDepartment: 'Physics'
      },
      {
        participantName: 'Alice Johnson',
        participantId: 'participant-004',
        email: 'alice.johnson@test.com',
        meetingId: testMeeting.meetingId,
        joinTime: new Date(Date.now() - 78 * 60 * 1000), // Joined 78 min ago
        leaveTime: null, // Still in meeting
        duration: 73, // 73+ minutes = 91%+ attendance
        attendanceStatus: 'In Progress',
        isActive: true,
        studentFirstName: 'Alice',
        studentLastName: 'Johnson',
        studentId: 1004,
        studentEmail: 'alice.johnson@student.edu',
        studentDepartment: 'Biology'
      }
    ];

    const participants = await Participant.insertMany(testParticipants);
    console.log(`✅ Created ${participants.length} test participants`);

    // Create attendance sessions for participants with multiple join/leave cycles
    const attendanceSessions = [];

    // John Doe - single session (good attendance)
    attendanceSessions.push({
      participantId: participants[0]._id,
      meetingId: testMeeting.meetingId,
      joinTime: new Date(Date.now() - 80 * 60 * 1000),
      leaveTime: new Date(Date.now() - 10 * 60 * 1000),
      duration: 70,
      isActive: false,
      sessionType: 'regular'
    });

    // Jane Smith - two sessions (moderate attendance)
    attendanceSessions.push({
      participantId: participants[1]._id,
      meetingId: testMeeting.meetingId,
      joinTime: new Date(Date.now() - 75 * 60 * 1000),
      leaveTime: new Date(Date.now() - 50 * 60 * 1000),
      duration: 25,
      isActive: false,
      sessionType: 'regular'
    });
    attendanceSessions.push({
      participantId: participants[1]._id,
      meetingId: testMeeting.meetingId,
      joinTime: new Date(Date.now() - 40 * 60 * 1000),
      leaveTime: new Date(Date.now() - 15 * 60 * 1000),
      duration: 25,
      isActive: false,
      sessionType: 'reconnection'
    });

    // Bob Wilson - single short session (poor attendance)
    attendanceSessions.push({
      participantId: participants[2]._id,
      meetingId: testMeeting.meetingId,
      joinTime: new Date(Date.now() - 25 * 60 * 1000),
      leaveTime: new Date(Date.now() - 20 * 60 * 1000),
      duration: 5,
      isActive: false,
      sessionType: 'regular'
    });

    // Alice Johnson - ongoing session (excellent attendance)
    attendanceSessions.push({
      participantId: participants[3]._id,
      meetingId: testMeeting.meetingId,
      joinTime: new Date(Date.now() - 78 * 60 * 1000),
      leaveTime: null,
      duration: null, // Will be calculated
      isActive: true,
      sessionType: 'regular'
    });

    const sessions = await AttendanceSession.insertMany(attendanceSessions);
    console.log(`✅ Created ${sessions.length} attendance sessions`);

    console.log('🎉 Test data generation completed!');
    console.log(`📊 Test Meeting ID: ${testMeeting.meetingId}`);
    console.log(`👥 Participants: ${participants.length}`);
    console.log(`⏱️  Sessions: ${sessions.length}`);
    
    return {
      meeting: testMeeting,
      participants,
      sessions
    };

  } catch (error) {
    console.error('❌ Error generating test data:', error);
    throw error;
  }
};

/**
 * Generate test data for a specific meeting ID
 * @param {string} meetingId - The meeting ID to generate data for
 */
const generateTestDataForMeeting = async (meetingId) => {
  try {
    console.log(`🧪 Generating test data for meeting ID: ${meetingId}`);
    
    // Clean up any existing test data for this meeting
    await AttendanceSession.deleteMany({ meetingId });
    await Participant.deleteMany({ meetingId });

    // Create test participants with varying attendance patterns
    const testParticipants = [
      {
        participantName: 'John Doe',
        participantId: 'participant-001',
        email: 'john.doe@test.com',
        meetingId: meetingId,
        joinTime: new Date(Date.now() - 80 * 60 * 1000), // Joined 80 min ago
        leaveTime: new Date(Date.now() - 10 * 60 * 1000), // Left 10 min ago
        duration: 70, // 70 minutes = 117% attendance (for 60min meeting)
        attendanceStatus: 'Present',
        isActive: false,
        studentFirstName: 'John',
        studentLastName: 'Doe',
        studentId: 1001,
        studentEmail: 'john.doe@student.edu',
        studentDepartment: 'Computer Science',
        lastActivity: new Date()
      },
      {
        participantName: 'Jane Smith',
        participantId: 'participant-002',
        email: 'jane.smith@test.com',
        meetingId: meetingId,
        joinTime: new Date(Date.now() - 75 * 60 * 1000), // Joined 75 min ago
        leaveTime: new Date(Date.now() - 15 * 60 * 1000), // Left 15 min ago
        duration: 60, // 60 minutes = 100% attendance
        attendanceStatus: 'Present',
        isActive: false,
        studentFirstName: 'Jane',
        studentLastName: 'Smith',
        studentId: 1002,
        studentEmail: 'jane.smith@student.edu',
        studentDepartment: 'Mathematics',
        lastActivity: new Date()
      },
      {
        participantName: 'Bob Wilson',
        participantId: 'participant-003',
        email: 'bob.wilson@test.com',
        meetingId: meetingId,
        joinTime: new Date(Date.now() - 25 * 60 * 1000), // Joined 25 min ago
        leaveTime: new Date(Date.now() - 20 * 60 * 1000), // Left 20 min ago
        duration: 5, // 5 minutes = 8% attendance
        attendanceStatus: 'Absent',
        isActive: false,
        studentFirstName: 'Bob',
        studentLastName: 'Wilson',
        studentId: 1003,
        studentEmail: 'bob.wilson@student.edu',
        studentDepartment: 'Physics',
        lastActivity: new Date()
      },
      {
        participantName: 'Alice Johnson',
        participantId: 'participant-004',
        email: 'alice.johnson@test.com',
        meetingId: meetingId,
        joinTime: new Date(Date.now() - 78 * 60 * 1000), // Joined 78 min ago
        leaveTime: null, // Still in meeting
        duration: 73, // 73+ minutes = 122%+ attendance
        attendanceStatus: 'In Progress',
        isActive: true,
        studentFirstName: 'Alice',
        studentLastName: 'Johnson',
        studentId: 1004,
        studentEmail: 'alice.johnson@student.edu',
        studentDepartment: 'Biology',
        lastActivity: new Date()
      },
      {
        participantName: 'Charlie Brown',
        participantId: 'participant-005',
        email: 'charlie.brown@test.com',
        meetingId: meetingId,
        joinTime: new Date(Date.now() - 50 * 60 * 1000), // Joined 50 min ago
        leaveTime: new Date(Date.now() - 5 * 60 * 1000), // Left 5 min ago
        duration: 45, // 45 minutes = 75% attendance
        attendanceStatus: 'Absent', // Under 85% threshold
        isActive: false,
        studentFirstName: 'Charlie',
        studentLastName: 'Brown',
        studentId: 1005,
        studentEmail: 'charlie.brown@student.edu',
        studentDepartment: 'Chemistry',
        lastActivity: new Date()
      }
    ];

    const participants = await Participant.insertMany(testParticipants);
    console.log(`✅ Created ${participants.length} test participants for meeting ${meetingId}`);
    
    return {
      meetingId,
      participants,
      participantCount: participants.length
    };

  } catch (error) {
    console.error('❌ Error generating test data for meeting:', error);
    throw error;
  }
};

/**
 * Clean up test data
 */
const cleanupTestData = async () => {
  try {
    console.log('🧹 Cleaning up test data...');
    
    await AttendanceSession.deleteMany({ meetingId: 'TEST-MEETING-12345' });
    await Participant.deleteMany({ meetingId: 'TEST-MEETING-12345' });
    await ZoomMeeting.deleteMany({ meetingId: 'TEST-MEETING-12345' });
    
    console.log('✅ Test data cleanup completed');
  } catch (error) {
    console.error('❌ Error cleaning up test data:', error);
    throw error;
  }
};

module.exports = {
  generateTestData,
  generateTestDataForMeeting,
  cleanupTestData
};
