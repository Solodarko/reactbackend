const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const axios = require('axios');
const ZoomMeeting = require('../models/ZoomMeeting');
const ZoomAttendance = require('../models/ZoomAttendance');
const AttendanceSession = require('../models/AttendanceSession');
const auth = require('../middleware/auth');
const attendanceTrackingService = require('../services/attendanceTrackingService');

// Middleware to validate user token
const validateUserToken = async (req, res, next) => {
  try {
    const token = req.headers.authorization?.replace('Bearer ', '');
    if (!token) {
      return res.status(401).json({
        success: false,
        error: 'No authentication token provided'
      });
    }

    // Verify JWT token
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.user = decoded;
    req.userToken = token;
    
    console.log('🔐 User authenticated:', { userId: decoded.userId, username: decoded.username });
    next();
  } catch (error) {
    console.error('❌ Token validation failed:', error.message);
    res.status(401).json({
      success: false,
      error: 'Invalid authentication token'
    });
  }
};

// Get available meetings for user
router.get('/meetings/available', validateUserToken, async (req, res) => {
  try {
    console.log('📋 Fetching available meetings for user:', req.user.userId);

    // Get active meetings from database and global state
    const activeMeetings = await ZoomMeeting.find({
      status: { $in: ['started', 'waiting'] }
    }).sort({ created_at: -1 }).limit(20);

    // Also check global state for webhook-tracked meetings
    const globalMeetings = global.activeMeetings || {};
    const webhookMeetings = Object.values(globalMeetings).filter(meeting => 
      meeting.status === 'started' || meeting.status === 'waiting'
    );

    // Combine and deduplicate meetings
    const allMeetings = [...activeMeetings];
    
    webhookMeetings.forEach(webhookMeeting => {
      const exists = allMeetings.find(m => m.id === webhookMeeting.id);
      if (!exists) {
        allMeetings.push({
          id: webhookMeeting.id,
          topic: webhookMeeting.topic,
          status: webhookMeeting.status,
          created_at: webhookMeeting.start_time || new Date(),
          join_url: webhookMeeting.join_url,
          password: webhookMeeting.password
        });
      }
    });

    console.log('✅ Found available meetings:', {
      database: activeMeetings.length,
      webhooks: webhookMeetings.length,
      total: allMeetings.length
    });

    res.json({
      success: true,
      meetings: allMeetings.slice(0, 10), // Return top 10 meetings
      count: allMeetings.length
    });

  } catch (error) {
    console.error('❌ Error fetching available meetings:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch available meetings'
    });
  }
});

// Join meeting with attendance tracking
router.post('/meeting/join-with-tracking', validateUserToken, async (req, res) => {
  try {
    const { meetingId, password, userInfo } = req.body;
    const token = req.userToken;

    if (!meetingId) {
      return res.status(400).json({
        success: false,
        error: 'Meeting ID is required'
      });
    }

    console.log('🚀 User joining meeting with tracking:', {
      userId: req.user.userId,
      meetingId,
      userInfo: userInfo?.name || 'Unknown'
    });

    // Use attendance tracking service
    const result = await attendanceTrackingService.startTracking(
      token,
      meetingId,
      userInfo || {},
      {
        userAgent: req.headers['user-agent'],
        ipAddress: req.ip,
        meetingData: {
          password: password,
          join_url: `https://zoom.us/j/${meetingId}`
        }
      }
    );

    // Emit socket event for real-time updates
    const io = req.app.get('io');
    if (io) {
      io.emit('userJoinedMeeting', {
        meeting: result.meeting,
        user: {
          userId: result.user.userId,
          name: userInfo?.name || result.user.username,
          email: userInfo?.email || result.user.email
        },
        attendanceSession: result.attendanceSession,
        timestamp: new Date()
      });
      
      console.log('📡 Emitted userJoinedMeeting event');
    }

    console.log('✅ User successfully joined meeting with tracking');

    res.json({
      success: true,
      message: result.message,
      meeting: result.meeting,
      attendanceSession: result.attendanceSession,
      joinUrl: result.meeting.join_url,
      alreadyActive: result.alreadyActive || false
    });

  } catch (error) {
    console.error('❌ Error joining meeting with tracking:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to join meeting'
    });
  }
});

// Leave meeting with attendance tracking
router.post('/meeting/leave-with-tracking', validateUserToken, async (req, res) => {
  try {
    const { meetingId, attendanceSessionId } = req.body;
    const token = req.userToken;

    if (!attendanceSessionId) {
      return res.status(400).json({
        success: false,
        error: 'Attendance session ID is required'
      });
    }

    console.log('👋 User leaving meeting:', { 
      userId: req.user.userId, 
      meetingId, 
      attendanceSessionId 
    });

    // Use attendance tracking service
    const result = await attendanceTrackingService.stopTracking(
      token,
      meetingId,
      attendanceSessionId
    );

    // Get meeting info for socket event
    const meeting = await ZoomMeeting.findOne({ id: meetingId });

    // Emit socket event for real-time updates
    const io = req.app.get('io');
    if (io) {
      io.emit('userLeftMeeting', {
        meeting: meeting,
        user: {
          userId: req.user.userId,
          name: result.attendanceSession.userName,
          email: result.attendanceSession.userEmail
        },
        duration: result.duration,
        timestamp: new Date()
      });
      
      console.log('📡 Emitted userLeftMeeting event');
    }

    console.log('✅ User successfully left meeting:', { duration: `${result.duration} minutes` });

    res.json({
      success: true,
      message: result.message,
      duration: result.duration,
      attendanceSession: result.attendanceSession
    });

  } catch (error) {
    console.error('❌ Error leaving meeting:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to leave meeting'
    });
  }
});

// Get user's attendance history
router.get('/attendance/history', validateUserToken, async (req, res) => {
  try {
    const userId = req.user.userId;
    const { limit = 20, skip = 0 } = req.query;

    console.log('📊 Fetching attendance history for user:', userId);

    const attendanceHistory = await ZoomAttendance.find({ userId })
      .sort({ joinTime: -1 })
      .limit(parseInt(limit))
      .skip(parseInt(skip));

    const sessions = await AttendanceSession.find({ userId })
      .sort({ joinTime: -1 })
      .limit(parseInt(limit))
      .skip(parseInt(skip));

    res.json({
      success: true,
      attendance: attendanceHistory,
      sessions: sessions,
      count: attendanceHistory.length
    });

  } catch (error) {
    console.error('❌ Error fetching attendance history:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch attendance history'
    });
  }
});

// Create a new meeting (admin function but with user token validation)
router.post('/meeting/create-with-tracking', validateUserToken, async (req, res) => {
  try {
    const {
      topic,
      agenda,
      duration = 60,
      password,
      settings = {}
    } = req.body;

    if (!topic) {
      return res.status(400).json({
        success: false,
        error: 'Meeting topic is required'
      });
    }

    console.log('🎬 Creating meeting with tracking:', {
      topic,
      creator: req.user.username,
      duration
    });

    // Create meeting via Zoom API
    const zoomApiUrl = 'https://api.zoom.us/v2/users/me/meetings';
    const zoomToken = process.env.ZOOM_API_TOKEN || process.env.ZOOM_ACCESS_TOKEN;

    if (!zoomToken) {
      return res.status(500).json({
        success: false,
        error: 'Zoom API token not configured'
      });
    }

    const meetingPayload = {
      topic,
      agenda,
      type: 1, // Instant meeting
      duration,
      password: password || undefined,
      settings: {
        host_video: settings.hostVideo !== false,
        participant_video: settings.participantVideo !== false,
        mute_upon_entry: settings.muteOnEntry !== false,
        waiting_room: settings.waitingRoom === true,
        auto_recording: settings.recording || 'none',
        ...settings
      }
    };

    const zoomResponse = await axios.post(zoomApiUrl, meetingPayload, {
      headers: {
        'Authorization': `Bearer ${zoomToken}`,
        'Content-Type': 'application/json'
      }
    });

    const zoomMeeting = zoomResponse.data;

    // Save meeting to database
    const meeting = new ZoomMeeting({
      id: zoomMeeting.id.toString(),
      topic: zoomMeeting.topic,
      agenda: zoomMeeting.agenda,
      status: 'waiting',
      host_id: zoomMeeting.host_id,
      join_url: zoomMeeting.join_url,
      password: zoomMeeting.password,
      start_url: zoomMeeting.start_url,
      start_time: new Date(zoomMeeting.start_time),
      duration: zoomMeeting.duration,
      created_at: new Date(),
      created_by: req.user.userId,
      created_by_name: req.user.username,
      settings: zoomMeeting.settings
    });

    await meeting.save();

    // Emit socket event
    const io = req.app.get('io');
    if (io) {
      io.emit('meetingCreated', {
        meeting: meeting,
        creator: {
          userId: req.user.userId,
          name: req.user.username
        },
        timestamp: new Date()
      });
      
      console.log('📡 Emitted meetingCreated event');
    }

    console.log('✅ Meeting created successfully:', zoomMeeting.id);

    res.json({
      success: true,
      message: 'Meeting created successfully',
      meeting: meeting,
      zoomData: {
        id: zoomMeeting.id,
        join_url: zoomMeeting.join_url,
        start_url: zoomMeeting.start_url,
        password: zoomMeeting.password
      }
    });

  } catch (error) {
    console.error('❌ Error creating meeting:', error);
    
    if (error.response?.status === 401) {
      return res.status(401).json({
        success: false,
        error: 'Zoom API authentication failed. Please check API token.'
      });
    }

    res.status(500).json({
      success: false,
      error: error.message || 'Failed to create meeting'
    });
  }
});

// Get current user attendance status
router.get('/attendance/status', validateUserToken, async (req, res) => {
  try {
    const userId = req.user.userId;

    // Find active attendance session
    const activeSession = await AttendanceSession.findOne({
      userId: userId,
      status: 'active'
    }).populate('meetingId');

    if (activeSession) {
      const meeting = await ZoomMeeting.findOne({ id: activeSession.meetingId });
      
      res.json({
        success: true,
        inMeeting: true,
        activeSession: activeSession,
        meeting: meeting
      });
    } else {
      res.json({
        success: true,
        inMeeting: false,
        activeSession: null,
        meeting: null
      });
    }

  } catch (error) {
    console.error('❌ Error checking attendance status:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to check attendance status'
    });
  }
});

module.exports = router;
