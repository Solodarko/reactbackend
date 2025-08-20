const express = require('express');
const router = express.Router();

/**
 * Bridge created meetings to global state for immediate dashboard visibility
 * This solves the issue where created meetings don't appear as "active" until webhook events arrive
 */

// GET /api/meetings/active-with-created - Get meetings from both global state and database
router.get('/active-with-created', async (req, res) => {
  try {
    const { globalState } = require('../server');
    
    // Get meetings from global state (webhook-driven active meetings)
    const activeMeetingsFromWebhooks = Array.from(globalState.activeMeetings.values());
    
    // Get recently created meetings from database that might not be in global state yet
    const ZoomMeeting = require('../models/ZoomMeeting');
    const recentMeetings = await ZoomMeeting.find({
      createdAt: { $gte: new Date(Date.now() - 24 * 60 * 60 * 1000) }, // Last 24 hours
      status: { $in: ['waiting', null, undefined] } // Only include waiting or undefined status
    }).sort({ createdAt: -1 });
    
    // Convert database meetings to the format expected by frontend
    const formattedDbMeetings = recentMeetings
      .filter(dbMeeting => {
        // Don't include if already in global state
        return !activeMeetingsFromWebhooks.find(activeMeeting => 
          activeMeeting.id === dbMeeting.meetingId
        );
      })
      .map(meeting => ({
        id: meeting.meetingId,
        topic: meeting.topic,
        join_url: meeting.joinUrl,
        start_time: meeting.startTime,
        created_at: meeting.createdAt,
        duration: meeting.duration || 60,
        status: meeting.status || 'waiting',
        type: meeting.type || 2,
        password: meeting.password,
        settings: meeting.settings,
        participants: [],
        participantCount: 0
      }));
    
    // Combine both sources
    const allMeetings = [
      ...activeMeetingsFromWebhooks,
      ...formattedDbMeetings
    ];
    
    res.json({
      success: true,
      meetings: allMeetings,
      sources: {
        globalState: activeMeetingsFromWebhooks.length,
        database: formattedDbMeetings.length,
        total: allMeetings.length
      },
      message: 'Retrieved meetings from both active state and database',
      timestamp: new Date().toISOString()
    });
    
  } catch (error) {
    console.error('Error getting active meetings with created:', error);
    res.status(500).json({
      success: false,
      error: error.message,
      meetings: [],
      timestamp: new Date().toISOString()
    });
  }
});

// POST /api/meetings/promote-to-active - Manually promote a database meeting to active state
router.post('/promote-to-active/:meetingId', async (req, res) => {
  try {
    const { meetingId } = req.params;
    const { globalState } = require('../server');
    const io = req.app.get('io');
    
    // Get meeting from database
    const ZoomMeeting = require('../models/ZoomMeeting');
    const meeting = await ZoomMeeting.findOne({
      $or: [
        { id: parseInt(meetingId) },
        { meetingId: meetingId }
      ]
    });
    
    if (!meeting) {
      return res.status(404).json({
        success: false,
        error: 'Meeting not found',
        meetingId
      });
    }
    
    // Create meeting info for global state
    const meetingInfo = {
      id: meeting.id.toString(),
      uuid: meeting.uuid || `manual_${Date.now()}`,
      topic: meeting.topic,
      join_url: meeting.join_url,
      start_time: meeting.start_time || new Date().toISOString(),
      created_at: meeting.created_at,
      duration: meeting.duration || 60,
      status: 'started', // Mark as started to make it appear active
      type: meeting.type || 2,
      password: meeting.password,
      settings: meeting.settings,
      participants: [],
      participantCount: 0,
      manuallyPromoted: true // Flag to indicate this was manually promoted
    };
    
    // Add to global state
    globalState.activeMeetings.set(meeting.id.toString(), meetingInfo);
    globalState.meetingAnalytics.activeNow = globalState.activeMeetings.size;
    
    // Emit real-time notification
    const notification = {
      id: Date.now(),
      type: 'meeting_promoted',
      title: '🚀 Meeting Promoted to Active',
      message: `Meeting "${meeting.topic}" is now active`,
      timestamp: new Date().toISOString(),
      meetingId: meeting.id.toString()
    };
    
    globalState.notifications.push(notification);
    if (io) {
      io.emit('notification', notification);
      io.emit('meetingStarted', { meeting: meetingInfo, timestamp: new Date().toISOString() });
    }
    
    res.json({
      success: true,
      meeting: meetingInfo,
      message: 'Meeting promoted to active state',
      timestamp: new Date().toISOString()
    });
    
  } catch (error) {
    console.error('Error promoting meeting to active:', error);
    res.status(500).json({
      success: false,
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

// GET /api/meetings/webhook-status/:meetingId - Check if meeting has received webhook events
router.get('/webhook-status/:meetingId', async (req, res) => {
  try {
    const { meetingId } = req.params;
    const { globalState } = require('../server');
    
    // Check if meeting is in global state (webhook-driven)
    const inGlobalState = globalState.activeMeetings.has(meetingId);
    const globalStateMeeting = globalState.activeMeetings.get(meetingId);
    
    // Check database for webhook events
    const ZoomAttendance = require('../models/ZoomAttendance');
    const ZoomMeeting = require('../models/ZoomMeeting');
    
    const meeting = await ZoomMeeting.findOne({
      $or: [
        { id: parseInt(meetingId) },
        { meetingId: meetingId }
      ]
    });
    
    const attendanceRecords = await ZoomAttendance.find({
      meetingId: meetingId
    });
    
    const webhookEvents = [];
    attendanceRecords.forEach(record => {
      record.webhookEvents.forEach(event => {
        webhookEvents.push({
          eventType: event.eventType,
          timestamp: event.timestamp,
          participant: record.participantName
        });
      });
    });
    
    res.json({
      success: true,
      meetingId,
      status: {
        inGlobalState,
        hasWebhookEvents: webhookEvents.length > 0,
        webhookEventCount: webhookEvents.length,
        globalStateStatus: globalStateMeeting?.status || null,
        manuallyPromoted: globalStateMeeting?.manuallyPromoted || false
      },
      meeting: meeting ? {
        id: meeting.id,
        topic: meeting.topic,
        created_at: meeting.created_at,
        status: meeting.status
      } : null,
      webhookEvents: webhookEvents.slice(-5), // Last 5 events
      timestamp: new Date().toISOString()
    });
    
  } catch (error) {
    console.error('Error checking webhook status:', error);
    res.status(500).json({
      success: false,
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

module.exports = router;
