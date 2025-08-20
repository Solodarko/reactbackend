const express = require('express');
const TokenBasedParticipantTracker = require('../services/tokenBasedParticipantTracker');
const authMiddleware = require('../middleware/auth'); // Assuming you have auth middleware

const router = express.Router();

// Initialize tracker
let tokenTracker = null;

// Initialize the tracker when needed
const initializeTokenTracker = (io) => {
  if (!tokenTracker) {
    tokenTracker = new TokenBasedParticipantTracker(io);
    
    // Start periodic updates every 30 seconds
    setInterval(() => {
      if (tokenTracker) {
        tokenTracker.updateActiveParticipants();
      }
    }, 30000);
    
    console.log('🎯 Token-Based Participant Tracker initialized');
  }
  return tokenTracker;
};

/**
 * Middleware to extract token from Authorization header
 */
const extractToken = (req, res, next) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({
      success: false,
      error: 'Authorization token required',
      message: 'Please provide a valid JWT token in Authorization header'
    });
  }
  
  req.token = authHeader; // Keep full 'Bearer token' format
  next();
};

/**
 * POST /api/token-attendance/join
 * Handle user joining meeting using JWT token information
 */
router.post('/join', extractToken, async (req, res) => {
  try {
    const { meetingId } = req.body;
    const token = req.token;

    if (!meetingId) {
      return res.status(400).json({
        success: false,
        error: 'Meeting ID is required'
      });
    }

    // Initialize tracker if not done
    const io = req.app.get('io');
    if (!tokenTracker) {
      initializeTokenTracker(io);
    }

    console.log('📝 Processing token-based join for meeting:', meetingId);

    // Handle join using token information
    const result = await tokenTracker.handleTokenBasedJoin(meetingId, token, req.body);

    if (result.success) {
      res.json({
        success: true,
        message: result.message,
        participant: {
          participantId: result.participant.participantId,
          name: result.userInfo.name,
          email: result.userInfo.email,
          joinTime: result.participant.joinTime,
          attendanceStatus: result.attendanceData.attendanceStatus,
          duration: result.attendanceData.duration,
          percentage: result.attendanceData.attendancePercentage,
          studentInfo: result.participant.studentInfo
        },
        meetingInfo: {
          meetingId,
          duration: result.attendanceData.meetingDuration,
          thresholdDuration: result.attendanceData.thresholdDuration
        }
      });
    } else {
      res.status(400).json({
        success: false,
        error: result.error,
        message: 'Failed to process token-based join'
      });
    }

  } catch (error) {
    console.error('❌ Token-based join error:', error);
    res.status(500).json({
      success: false,
      error: error.message,
      message: 'Internal server error during token-based join'
    });
  }
});

/**
 * POST /api/token-attendance/leave
 * Handle user leaving meeting using JWT token information
 */
router.post('/leave', extractToken, async (req, res) => {
  try {
    const { meetingId } = req.body;
    const token = req.token;

    if (!meetingId) {
      return res.status(400).json({
        success: false,
        error: 'Meeting ID is required'
      });
    }

    // Initialize tracker if not done
    const io = req.app.get('io');
    if (!tokenTracker) {
      initializeTokenTracker(io);
    }

    console.log('📝 Processing token-based leave for meeting:', meetingId);

    // Handle leave using token information
    const result = await tokenTracker.handleTokenBasedLeave(meetingId, token);

    if (result.success) {
      res.json({
        success: true,
        message: result.message,
        participant: {
          participantId: result.participant.participantId,
          name: result.userInfo.name,
          email: result.userInfo.email,
          joinTime: result.participant.joinTime,
          leaveTime: result.participant.leaveTime,
          duration: result.attendanceData.duration,
          percentage: result.attendanceData.attendancePercentage,
          attendanceStatus: result.attendanceData.attendanceStatus,
          meetsThreshold: result.attendanceData.meetsThreshold,
          studentInfo: result.participant.studentInfo
        },
        meetingInfo: {
          meetingId,
          duration: result.attendanceData.meetingDuration,
          thresholdDuration: result.attendanceData.thresholdDuration
        }
      });
    } else {
      res.status(400).json({
        success: false,
        error: result.error,
        message: 'Failed to process token-based leave'
      });
    }

  } catch (error) {
    console.error('❌ Token-based leave error:', error);
    res.status(500).json({
      success: false,
      error: error.message,
      message: 'Internal server error during token-based leave'
    });
  }
});

/**
 * GET /api/token-attendance/meeting/:meetingId
 * Get attendance data for a meeting with token-based participants
 */
router.get('/meeting/:meetingId', async (req, res) => {
  try {
    const { meetingId } = req.params;
    const { threshold = 85, includeAll = false } = req.query;

    if (!meetingId) {
      return res.status(400).json({
        success: false,
        error: 'Meeting ID is required'
      });
    }

    // Initialize tracker if not done
    const io = req.app.get('io');
    if (!tokenTracker) {
      initializeTokenTracker(io);
    }

    console.log('📊 Getting token-based attendance data for meeting:', meetingId);

    // Get token-based participants
    const result = await tokenTracker.getCurrentTokenBasedParticipants(meetingId, parseInt(threshold));

    if (result.success) {
      // Format response for frontend table
      const formattedParticipants = result.participants.map(participant => ({
        participantId: participant.participantId,
        participantName: participant.displayName || participant.participantName,
        email: participant.displayEmail || participant.email,
        duration: participant.duration,
        attendancePercentage: participant.attendancePercentage,
        attendanceStatus: participant.attendanceStatus,
        meetsThreshold: participant.meetsThreshold,
        joinTime: participant.joinTime,
        leaveTime: participant.leaveTime,
        isActive: participant.isActive,
        studentInfo: participant.studentInfo,
        authenticationStatus: 'authenticated',
        source: 'jwt_token',
        userInfo: participant.userInfo
      }));

      res.json({
        success: true,
        meetingId,
        participants: formattedParticipants,
        statistics: {
          ...result.statistics,
          attendanceRate: result.statistics.presentCount > 0 
            ? Math.round((result.statistics.presentCount / result.statistics.totalParticipants) * 100)
            : 0
        },
        method: 'token_based',
        timestamp: new Date().toISOString()
      });
    } else {
      res.status(400).json({
        success: false,
        error: result.error,
        message: 'Failed to get token-based attendance data'
      });
    }

  } catch (error) {
    console.error('❌ Error getting token-based attendance:', error);
    res.status(500).json({
      success: false,
      error: error.message,
      message: 'Internal server error while getting attendance data'
    });
  }
});

/**
 * POST /api/token-attendance/check-in/:meetingId
 * Simplified check-in endpoint using token
 */
router.post('/check-in/:meetingId', extractToken, async (req, res) => {
  try {
    const { meetingId } = req.params;
    const token = req.token;

    const io = req.app.get('io');
    if (!tokenTracker) {
      initializeTokenTracker(io);
    }

    const result = await tokenTracker.handleTokenBasedJoin(meetingId, token);

    if (result.success) {
      // Emit notification for immediate frontend update
      if (io) {
        io.emit('attendanceCheckIn', {
          meetingId,
          participant: {
            name: result.userInfo.name,
            email: result.userInfo.email,
            joinTime: result.participant.joinTime
          },
          timestamp: new Date().toISOString()
        });
      }

      res.json({
        success: true,
        message: `Successfully checked in to meeting`,
        participant: result.userInfo.name,
        joinTime: result.participant.joinTime
      });
    } else {
      res.status(400).json({
        success: false,
        error: result.error
      });
    }

  } catch (error) {
    console.error('❌ Check-in error:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * POST /api/token-attendance/check-out/:meetingId
 * Simplified check-out endpoint using token
 */
router.post('/check-out/:meetingId', extractToken, async (req, res) => {
  try {
    const { meetingId } = req.params;
    const token = req.token;

    const io = req.app.get('io');
    if (!tokenTracker) {
      initializeTokenTracker(io);
    }

    const result = await tokenTracker.handleTokenBasedLeave(meetingId, token);

    if (result.success) {
      // Emit notification for immediate frontend update
      if (io) {
        io.emit('attendanceCheckOut', {
          meetingId,
          participant: {
            name: result.userInfo.name,
            email: result.userInfo.email,
            duration: result.attendanceData.duration,
            percentage: result.attendanceData.attendancePercentage,
            status: result.attendanceData.attendanceStatus
          },
          timestamp: new Date().toISOString()
        });
      }

      res.json({
        success: true,
        message: `Successfully checked out from meeting`,
        participant: result.userInfo.name,
        duration: result.attendanceData.duration,
        percentage: result.attendanceData.attendancePercentage,
        status: result.attendanceData.attendanceStatus,
        meetsThreshold: result.attendanceData.meetsThreshold
      });
    } else {
      res.status(400).json({
        success: false,
        error: result.error
      });
    }

  } catch (error) {
    console.error('❌ Check-out error:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * GET /api/token-attendance/my-attendance/:meetingId
 * Get current user's attendance status for a meeting
 */
router.get('/my-attendance/:meetingId', extractToken, async (req, res) => {
  try {
    const { meetingId } = req.params;
    const token = req.token;

    const io = req.app.get('io');
    if (!tokenTracker) {
      initializeTokenTracker(io);
    }

    // Extract user info from token
    const userInfo = tokenTracker.extractUserFromToken(token);

    // Find participant record
    const Participant = require('../models/Participant');
    const participant = await Participant.findOne({
      meetingId: meetingId.toString(),
      $or: [
        { participantId: userInfo.userId },
        { email: userInfo.email }
      ]
    });

    if (participant) {
      const attendanceData = await tokenTracker.calculateAttendanceData(participant, meetingId);

      res.json({
        success: true,
        participant: {
          name: userInfo.name,
          email: userInfo.email,
          joinTime: participant.joinTime,
          leaveTime: participant.leaveTime,
          duration: attendanceData.duration,
          percentage: attendanceData.attendancePercentage,
          status: attendanceData.attendanceStatus,
          meetsThreshold: attendanceData.meetsThreshold,
          isActive: participant.isActive
        },
        meeting: {
          duration: attendanceData.meetingDuration,
          thresholdDuration: attendanceData.thresholdDuration
        }
      });
    } else {
      res.json({
        success: true,
        participant: null,
        message: 'No attendance record found for this meeting'
      });
    }

  } catch (error) {
    console.error('❌ Error getting my attendance:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * GET /api/token-attendance/status
 * Get tracker status and active sessions
 */
router.get('/status', (req, res) => {
  try {
    if (tokenTracker) {
      res.json({
        success: true,
        tracker: 'active',
        activeSessions: tokenTracker.activeSessions.size,
        timestamp: new Date().toISOString()
      });
    } else {
      res.json({
        success: true,
        tracker: 'inactive',
        activeSessions: 0,
        timestamp: new Date().toISOString()
      });
    }
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Export the router and tracker initialization function
module.exports = {
  router,
  initializeTokenTracker
};
