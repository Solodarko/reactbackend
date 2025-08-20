const express = require('express');
const mongoose = require('mongoose');
const AttendanceSession = require('../models/AttendanceSession');
const Participant = require('../models/Participant');
const { 
  calculateSessionBasedParticipantAttendance,
  calculateTotalSessionDuration,
  calculateMeetingDurationFromInfo,
  calculateSessionBasedAttendancePercentage,
  determineSessionBasedAttendanceStatus
} = require('../utils/attendanceUtils'); // Note: We need to create this backend utils file

const router = express.Router();

// POST /api/attendance-sessions/start - Start a new attendance session
router.post('/start', async (req, res) => {
  try {
    const {
      participantId,
      meetingId,
      userId,
      studentId,
      joinTime,
      deviceInfo,
      location,
      metadata
    } = req.body;

    if (!participantId || !meetingId || !joinTime) {
      return res.status(400).json({
        success: false,
        error: 'Missing required fields: participantId, meetingId, joinTime',
        timestamp: new Date().toISOString()
      });
    }

    // Check if participant already has an active session for this meeting
    const activeSession = await AttendanceSession.findOne({
      participantId,
      meetingId,
      isActive: true
    });

    if (activeSession) {
      return res.status(409).json({
        success: false,
        error: 'Participant already has an active session for this meeting',
        activeSession: activeSession._id,
        timestamp: new Date().toISOString()
      });
    }

    // Count existing sessions for this participant in this meeting to set session number
    const sessionCount = await AttendanceSession.countDocuments({
      participantId,
      meetingId
    });

    // Create new attendance session
    const newSession = new AttendanceSession({
      participantId,
      meetingId,
      userId,
      studentId,
      joinTime: new Date(joinTime),
      deviceInfo,
      location,
      metadata: {
        ...metadata,
        sessionNumber: sessionCount + 1
      },
      trackingSource: 'zoom_webhook'
    });

    const savedSession = await newSession.save();

    // Emit real-time update
    const io = req.app.get('io');
    if (io) {
      io.emit('sessionStarted', {
        sessionId: savedSession._id,
        participantId,
        meetingId,
        joinTime: savedSession.joinTime,
        timestamp: new Date().toISOString()
      });
    }

    res.status(201).json({
      success: true,
      session: savedSession,
      message: 'Attendance session started successfully',
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('Error starting attendance session:', error);
    res.status(500).json({
      success: false,
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

// PUT /api/attendance-sessions/:sessionId/end - End an attendance session
router.put('/:sessionId/end', async (req, res) => {
  try {
    const { sessionId } = req.params;
    const { leaveTime, disconnectionReason } = req.body;

    const session = await AttendanceSession.findById(sessionId);
    
    if (!session) {
      return res.status(404).json({
        success: false,
        error: 'Session not found',
        timestamp: new Date().toISOString()
      });
    }

    if (!session.isActive) {
      return res.status(409).json({
        success: false,
        error: 'Session is already ended',
        timestamp: new Date().toISOString()
      });
    }

    // End the session
    await session.endSession(
      leaveTime ? new Date(leaveTime) : null,
      disconnectionReason || 'left_meeting'
    );

    // Emit real-time update
    const io = req.app.get('io');
    if (io) {
      io.emit('sessionEnded', {
        sessionId: session._id,
        participantId: session.participantId,
        meetingId: session.meetingId,
        leaveTime: session.leaveTime,
        duration: session.duration,
        timestamp: new Date().toISOString()
      });
    }

    res.json({
      success: true,
      session,
      message: 'Attendance session ended successfully',
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('Error ending attendance session:', error);
    res.status(500).json({
      success: false,
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

// GET /api/attendance-sessions/meeting/:meetingId - Get all sessions for a meeting
router.get('/meeting/:meetingId', async (req, res) => {
  try {
    const { meetingId } = req.params;
    const { activeOnly, includeParticipant, attendanceThreshold } = req.query;
    
    const threshold = parseFloat(attendanceThreshold) || 85;

    // Get all sessions for the meeting
    const sessions = await AttendanceSession.getMeetingSessions(meetingId, activeOnly === 'true');

    // Group sessions by participant
    const participantSessions = {};
    
    sessions.forEach(session => {
      const participantId = session.participantId._id.toString();
      if (!participantSessions[participantId]) {
        participantSessions[participantId] = {
          participantId,
          participantInfo: session.participantId,
          userInfo: session.userId,
          sessions: []
        };
      }
      participantSessions[participantId].sessions.push(session);
    });

    // Calculate attendance data for each participant
    const participants = await Promise.all(
      Object.values(participantSessions).map(async (participantData) => {
        const totalDuration = calculateTotalSessionDuration(participantData.sessions);
        const hasActiveSessions = participantData.sessions.some(s => s.isActive);
        
        // Get meeting duration (you might need to fetch this from meeting data)
        // For now, using a placeholder - in real implementation, fetch from meeting record
        const meetingDuration = 60; // TODO: Get actual meeting duration
        
        const attendancePercentage = calculateSessionBasedAttendancePercentage(
          totalDuration,
          meetingDuration,
          hasActiveSessions
        );
        
        const attendanceStatus = determineSessionBasedAttendanceStatus(
          attendancePercentage,
          hasActiveSessions,
          totalDuration,
          threshold
        );

        return {
          ...participantData,
          totalSessionDuration: totalDuration,
          attendancePercentage,
          attendanceStatus,
          hasActiveSessions,
          sessionCount: participantData.sessions.length,
          meetingDuration
        };
      })
    );

    // Calculate meeting statistics
    const stats = {
      totalParticipants: participants.length,
      activeSessions: participants.filter(p => p.hasActiveSessions).length,
      presentCount: participants.filter(p => p.attendanceStatus === 'Present').length,
      absentCount: participants.filter(p => p.attendanceStatus === 'Absent').length,
      inProgressCount: participants.filter(p => p.attendanceStatus === 'In Progress').length,
      averageAttendance: participants.length > 0 
        ? Math.round(participants.reduce((sum, p) => sum + p.attendancePercentage, 0) / participants.length)
        : 0
    };

    res.json({
      success: true,
      meetingId,
      participants,
      statistics: stats,
      attendanceThreshold: threshold,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('Error getting meeting sessions:', error);
    res.status(500).json({
      success: false,
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

// GET /api/attendance-sessions/participant/:participantId - Get all sessions for a participant
router.get('/participant/:participantId', async (req, res) => {
  try {
    const { participantId } = req.params;
    const { meetingId } = req.query;

    const sessions = await AttendanceSession.getParticipantSessions(participantId, meetingId);

    // Calculate total duration across all sessions
    const totalDuration = calculateTotalSessionDuration(sessions);
    const activeSessions = sessions.filter(s => s.isActive);

    res.json({
      success: true,
      participantId,
      meetingId: meetingId || 'all',
      sessions,
      totalDuration,
      activeSessionCount: activeSessions.length,
      totalSessionCount: sessions.length,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('Error getting participant sessions:', error);
    res.status(500).json({
      success: false,
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

// GET /api/attendance-sessions/:sessionId - Get specific session details
router.get('/:sessionId', async (req, res) => {
  try {
    const { sessionId } = req.params;

    const session = await AttendanceSession.findById(sessionId)
      .populate('participantId', 'participantName email studentId')
      .populate('userId', 'username email role');

    if (!session) {
      return res.status(404).json({
        success: false,
        error: 'Session not found',
        timestamp: new Date().toISOString()
      });
    }

    // Calculate current duration if session is still active
    const currentDuration = session.getCurrentDuration();

    res.json({
      success: true,
      session: {
        ...session.toObject(),
        currentDuration
      },
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('Error getting session details:', error);
    res.status(500).json({
      success: false,
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

// PUT /api/attendance-sessions/:sessionId/engagement - Update session engagement metrics
router.put('/:sessionId/engagement', async (req, res) => {
  try {
    const { sessionId } = req.params;
    const { engagement, connectionQuality } = req.body;

    const session = await AttendanceSession.findById(sessionId);
    
    if (!session) {
      return res.status(404).json({
        success: false,
        error: 'Session not found',
        timestamp: new Date().toISOString()
      });
    }

    // Update engagement metrics
    if (engagement) {
      session.engagement = { ...session.engagement, ...engagement };
    }

    // Update connection quality
    if (connectionQuality) {
      session.connectionQuality = { ...session.connectionQuality, ...connectionQuality };
    }

    const updatedSession = await session.save();

    // Emit real-time update
    const io = req.app.get('io');
    if (io) {
      io.emit('sessionEngagementUpdated', {
        sessionId: updatedSession._id,
        participantId: updatedSession.participantId,
        meetingId: updatedSession.meetingId,
        engagement: updatedSession.engagement,
        connectionQuality: updatedSession.connectionQuality,
        timestamp: new Date().toISOString()
      });
    }

    res.json({
      success: true,
      session: updatedSession,
      message: 'Session engagement metrics updated successfully',
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('Error updating session engagement:', error);
    res.status(500).json({
      success: false,
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

// GET /api/attendance-sessions/meeting/:meetingId/summary - Get attendance summary with session-based calculations
router.get('/meeting/:meetingId/summary', async (req, res) => {
  try {
    const { meetingId } = req.params;
    const { attendanceThreshold } = req.query;
    
    const threshold = parseFloat(attendanceThreshold) || 85;

    // Get aggregated data using MongoDB aggregation pipeline
    const aggregationResult = await AttendanceSession.aggregate([
      {
        $match: { meetingId }
      },
      {
        $group: {
          _id: '$participantId',
          totalDuration: { $sum: '$duration' },
          sessionCount: { $sum: 1 },
          activeSessions: {
            $sum: { $cond: ['$isActive', 1, 0] }
          },
          firstJoinTime: { $min: '$joinTime' },
          lastLeaveTime: { $max: '$leaveTime' },
          avgConnectionQuality: { $avg: '$connectionQuality.averageLatency' }
        }
      },
      {
        $lookup: {
          from: 'participants',
          localField: '_id',
          foreignField: '_id',
          as: 'participantInfo'
        }
      },
      {
        $unwind: '$participantInfo'
      }
    ]);

    // Calculate attendance statistics
    const meetingDuration = 60; // TODO: Get actual meeting duration from meeting record
    
    const participantsWithAttendance = aggregationResult.map(participant => {
      const hasActiveSessions = participant.activeSessions > 0;
      const attendancePercentage = calculateSessionBasedAttendancePercentage(
        participant.totalDuration,
        meetingDuration,
        hasActiveSessions
      );
      
      const attendanceStatus = determineSessionBasedAttendanceStatus(
        attendancePercentage,
        hasActiveSessions,
        participant.totalDuration,
        threshold
      );

      return {
        participantId: participant._id,
        participantInfo: participant.participantInfo,
        totalDuration: participant.totalDuration,
        sessionCount: participant.sessionCount,
        activeSessions: participant.activeSessions,
        attendancePercentage,
        attendanceStatus,
        firstJoinTime: participant.firstJoinTime,
        lastLeaveTime: participant.lastLeaveTime,
        avgConnectionQuality: participant.avgConnectionQuality
      };
    });

    // Overall statistics
    const overallStats = {
      totalParticipants: participantsWithAttendance.length,
      presentCount: participantsWithAttendance.filter(p => p.attendanceStatus === 'Present').length,
      absentCount: participantsWithAttendance.filter(p => p.attendanceStatus === 'Absent').length,
      inProgressCount: participantsWithAttendance.filter(p => p.attendanceStatus === 'In Progress').length,
      averageAttendancePercentage: participantsWithAttendance.length > 0
        ? Math.round(participantsWithAttendance.reduce((sum, p) => sum + p.attendancePercentage, 0) / participantsWithAttendance.length)
        : 0,
      totalSessions: participantsWithAttendance.reduce((sum, p) => sum + p.sessionCount, 0),
      activeSessions: participantsWithAttendance.reduce((sum, p) => sum + p.activeSessions, 0),
      attendanceThreshold: threshold
    };

    res.json({
      success: true,
      meetingId,
      participants: participantsWithAttendance,
      statistics: overallStats,
      meetingDuration,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('Error getting meeting attendance summary:', error);
    res.status(500).json({
      success: false,
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

// DELETE /api/attendance-sessions/:sessionId - Delete a session (admin only)
router.delete('/:sessionId', async (req, res) => {
  try {
    const { sessionId } = req.params;

    const session = await AttendanceSession.findById(sessionId);
    
    if (!session) {
      return res.status(404).json({
        success: false,
        error: 'Session not found',
        timestamp: new Date().toISOString()
      });
    }

    await AttendanceSession.findByIdAndDelete(sessionId);

    // Emit real-time update
    const io = req.app.get('io');
    if (io) {
      io.emit('sessionDeleted', {
        sessionId,
        participantId: session.participantId,
        meetingId: session.meetingId,
        timestamp: new Date().toISOString()
      });
    }

    res.json({
      success: true,
      message: 'Session deleted successfully',
      deletedSessionId: sessionId,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('Error deleting session:', error);
    res.status(500).json({
      success: false,
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

module.exports = router;
