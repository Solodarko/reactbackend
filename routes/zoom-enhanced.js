const express = require('express');
const axios = require('axios');
const ZoomMeeting = require('../models/ZoomMeeting');
const { storeZoomMeetingDetails } = require('../utils/zoomSdkTracker');

const router = express.Router();

// Enhanced create meeting endpoint with proper duration handling
router.post('/enhanced/create-meeting', async (req, res) => {
  try {
    const accessToken = await getZoomAccessToken();
    const io = req.app.get('io');
    const { globalState } = require('../server');

    // Extract and validate duration
    const requestedDuration = parseInt(req.body.duration) || 5;
    console.log('📝 Creating meeting with duration:', requestedDuration, 'minutes');

    // Create meeting data with CORRECT duration
    let meetingData = {
      topic: req.body.topic || 'New Meeting',
      type: req.body.type || 1, // Instant meeting by default
      duration: requestedDuration, // Use the EXACT duration requested
      password: req.body.password || null,
      agenda: req.body.agenda || '',
      settings: {
        host_video: req.body.settings?.host_video !== undefined ? req.body.settings.host_video : true,
        participant_video: req.body.settings?.participant_video !== undefined ? req.body.settings.participant_video : true,
        cn_meeting: false,
        in_meeting: false,
        join_before_host: true,
        mute_upon_entry: req.body.settings?.mute_upon_entry !== undefined ? req.body.settings.mute_upon_entry : true,
        watermark: false,
        use_pmi: false,
        approval_type: 0,
        audio: 'both',
        auto_recording: req.body.settings?.auto_recording || 'none',
        waiting_room: req.body.settings?.waiting_room !== undefined ? req.body.settings.waiting_room : false,
        registrants_confirmation_email: false,
        registrants_email_notification: false
      }
    };

    console.log('📊 Meeting data being sent to Zoom:', JSON.stringify(meetingData, null, 2));

    // Create meeting via Zoom API
    const meetingResponse = await axios.post(
      `https://api.zoom.us/v2/users/me/meetings`,
      meetingData,
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
      }
    );

    const meeting = meetingResponse.data;
    console.log('✅ Zoom meeting created:', {
      id: meeting.id,
      topic: meeting.topic,
      duration: meeting.duration,
      requestedDuration,
      actualDuration: meeting.duration
    });

    // Store meeting in database with CORRECT duration
    try {
      const savedMeeting = await storeZoomMeetingDetails({
        ...meeting,
        duration: requestedDuration, // Ensure we save the REQUESTED duration
        metadata: {
          createdBy: req.body.hostEmail || 'system',
          department: req.body.department,
          course: req.body.course,
          session: req.body.session,
          tags: req.body.tags || [],
          originalDuration: requestedDuration // Store original requested duration
        }
      });
      
      console.log('💾 Meeting saved to database:', {
        id: savedMeeting.meetingId,
        duration: savedMeeting.duration,
        requestedDuration
      });
    } catch (dbError) {
      console.error('❌ Failed to store meeting details:', dbError);
    }

    // Store in global state for real-time tracking
    if (globalState) {
      const meetingInfo = {
        ...meeting,
        duration: requestedDuration, // Use requested duration in global state
        createdAt: new Date().toISOString(),
        status: 'created',
        originalDuration: requestedDuration
      };
      
      globalState.activeMeetings.set(meeting.id.toString(), meetingInfo);
      globalState.meetingAnalytics.totalMeetings++;
      globalState.meetingAnalytics.activeNow = globalState.activeMeetings.size;
    }

    // Send real-time notification
    if (io && globalState) {
      const notification = {
        id: Date.now(),
        type: 'meeting_created',
        title: '🎥 Meeting Created',
        message: `Meeting "${meeting.topic}" created for ${requestedDuration} minutes`,
        timestamp: new Date().toISOString(),
        meetingId: meeting.id.toString(),
        duration: requestedDuration
      };
      
      globalState.notifications.push(notification);
      io.emit('notification', notification);
      io.emit('meetingCreated', { 
        meeting: {
          ...meeting,
          duration: requestedDuration,
          originalDuration: requestedDuration
        }, 
        timestamp: new Date().toISOString() 
      });
    }

    // Return response with CORRECT duration
    res.json({
      ...meeting,
      duration: requestedDuration, // Ensure response shows correct duration
      success: true,
      message: `Meeting created successfully for ${requestedDuration} minutes`,
      originalDuration: requestedDuration,
      zoomDuration: meeting.duration
    });

  } catch (error) {
    console.error('Enhanced create meeting error:', error.response?.data || error);
    res.status(500).json({
      success: false,
      error: error.response?.data?.message || error.message,
      details: error.response?.data
    });
  }
});

// Get Zoom access token helper
async function getZoomAccessToken() {
  const response = await axios.post(
    `https://zoom.us/oauth/token?grant_type=account_credentials&account_id=${process.env.ZOOM_ACCOUNT_ID}`,
    {},
    {
      headers: {
        Authorization: `Basic ${Buffer.from(`${process.env.ZOOM_CLIENT_ID}:${process.env.ZOOM_CLIENT_SECRET}`).toString('base64')}`,
        'Content-Type': 'application/x-www-form-urlencoded'
      }
    }
  );
  return response.data.access_token;
}

module.exports = router;
