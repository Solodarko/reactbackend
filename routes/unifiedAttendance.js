const express = require('express');
const UnifiedAttendanceTracker = require('../services/unifiedAttendanceTracker');

const router = express.Router();

// Initialize the unified tracker (will be set by server.js)
let unifiedTracker = null;

/**
 * Initialize the unified attendance tracker
 */
function initializeUnifiedTracker(io) {
  unifiedTracker = new UnifiedAttendanceTracker(io);
  console.log('🎯 Unified Attendance Routes initialized');
}

// ==================== WEBHOOK ROUTES (Zoom Integration) ====================

/**
 * Zoom Webhook Endpoint - Handle all Zoom events
 */
router.post('/zoom/webhook', async (req, res) => {
  try {
    console.log('📨 [WEBHOOK] Received Zoom webhook:', req.body.event);

    const { event, payload } = req.body;

    if (!event || !payload) {
      return res.status(400).json({ 
        success: false, 
        error: 'Invalid webhook payload' 
      });
    }

    const meetingId = payload.object?.id || payload.object?.uuid;
    if (!meetingId) {
      return res.status(400).json({ 
        success: false, 
        error: 'Missing meeting ID in webhook' 
      });
    }

    let result = { success: true, message: 'Event processed' };

    // Handle different Zoom events
    switch (event) {
      case 'meeting.participant_joined':
        if (payload.object?.participant) {
          result = await unifiedTracker.handleWebhookJoin(payload.object.participant, meetingId);
        }
        break;

      case 'meeting.participant_left':
        if (payload.object?.participant) {
          result = await unifiedTracker.handleWebhookLeave(payload.object.participant, meetingId);
        }
        break;

      case 'meeting.started':
        console.log('📅 [WEBHOOK] Meeting started:', meetingId);
        result = { success: true, message: 'Meeting started event processed' };
        break;

      case 'meeting.ended':
        console.log('📅 [WEBHOOK] Meeting ended:', meetingId);
        result = { success: true, message: 'Meeting ended event processed' };
        break;

      default:
        console.log(`ℹ️ [WEBHOOK] Unhandled event: ${event}`);
        result = { success: true, message: `Event ${event} noted but not processed` };
    }

    res.status(200).json({
      success: result.success,
      message: result.message,
      event: event,
      meetingId: meetingId,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('❌ [WEBHOOK] Error processing webhook:', error);
    res.status(500).json({
      success: false,
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

/**
 * Zoom Webhook Verification (for initial setup)
 */
router.get('/zoom/webhook', (req, res) => {
  const challenge = req.query.challenge;
  if (challenge) {
    console.log('✅ [WEBHOOK] Zoom webhook verification successful');
    res.status(200).json({
      challenge: challenge
    });
  } else {
    res.status(400).json({ error: 'No challenge parameter provided' });
  }
});

// ==================== TOKEN-BASED ROUTES (User Authentication) ====================

/**
 * Token-based Check-in - User joins meeting with JWT token
 */
router.post('/checkin/:meetingId', async (req, res) => {
  try {
    const { meetingId } = req.params;
    const token = req.headers.authorization;

    if (!token) {
      return res.status(401).json({
        success: false,
        error: 'Authorization token required'
      });
    }

    console.log(`📝 [TOKEN CHECKIN] Processing check-in for meeting: ${meetingId}`);

    const result = await unifiedTracker.handleTokenJoin(meetingId, token, req.body);

    if (result.success) {
      const attendanceData = await unifiedTracker.calculateAttendanceData(result.participant, meetingId);
      
      res.status(200).json({
        success: true,
        message: `Successfully checked in to meeting ${meetingId}`,
        joinTime: result.participant.joinTime,
        participant: {
          name: result.userInfo.name,
          email: result.userInfo.email,
          ...attendanceData
        },
        meetingId: meetingId,
        timestamp: new Date().toISOString()
      });
    } else {
      res.status(400).json({
        success: false,
        error: result.error,
        meetingId: meetingId
      });
    }

  } catch (error) {
    console.error('❌ [TOKEN CHECKIN] Error:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * Token-based Check-out - User leaves meeting with JWT token
 */
router.post('/checkout/:meetingId', async (req, res) => {
  try {
    const { meetingId } = req.params;
    const token = req.headers.authorization;

    if (!token) {
      return res.status(401).json({
        success: false,
        error: 'Authorization token required'
      });
    }

    console.log(`📝 [TOKEN CHECKOUT] Processing check-out for meeting: ${meetingId}`);

    const result = await unifiedTracker.handleTokenLeave(meetingId, token);

    if (result.success) {
      const attendanceData = await unifiedTracker.calculateAttendanceData(result.participant, meetingId);
      
      res.status(200).json({
        success: true,
        message: result.message || `Successfully checked out from meeting ${meetingId}`,
        leaveTime: result.participant.leaveTime,
        duration: attendanceData.duration,
        percentage: attendanceData.attendancePercentage,
        status: attendanceData.attendanceStatus,
        meetsThreshold: attendanceData.meetsThreshold,
        participant: {
          name: unifiedTracker.getDisplayName(result.participant),
          email: result.participant.email,
          ...attendanceData
        },
        meetingId: meetingId,
        timestamp: new Date().toISOString()
      });
    } else {
      res.status(400).json({
        success: false,
        error: result.error,
        meetingId: meetingId
      });
    }

  } catch (error) {
    console.error('❌ [TOKEN CHECKOUT] Error:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// ==================== UNIFIED DATA ROUTES ====================

/**
 * Get Complete Attendance Data - All participants (webhook + token-based)
 */
router.get('/meeting/:meetingId', async (req, res) => {
  try {
    const { meetingId } = req.params;
    const threshold = parseInt(req.query.threshold) || 85;

    console.log(`📊 [UNIFIED DATA] Getting attendance for meeting: ${meetingId} (threshold: ${threshold}%)`);

    const result = await unifiedTracker.getUnifiedAttendanceData(meetingId, threshold);

    if (result.success) {
      res.status(200).json({
        success: true,
        meetingId: meetingId,
        participants: result.participants,
        statistics: result.statistics,
        metadata: {
          totalParticipants: result.participants.length,
          webhookBased: result.participants.filter(p => p.source === 'zoom_webhook').length,
          tokenBased: result.participants.filter(p => p.source === 'jwt_token').length,
          authenticated: result.participants.filter(p => p.isAuthenticated).length,
          threshold: threshold,
          timestamp: result.timestamp
        }
      });
    } else {
      res.status(500).json({
        success: false,
        error: result.error,
        meetingId: meetingId
      });
    }

  } catch (error) {
    console.error('❌ [UNIFIED DATA] Error:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * Get My Attendance - Individual participant query with token
 */
router.get('/my-attendance/:meetingId', async (req, res) => {
  try {
    const { meetingId } = req.params;
    const token = req.headers.authorization;

    if (!token) {
      return res.status(401).json({
        success: false,
        error: 'Authorization token required'
      });
    }

    console.log(`👤 [MY ATTENDANCE] Getting individual attendance for meeting: ${meetingId}`);

    const result = await unifiedTracker.getMyAttendance(meetingId, token);

    if (result.success) {
      const participant = result.participant;
      
      res.status(200).json({
        success: true,
        meetingId: meetingId,
        participant: {
          name: participant.displayName,
          email: participant.email,
          joinTime: participant.joinTime,
          leaveTime: participant.leaveTime,
          duration: participant.duration,
          percentage: participant.attendancePercentage,
          status: participant.attendanceStatus,
          meetsThreshold: participant.meetsThreshold,
          isActive: participant.isActive,
          source: participant.source,
          isAuthenticated: participant.isAuthenticated || participant.tokenBased
        },
        timestamp: new Date().toISOString()
      });
    } else {
      res.status(404).json({
        success: false,
        error: result.error,
        meetingId: meetingId
      });
    }

  } catch (error) {
    console.error('❌ [MY ATTENDANCE] Error:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * Get Live Statistics - Real-time meeting stats
 */
router.get('/statistics/:meetingId', async (req, res) => {
  try {
    const { meetingId } = req.params;
    const threshold = parseInt(req.query.threshold) || 85;

    console.log(`📈 [STATISTICS] Getting live statistics for meeting: ${meetingId}`);

    const result = await unifiedTracker.getUnifiedAttendanceData(meetingId, threshold);

    if (result.success) {
      res.status(200).json({
        success: true,
        meetingId: meetingId,
        statistics: result.statistics,
        summary: {
          totalParticipants: result.statistics.totalParticipants,
          present: result.statistics.presentCount,
          absent: result.statistics.absentCount,
          inProgress: result.statistics.inProgressCount,
          attendanceRate: result.statistics.attendanceRate,
          averageAttendance: result.statistics.averageAttendance,
          authenticated: result.statistics.authenticatedCount
        },
        timestamp: result.timestamp
      });
    } else {
      res.status(500).json({
        success: false,
        error: result.error,
        meetingId: meetingId
      });
    }

  } catch (error) {
    console.error('❌ [STATISTICS] Error:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// ==================== ADMIN/DEBUG ROUTES ====================

/**
 * Clear Meeting Data - For testing purposes
 */
router.delete('/meeting/:meetingId/clear', async (req, res) => {
  try {
    const { meetingId } = req.params;
    
    console.log(`🗑️ [CLEAR] Clearing data for meeting: ${meetingId}`);

    // Clear from database
    const Participant = require('../models/Participant');
    const result = await Participant.deleteMany({ meetingId: meetingId.toString() });

    // Clear from active sessions
    if (unifiedTracker) {
      unifiedTracker.activeSessions.clear();
      unifiedTracker.webhookSessions.clear();
      unifiedTracker.tokenSessions.clear();
    }

    res.status(200).json({
      success: true,
      message: `Cleared ${result.deletedCount} participants from meeting ${meetingId}`,
      deletedCount: result.deletedCount,
      meetingId: meetingId,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('❌ [CLEAR] Error:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * Health Check
 */
router.get('/health', (req, res) => {
  res.status(200).json({
    success: true,
    message: 'Unified Attendance Tracker is running',
    services: {
      webhookTracking: 'active',
      tokenTracking: 'active',
      unifiedData: 'active'
    },
    timestamp: new Date().toISOString()
  });
});

module.exports = { router, initializeUnifiedTracker };
