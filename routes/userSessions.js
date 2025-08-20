const express = require('express');
const { auth } = require('../middleware/auth');
const UserSessionManager = require('../services/userSessionManager');

const router = express.Router();

// Initialize User Session Manager
const userSessionManager = new UserSessionManager();

// Make userSessionManager available globally for other services
global.userSessionManager = userSessionManager;

/**
 * @route   POST /api/user-sessions/join-meeting
 * @desc    Register authenticated user for meeting attendance
 * @access  Private (requires auth token)
 */
router.post('/join-meeting', auth, async (req, res) => {
  try {
    console.log('\n🎯 ===== JOIN-MEETING ROUTE START =====');
    console.log('User from auth middleware:', {
      id: req.user?._id,
      username: req.user?.username,
      email: req.user?.email,
      role: req.user?.role
    });
    console.log('Token from auth middleware:', req.token ? 'PRESENT' : 'MISSING');
    console.log('Request body:', {
      meetingId: req.body.meetingId,
      participantDataKeys: req.body.participantData ? Object.keys(req.body.participantData) : 'NONE'
    });
    
    const { meetingId, participantData } = req.body;
    
    // Comprehensive input validation
    if (!meetingId) {
      console.log('❌ Meeting ID missing from request');
      return res.status(400).json({
        success: false,
        message: 'Meeting ID is required',
        code: 'MISSING_MEETING_ID'
      });
    }

    if (typeof meetingId !== 'string' || meetingId.trim().length === 0) {
      return res.status(400).json({
        success: false,
        message: 'Meeting ID must be a non-empty string',
        code: 'INVALID_MEETING_ID_FORMAT'
      });
    }

    // Validate meeting ID format
    if (!/^[a-zA-Z0-9_-]+$/.test(meetingId.trim())) {
      return res.status(400).json({
        success: false,
        message: 'Meeting ID contains invalid characters. Only alphanumeric, underscore, and dash allowed',
        code: 'INVALID_MEETING_ID_CHARACTERS'
      });
    }

    // Validate participantData if provided
    if (participantData && typeof participantData !== 'object') {
      return res.status(400).json({
        success: false,
        message: 'Participant data must be an object',
        code: 'INVALID_PARTICIPANT_DATA'
      });
    }

    // Sanitize meetingId
    const sanitizedMeetingId = meetingId.trim();

    // Check if user already has an active session for this meeting
    const existingSessions = userSessionManager.getUserSessions(req.user._id);
    const activeSessionForMeeting = existingSessions.find(s => 
      s.meetingId === sanitizedMeetingId && s.isActive
    );

    if (activeSessionForMeeting) {
      return res.status(409).json({
        success: false,
        message: 'User already has an active session for this meeting',
        code: 'DUPLICATE_SESSION',
        existingSessionId: activeSessionForMeeting.sessionId
      });
    }

    // Extract token from request
    const token = req.token;
    
    console.log('🔍 About to register user session:');
    console.log('Token present:', !!token);
    console.log('Token type:', typeof token);
    console.log('Meeting ID:', sanitizedMeetingId);
    console.log('Participant data:', participantData);
    
    // Register user session
    const result = await userSessionManager.registerUserSession(token, sanitizedMeetingId, participantData);
    
    console.log('🔍 User session registration result:', {
      success: result.success,
      error: result.error,
      code: result.code,
      sessionId: result.sessionId
    });
    
    if (result.success) {
      // Emit Socket.IO event for real-time updates
      try {
        const io = req.app.get('io');
        if (io) {
          io.emit('userJoinedMeeting', {
            meetingId,
            user: result.userData.user,
            sessionId: result.sessionId,
            timestamp: new Date().toISOString()
          });
          
          io.to(`meeting_${meetingId}`).emit('participantJoined', {
            type: 'authenticated_user',
            participant: result.userData.participant,
            user: result.userData.user,
            student: result.userData.student,
            sessionId: result.sessionId,
            timestamp: new Date().toISOString()
          });
          
          // Trigger 85% attendance tracker update
          if (global.attendanceTracker85WS) {
            try {
              console.log(`🎯 Triggering 85% attendance tracker for user join - Meeting: ${meetingId}`);
              await global.attendanceTracker85WS.processParticipantJoin(io, meetingId, {
                participantId: result.userData.participant?.participantId,
                participantName: result.userData.participant?.participantName || result.userData.user?.username,
                email: result.userData.participant?.email || result.userData.user?.email,
                user: result.userData.user,
                student: result.userData.student,
                sessionId: result.sessionId
              });
            } catch (trackerError) {
              console.warn('85% attendance tracker processing failed:', trackerError.message);
            }
          }
        }
      } catch (socketError) {
        console.warn('Socket.IO emission failed:', socketError.message);
      }

      console.log('✅ Session registration successful - sending success response');
      console.log('🎯 ===== JOIN-MEETING ROUTE END (SUCCESS) =====\n');
      
      res.status(200).json({
        success: true,
        message: 'Successfully registered for meeting attendance',
        sessionId: result.sessionId,
        userData: {
          user: result.userData.user,
          student: result.userData.student,
          meetingId: result.userData.meetingId,
          joinTime: result.userData.joinTime
        }
      });
    } else {
      console.log('❌ Session registration failed - sending error response:', {
        error: result.error,
        code: result.code
      });
      console.log('🎯 ===== JOIN-MEETING ROUTE END (FAILURE) =====\n');
      
      res.status(400).json({
        success: false,
        message: result.error || 'Failed to register for meeting',
        code: result.code
      });
    }

  } catch (error) {
    console.error('❌ Error in join-meeting endpoint:', error.message);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

/**
 * @route   POST /api/user-sessions/leave-meeting
 * @desc    End user session when leaving a meeting
 * @access  Private (requires auth token)
 */
router.post('/leave-meeting', auth, async (req, res) => {
  try {
    const { sessionId, meetingId } = req.body;
    
    if (!sessionId && !meetingId) {
      return res.status(400).json({
        success: false,
        message: 'Session ID or Meeting ID is required'
      });
    }

    let result;
    if (sessionId) {
      result = await userSessionManager.endUserSession(sessionId);
    } else {
      // Find user's active session for this meeting
      const userSessions = userSessionManager.getUserSessions(req.user._id);
      const activeSession = userSessions.find(s => s.meetingId === meetingId && s.isActive);
      
      if (activeSession) {
        result = await userSessionManager.endUserSession(activeSession.sessionId);
      } else {
        return res.status(404).json({
          success: false,
          message: 'No active session found for this meeting'
        });
      }
    }

    if (result && result.success) {
      // Emit Socket.IO event for real-time updates
      try {
        const io = req.app.get('io');
        if (io) {
          io.emit('userLeftMeeting', {
            meetingId: result.sessionData.meetingId,
            user: result.sessionData.user,
            duration: result.sessionData.duration,
            timestamp: new Date().toISOString()
          });
          
          io.to(`meeting_${result.sessionData.meetingId}`).emit('participantLeft', {
            type: 'authenticated_user',
            user: result.sessionData.user,
            duration: result.sessionData.duration,
            timestamp: new Date().toISOString()
          });
        }
      } catch (socketError) {
        console.warn('Socket.IO emission failed:', socketError.message);
      }

      res.status(200).json({
        success: true,
        message: 'Successfully ended meeting session',
        sessionData: {
          duration: result.sessionData.duration,
          joinTime: result.sessionData.joinTime,
          leaveTime: result.sessionData.leaveTime
        }
      });
    } else {
      res.status(400).json({
        success: false,
        message: result ? result.error : 'Failed to end session'
      });
    }

  } catch (error) {
    console.error('❌ Error in leave-meeting endpoint:', error.message);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

/**
 * @route   GET /api/user-sessions/my-sessions
 * @desc    Get current user's active sessions
 * @access  Private (requires auth token)
 */
router.get('/my-sessions', auth, async (req, res) => {
  try {
    const userSessions = userSessionManager.getUserSessions(req.user._id);
    
    const sessionData = userSessions.map(session => ({
      sessionId: session.sessionId,
      meetingId: session.meetingId,
      participant: session.participant,
      joinTime: session.joinTime,
      leaveTime: session.leaveTime,
      duration: session.duration,
      isActive: session.isActive,
      lastActivity: session.lastActivity,
      student: session.student
    }));

    res.status(200).json({
      success: true,
      sessions: sessionData,
      totalSessions: sessionData.length,
      activeSessions: sessionData.filter(s => s.isActive).length
    });

  } catch (error) {
    console.error('❌ Error in my-sessions endpoint:', error.message);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

/**
 * @route   GET /api/user-sessions/meeting/:meetingId/authenticated-participants
 * @desc    Get authenticated participants for a specific meeting
 * @access  Private (requires auth token)
 */
router.get('/meeting/:meetingId/authenticated-participants', auth, async (req, res) => {
  try {
    const { meetingId } = req.params;
    const activeSessions = userSessionManager.getActiveMeetingSessions(meetingId);
    
    const participants = activeSessions.map(session => ({
      sessionId: session.sessionId,
      user: session.user,
      student: session.student,
      participant: session.participant,
      joinTime: session.joinTime,
      duration: session.duration || Math.round((Date.now() - session.joinTime) / (1000 * 60)),
      isActive: session.isActive,
      lastActivity: session.lastActivity,
      device: session.device
    }));

    res.status(200).json({
      success: true,
      meetingId,
      authenticatedParticipants: participants,
      totalAuthenticated: participants.length,
      students: participants.filter(p => p.student).length,
      admins: participants.filter(p => p.user.role === 'admin').length,
      users: participants.filter(p => p.user.role === 'user').length
    });

  } catch (error) {
    console.error('❌ Error in authenticated-participants endpoint:', error.message);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

/**
 * @route   POST /api/user-sessions/link-zoom-participant
 * @desc    Link user session with Zoom participant (for admin use)
 * @access  Private (requires auth token)
 */
router.post('/link-zoom-participant', auth, async (req, res) => {
  try {
    const { sessionId, participantId, zoomData } = req.body;
    
    if (!sessionId || !participantId) {
      return res.status(400).json({
        success: false,
        message: 'Session ID and Participant ID are required'
      });
    }

    const result = await userSessionManager.linkWithZoomParticipant(sessionId, participantId, zoomData);
    
    if (result.success) {
      // Emit Socket.IO event for real-time updates
      try {
        const io = req.app.get('io');
        if (io) {
          io.emit('participantLinked', {
            sessionId,
            participantId,
            user: result.session.user,
            participant: result.participant,
            timestamp: new Date().toISOString()
          });
        }
      } catch (socketError) {
        console.warn('Socket.IO emission failed:', socketError.message);
      }

      res.status(200).json({
        success: true,
        message: 'Successfully linked user session with Zoom participant',
        participant: result.participant,
        session: result.session
      });
    } else {
      res.status(400).json({
        success: false,
        message: result.error || 'Failed to link session with participant'
      });
    }

  } catch (error) {
    console.error('❌ Error in link-zoom-participant endpoint:', error.message);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

/**
 * @route   PUT /api/user-sessions/update-activity
 * @desc    Update user activity status in meeting
 * @access  Private (requires auth token)
 */
router.put('/update-activity', auth, async (req, res) => {
  try {
    const { sessionId, activityData } = req.body;
    
    if (!sessionId) {
      return res.status(400).json({
        success: false,
        message: 'Session ID is required'
      });
    }

    const success = userSessionManager.updateUserActivity(sessionId, activityData);
    
    if (success) {
      res.status(200).json({
        success: true,
        message: 'Activity updated successfully'
      });
    } else {
      res.status(404).json({
        success: false,
        message: 'Session not found'
      });
    }

  } catch (error) {
    console.error('❌ Error in update-activity endpoint:', error.message);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

/**
 * @route   GET /api/user-sessions/stats
 * @desc    Get session statistics (for admin)
 * @access  Private (requires auth token)
 */
router.get('/stats', auth, async (req, res) => {
  try {
    const stats = userSessionManager.getSessionStats();
    
    res.status(200).json({
      success: true,
      statistics: stats,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('❌ Error in stats endpoint:', error.message);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

/**
 * @route   DELETE /api/user-sessions/meeting/:meetingId/end-all
 * @desc    End all user sessions for a meeting (for admin)
 * @access  Private (requires auth token)
 */
router.delete('/meeting/:meetingId/end-all', auth, async (req, res) => {
  try {
    const { meetingId } = req.params;
    
    const endedCount = await userSessionManager.endAllMeetingSessions(meetingId);
    
    // Emit Socket.IO event for real-time updates
    try {
      const io = req.app.get('io');
      if (io) {
        io.emit('meetingSessionsEnded', {
          meetingId,
          endedCount,
          timestamp: new Date().toISOString()
        });
      }
    } catch (socketError) {
      console.warn('Socket.IO emission failed:', socketError.message);
    }

    res.status(200).json({
      success: true,
      message: `Successfully ended ${endedCount} user sessions for meeting ${meetingId}`,
      endedCount
    });

  } catch (error) {
    console.error('❌ Error in end-all endpoint:', error.message);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

// Export both router and userSessionManager for use in other parts of the application
module.exports = { router, userSessionManager };
