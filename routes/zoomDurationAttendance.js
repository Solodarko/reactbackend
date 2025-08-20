const express = require('express');
const mongoose = require('mongoose');
const Participant = require('../models/Participant');
const AttendanceSession = require('../models/AttendanceSession');
const ZoomMeeting = require('../models/ZoomMeeting');
const { 
  calculateTotalSessionDuration,
  calculateMeetingDurationFromInfo,
  calculateSessionBasedAttendancePercentage,
  determineSessionBasedAttendanceStatus
} = require('../utils/attendanceUtils');

const router = express.Router();

/**
 * GET /api/attendance-tracker/health - Simple health check endpoint
 */
router.get('/health', (req, res) => {
  res.json({
    success: true,
    message: 'Zoom Duration Attendance API is running',
    timestamp: new Date().toISOString(),
    endpoints: [
      '/zoom-duration-attendance/:meetingId',
      '/zoom-meetings-with-attendance', 
      '/zoom-attendance-summary',
      '/generate-test-data',
      '/cleanup-test-data'
    ]
  });
});

/**
 * GET /api/attendance-tracker/zoom-duration-attendance/:meetingId
 * Get Zoom meeting attendance data filtered by duration threshold
 */
router.get('/zoom-duration-attendance/:meetingId', async (req, res) => {
  try {
    const { meetingId } = req.params;
    const { threshold = 85 } = req.query;
    const attendanceThreshold = parseFloat(threshold);

    if (!meetingId) {
      return res.status(400).json({
        success: false,
        error: 'Meeting ID is required',
        timestamp: new Date().toISOString()
      });
    }

    // Get meeting information first
    let meetingInfo = {};
    try {
      // Try to find meeting in ZoomMeeting collection
      const zoomMeeting = await ZoomMeeting.findOne({ meetingId: meetingId.toString() });
      if (zoomMeeting) {
        meetingInfo = {
          meetingId: zoomMeeting.meetingId,
          topic: zoomMeeting.topic,
          startTime: zoomMeeting.startTime,
          endTime: zoomMeeting.endTime,
          duration: zoomMeeting.duration || zoomMeeting.actualDuration,
          status: zoomMeeting.status
        };
      }
    } catch (meetingError) {
      console.warn('Could not fetch meeting details:', meetingError.message);
    }

    // Get all participants for this meeting
    const participants = await Participant.find({ meetingId: meetingId.toString() })
      .populate('studentId', 'FirstName LastName Email Department StudentID')
      .lean();

    if (!participants || participants.length === 0) {
      return res.json({
        success: true,
        meetingId,
        participants: [],
        statistics: {
          totalParticipants: 0,
          presentCount: 0,
          absentCount: 0,
          averageAttendance: 0,
          meetingDuration: meetingInfo.duration || 60,
          attendanceRate: 0
        },
        threshold: attendanceThreshold,
        timestamp: new Date().toISOString()
      });
    }

    // Get attendance sessions for each participant
    const participantIds = participants.map(p => p._id);
    const sessions = await AttendanceSession.find({
      participantId: { $in: participantIds },
      meetingId: meetingId.toString()
    }).lean();

    // Group sessions by participant
    const sessionsByParticipant = {};
    sessions.forEach(session => {
      const participantId = session.participantId.toString();
      if (!sessionsByParticipant[participantId]) {
        sessionsByParticipant[participantId] = [];
      }
      sessionsByParticipant[participantId].push(session);
    });

    // Calculate meeting duration
    const meetingDuration = calculateMeetingDurationFromInfo(meetingInfo) || 60;

    // Process each participant with duration-based calculations
    const processedParticipants = participants.map(participant => {
      const participantId = participant._id.toString();
      const participantSessions = sessionsByParticipant[participantId] || [];
      
      // Calculate total duration across all sessions
      let totalSessionDuration = 0;
      let hasActiveSessions = false;

      if (participantSessions.length > 0) {
        totalSessionDuration = calculateTotalSessionDuration(participantSessions);
        hasActiveSessions = participantSessions.some(s => s.isActive);
      } else if (participant.duration) {
        // Fallback to participant's recorded duration
        totalSessionDuration = participant.duration;
        hasActiveSessions = participant.isActive;
      }
      
      // Log participant processing for debugging
      console.log(`Processing participant: ${participant.participantName}`);
      console.log(`- Sessions found: ${participantSessions.length}`);
      console.log(`- Total duration: ${totalSessionDuration}`);
      console.log(`- Has active sessions: ${hasActiveSessions}`);
      console.log(`- Raw duration: ${participant.duration}`);
      console.log('---');

      // Calculate attendance percentage based on session duration
      const attendancePercentage = calculateSessionBasedAttendancePercentage(
        totalSessionDuration,
        meetingDuration,
        hasActiveSessions
      );

      // Determine status based on 85% threshold
      const attendanceStatus = determineSessionBasedAttendanceStatus(
        attendancePercentage,
        hasActiveSessions,
        totalSessionDuration,
        attendanceThreshold
      );

      // Check if participant meets the threshold
      const meetsThreshold = attendancePercentage >= attendanceThreshold;

      return {
        participantId: participant.participantId,
        participantName: participant.participantName,
        email: participant.email,
        joinTime: participant.joinTime,
        leaveTime: participant.leaveTime,
        duration: totalSessionDuration,
        totalSessionDuration,
        meetingDuration,
        attendancePercentage: Math.round(attendancePercentage),
        attendanceStatus,
        isActive: hasActiveSessions,
        hasActiveSessions,
        meetsThreshold,
        sessionCount: participantSessions.length,
        
        // Student information if linked
        studentId: participant.studentId?.StudentID || participant.studentId,
        studentFirstName: participant.studentFirstName || participant.studentId?.FirstName,
        studentLastName: participant.studentLastName || participant.studentId?.LastName,
        studentEmail: participant.studentEmail || participant.studentId?.Email,
        studentDepartment: participant.studentDepartment || participant.studentId?.Department,
        
        // Connection details
        connectionStatus: participant.connectionStatus,
        userType: participant.userType,
        device: participant.device,
        lastActivity: participant.lastActivity
      };
    });

    // Calculate statistics
    const presentCount = processedParticipants.filter(p => 
      p.meetsThreshold || p.attendanceStatus === 'In Progress'
    ).length;
    
    const absentCount = processedParticipants.length - presentCount;
    
    const totalAttendancePercentage = processedParticipants.reduce((sum, p) => 
      sum + (p.attendancePercentage || 0), 0
    );
    
    const averageAttendance = processedParticipants.length > 0 
      ? Math.round(totalAttendancePercentage / processedParticipants.length) 
      : 0;
    
    const attendanceRate = processedParticipants.length > 0 
      ? Math.round((presentCount / processedParticipants.length) * 100) 
      : 0;

    const statistics = {
      totalParticipants: processedParticipants.length,
      presentCount,
      absentCount,
      averageAttendance,
      meetingDuration,
      attendanceRate,
      activeSessions: processedParticipants.filter(p => p.hasActiveSessions).length,
      inProgressCount: processedParticipants.filter(p => p.attendanceStatus === 'In Progress').length
    };

    // Sort participants by attendance percentage (descending)
    processedParticipants.sort((a, b) => (b.attendancePercentage || 0) - (a.attendancePercentage || 0));

    res.json({
      success: true,
      meetingId,
      meetingInfo,
      participants: processedParticipants,
      statistics,
      threshold: attendanceThreshold,
      thresholdDuration: Math.round(meetingDuration * (attendanceThreshold / 100)),
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('Error fetching zoom duration attendance:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error while fetching attendance data',
      details: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

/**
 * GET /api/attendance-tracker/zoom-meetings-with-attendance
 * Get list of Zoom meetings with basic attendance info
 */
router.get('/zoom-meetings-with-attendance', async (req, res) => {
  try {
    // Get all zoom meetings with participant counts
    const meetingsWithCounts = await Participant.aggregate([
      {
        $group: {
          _id: '$meetingId',
          participantCount: { $sum: 1 },
          activeParticipants: {
            $sum: { $cond: ['$isActive', 1, 0] }
          },
          averageDuration: { $avg: '$duration' },
          lastActivity: { $max: '$lastActivity' }
        }
      },
      {
        $sort: { lastActivity: -1 }
      }
    ]);

    // Get meeting details from ZoomMeeting collection
    const meetingIds = meetingsWithCounts.map(m => m._id);
    const meetingDetails = await ZoomMeeting.find({
      meetingId: { $in: meetingIds }
    }).lean();

    // Create a map for quick lookup
    const meetingDetailsMap = {};
    meetingDetails.forEach(meeting => {
      meetingDetailsMap[meeting.meetingId] = meeting;
    });

    // Combine data
    const meetings = meetingsWithCounts.map(meeting => {
      const details = meetingDetailsMap[meeting._id] || {};
      return {
        meetingId: meeting._id,
        topic: details.topic || `Meeting ${meeting._id}`,
        startTime: details.startTime,
        endTime: details.endTime,
        duration: details.duration || details.actualDuration,
        status: details.status || 'unknown',
        participantCount: meeting.participantCount,
        activeParticipants: meeting.activeParticipants,
        averageDuration: Math.round(meeting.averageDuration || 0),
        lastActivity: meeting.lastActivity
      };
    });

    res.json({
      success: true,
      meetings,
      totalMeetings: meetings.length,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('Error fetching meetings with attendance:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error while fetching meetings',
      details: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

/**
 * POST /api/attendance-tracker/generate-test-data
 * Generate test data for debugging attendance issues
 */
router.post('/generate-test-data', async (req, res) => {
  try {
    const { meetingId } = req.body;
    
    if (meetingId) {
      // Generate test data for specific meeting ID
      const { generateTestDataForMeeting } = require('../utils/testDataGenerator');
      const testData = await generateTestDataForMeeting(meetingId);
      
      res.json({
        success: true,
        message: `Test data generated successfully for meeting ${meetingId}`,
        data: {
          meetingId: testData.meetingId,
          participantCount: testData.participantCount
        },
        timestamp: new Date().toISOString()
      });
    } else {
      // Generate default test data
      const { generateTestData } = require('../utils/testDataGenerator');
      const testData = await generateTestData();
      
      res.json({
        success: true,
        message: 'Test data generated successfully',
        data: {
          meetingId: testData.meeting.meetingId,
          participantCount: testData.participants.length,
          sessionCount: testData.sessions.length
        },
        timestamp: new Date().toISOString()
      });
    }
  } catch (error) {
    console.error('Error generating test data:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to generate test data',
      details: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

/**
 * DELETE /api/attendance-tracker/cleanup-test-data
 * Clean up test data
 */
router.delete('/cleanup-test-data', async (req, res) => {
  try {
    const { cleanupTestData } = require('../utils/testDataGenerator');
    await cleanupTestData();
    
    res.json({
      success: true,
      message: 'Test data cleaned up successfully',
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('Error cleaning up test data:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to clean up test data',
      details: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

/**
 * GET /api/attendance-tracker/zoom-attendance-summary
 * Get overall attendance summary across all Zoom meetings
 */
router.get('/zoom-attendance-summary', async (req, res) => {
  try {
    const { threshold = 85, dateFrom, dateTo } = req.query;
    const attendanceThreshold = parseFloat(threshold);

    // Build date filter
    let dateFilter = {};
    if (dateFrom || dateTo) {
      dateFilter.joinTime = {};
      if (dateFrom) dateFilter.joinTime.$gte = new Date(dateFrom);
      if (dateTo) dateFilter.joinTime.$lte = new Date(dateTo);
    }

    // Get attendance statistics
    const attendanceStats = await Participant.aggregate([
      { $match: dateFilter },
      {
        $group: {
          _id: null,
          totalParticipants: { $sum: 1 },
          totalDuration: { $sum: '$duration' },
          averageDuration: { $avg: '$duration' },
          activeSessions: { $sum: { $cond: ['$isActive', 1, 0] } },
          studentMatches: { $sum: { $cond: [{ $ne: ['$studentId', null] }, 1, 0] } }
        }
      }
    ]);

    // Get meeting statistics
    const meetingStats = await ZoomMeeting.aggregate([
      {
        $group: {
          _id: null,
          totalMeetings: { $sum: 1 },
          activeMeetings: { $sum: { $cond: [{ $eq: ['$status', 'started'] }, 1, 0] } },
          completedMeetings: { $sum: { $cond: [{ $eq: ['$status', 'ended'] }, 1, 0] } },
          totalMeetingDuration: { $sum: { $ifNull: ['$actualDuration', '$duration'] } }
        }
      }
    ]);

    const stats = attendanceStats[0] || {};
    const meetings = meetingStats[0] || {};

    const summary = {
      participants: {
        total: stats.totalParticipants || 0,
        active: stats.activeSessions || 0,
        studentMatches: stats.studentMatches || 0,
        averageDuration: Math.round(stats.averageDuration || 0)
      },
      meetings: {
        total: meetings.totalMeetings || 0,
        active: meetings.activeMeetings || 0,
        completed: meetings.completedMeetings || 0,
        totalDuration: meetings.totalMeetingDuration || 0
      },
      attendance: {
        threshold: attendanceThreshold,
        // Note: More detailed attendance calculations would require 
        // processing individual participants with session data
      }
    };

    res.json({
      success: true,
      summary,
      threshold: attendanceThreshold,
      dateFilter: { dateFrom, dateTo },
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('Error fetching attendance summary:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error while fetching summary',
      details: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

module.exports = router;
