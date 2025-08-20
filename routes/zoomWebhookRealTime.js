const express = require('express');
const crypto = require('crypto');
const RealTimeParticipantTracker = require('../services/realTimeParticipantTracker');

const router = express.Router();

// Initialize with io from server setup
let participantTracker = null;

// Initialize the tracker when io is available
const initializeTracker = (io) => {
  if (!participantTracker) {
    participantTracker = new RealTimeParticipantTracker(io);
    participantTracker.startPeriodicUpdates();
    console.log('🎯 Real-Time Participant Tracker initialized with WebSocket support');
  }
  return participantTracker;
};

/**
 * Webhook endpoint for Zoom events - handles real-time participant tracking
 */
router.post('/events', async (req, res) => {
  try {
    console.log('🔔 Zoom webhook received:', req.headers, req.body);

    // Get io instance from app
    const io = req.app.get('io');
    if (!participantTracker) {
      initializeTracker(io);
    }

    const { event, payload } = req.body;

    // Handle different Zoom events
    switch (event) {
      case 'meeting.participant_joined':
        console.log('👋 Processing participant join event');
        await handleParticipantJoin(payload, io);
        break;

      case 'meeting.participant_left':
        console.log('👋 Processing participant leave event');
        await handleParticipantLeave(payload, io);
        break;

      case 'meeting.started':
        console.log('🎬 Processing meeting started event');
        await handleMeetingStarted(payload, io);
        break;

      case 'meeting.ended':
        console.log('🏁 Processing meeting ended event');
        await handleMeetingEnded(payload, io);
        break;

      default:
        console.log(`ℹ️ Unhandled event type: ${event}`);
    }

    // Always return success to Zoom
    res.status(200).json({ success: true, message: 'Webhook processed successfully' });

  } catch (error) {
    console.error('❌ Webhook processing error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * Handle participant joining
 */
async function handleParticipantJoin(payload, io) {
  try {
    if (!participantTracker) {
      participantTracker = initializeTracker(io);
    }

    const webhookData = {
      meeting_id: payload.object?.id,
      participant_user_id: payload.object?.participant?.id,
      participant_user_name: payload.object?.participant?.user_name,
      participant_join_time: payload.object?.participant?.join_time,
      participant_email: payload.object?.participant?.email,
      device_type: payload.object?.participant?.device_type || 'unknown'
    };

    console.log('👋 Participant join data:', webhookData);

    const result = await participantTracker.handleParticipantJoin(webhookData);
    
    if (result.success) {
      console.log(`✅ Successfully tracked participant join: ${webhookData.participant_user_name}`);
      
      // Also emit a general notification
      if (io) {
        io.emit('participantNotification', {
          type: 'joined',
          meetingId: webhookData.meeting_id,
          participantName: webhookData.participant_user_name,
          message: `${webhookData.participant_user_name} joined the meeting`,
          timestamp: new Date().toISOString()
        });
      }
    } else {
      console.error('❌ Failed to track participant join:', result.error);
    }

    return result;
  } catch (error) {
    console.error('❌ Error in handleParticipantJoin:', error);
    return { success: false, error: error.message };
  }
}

/**
 * Handle participant leaving
 */
async function handleParticipantLeave(payload, io) {
  try {
    if (!participantTracker) {
      participantTracker = initializeTracker(io);
    }

    const webhookData = {
      meeting_id: payload.object?.id,
      participant_user_id: payload.object?.participant?.id,
      participant_user_name: payload.object?.participant?.user_name,
      participant_leave_time: payload.object?.participant?.leave_time,
      participant_email: payload.object?.participant?.email
    };

    console.log('👋 Participant leave data:', webhookData);

    const result = await participantTracker.handleParticipantLeave(webhookData);
    
    if (result.success) {
      console.log(`✅ Successfully tracked participant leave: ${webhookData.participant_user_name} (${result.duration} min, ${result.attendancePercentage}%)`);
      
      // Also emit a general notification with attendance info
      if (io) {
        io.emit('participantNotification', {
          type: 'left',
          meetingId: webhookData.meeting_id,
          participantName: webhookData.participant_user_name,
          duration: result.duration,
          attendancePercentage: result.attendancePercentage,
          attendanceStatus: result.attendanceStatus,
          message: `${webhookData.participant_user_name} left after ${result.duration} minutes (${result.attendancePercentage}%)`,
          timestamp: new Date().toISOString()
        });
      }
    } else {
      console.error('❌ Failed to track participant leave:', result.error);
    }

    return result;
  } catch (error) {
    console.error('❌ Error in handleParticipantLeave:', error);
    return { success: false, error: error.message };
  }
}

/**
 * Handle meeting started
 */
async function handleMeetingStarted(payload, io) {
  try {
    const meetingId = payload.object?.id;
    console.log('🎬 Meeting started:', meetingId);

    // Update meeting status in database
    const ZoomMeeting = require('../models/ZoomMeeting');
    await ZoomMeeting.findOneAndUpdate(
      { meetingId: meetingId?.toString() },
      {
        $set: {
          status: 'started',
          actualStartTime: new Date(),
          lastActivity: new Date()
        }
      }
    );

    // Emit real-time update
    if (io) {
      io.emit('meetingStarted', {
        meetingId,
        timestamp: new Date().toISOString(),
        message: 'Meeting has started'
      });
    }

    return { success: true, meetingId };
  } catch (error) {
    console.error('❌ Error in handleMeetingStarted:', error);
    return { success: false, error: error.message };
  }
}

/**
 * Handle meeting ended
 */
async function handleMeetingEnded(payload, io) {
  try {
    const meetingId = payload.object?.id;
    console.log('🏁 Meeting ended:', meetingId);

    // Update meeting status and end all active participants
    const ZoomMeeting = require('../models/ZoomMeeting');
    const Participant = require('../models/Participant');

    await ZoomMeeting.findOneAndUpdate(
      { meetingId: meetingId?.toString() },
      {
        $set: {
          status: 'ended',
          actualEndTime: new Date(),
          activeParticipants: 0,
          lastActivity: new Date()
        }
      }
    );

    // End all active participants for this meeting
    const endTime = new Date();
    const activeParticipants = await Participant.find({
      meetingId: meetingId?.toString(),
      isActive: true
    });

    for (const participant of activeParticipants) {
      const duration = Math.round((endTime.getTime() - participant.joinTime.getTime()) / (1000 * 60));
      
      await Participant.findByIdAndUpdate(participant._id, {
        $set: {
          isActive: false,
          leaveTime: endTime,
          duration: duration,
          connectionStatus: 'meeting_ended',
          lastActivity: new Date()
        }
      });

      console.log(`🏁 Auto-ended participant: ${participant.participantName} (${duration} min)`);
    }

    // Emit real-time update
    if (io) {
      io.emit('meetingEnded', {
        meetingId,
        endedParticipants: activeParticipants.length,
        timestamp: new Date().toISOString(),
        message: 'Meeting has ended'
      });
    }

    return { success: true, meetingId, endedParticipants: activeParticipants.length };
  } catch (error) {
    console.error('❌ Error in handleMeetingEnded:', error);
    return { success: false, error: error.message };
  }
}

/**
 * Manual endpoint to test participant join (for development/testing)
 */
router.post('/test/participant-join', async (req, res) => {
  try {
    const io = req.app.get('io');
    if (!participantTracker) {
      initializeTracker(io);
    }

    const { meetingId, participantName, email } = req.body;

    const testData = {
      meeting_id: meetingId,
      participant_user_id: `test_${Date.now()}`,
      participant_user_name: participantName || 'Test User',
      participant_join_time: new Date().toISOString(),
      participant_email: email || 'test@example.com'
    };

    const result = await participantTracker.handleParticipantJoin(testData);

    res.json({
      success: true,
      message: 'Test participant join processed',
      result
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * Manual endpoint to test participant leave (for development/testing)
 */
router.post('/test/participant-leave', async (req, res) => {
  try {
    const io = req.app.get('io');
    if (!participantTracker) {
      initializeTracker(io);
    }

    const { meetingId, participantId, participantName } = req.body;

    const testData = {
      meeting_id: meetingId,
      participant_user_id: participantId,
      participant_user_name: participantName || 'Test User',
      participant_leave_time: new Date().toISOString()
    };

    const result = await participantTracker.handleParticipantLeave(testData);

    res.json({
      success: true,
      message: 'Test participant leave processed',
      result
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * Get current participants for a meeting (for frontend polling)
 */
router.get('/participants/:meetingId', async (req, res) => {
  try {
    const { meetingId } = req.params;
    const { threshold = 85 } = req.query;

    const io = req.app.get('io');
    if (!participantTracker) {
      initializeTracker(io);
    }

    const result = await participantTracker.getCurrentParticipants(meetingId, parseInt(threshold));

    res.json(result);
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

module.exports = router;
