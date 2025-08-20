const express = require('express');
const axios = require('axios');
const jwt = require('jsonwebtoken');
const cron = require('node-cron');
const moment = require('moment');
const ZoomMeeting = require('../models/ZoomMeeting');
const Attendance = require('../models/Attendance');
const Student = require('../models/Student');
const zoomService = require('../services/zoomService');
const meetingTerminationService = require('../services/meetingTerminationService');
const { trackParticipantJoin, trackParticipantLeave, storeZoomMeetingDetails } = require('../utils/zoomSdkTracker');
const rateLimiter = require('../utils/rateLimiter');
const zoomRequestQueue = require('../utils/zoomRequestQueue');

const router = express.Router();

const ZOOM_ACCOUNT_ID = process.env.ZOOM_ACCOUNT_ID;
const ZOOM_CLIENT_ID = process.env.ZOOM_CLIENT_ID;
const ZOOM_CLIENT_SECRET = process.env.ZOOM_CLIENT_SECRET;

// Validate required environment variables
if (!ZOOM_ACCOUNT_ID || !ZOOM_CLIENT_ID || !ZOOM_CLIENT_SECRET) {
  console.error('❌ Missing required Zoom environment variables');
  console.error('Required: ZOOM_ACCOUNT_ID, ZOOM_CLIENT_ID, ZOOM_CLIENT_SECRET');
}

// Function to get OAuth access token for Zoom API with enhanced rate limiting
const getZoomAccessToken = async () => {
  return await zoomRequestQueue.enqueue(
    async () => {
      return await rateLimiter.getAccessToken(async () => {
        const response = await axios.post(
          `https://zoom.us/oauth/token?grant_type=account_credentials&account_id=${ZOOM_ACCOUNT_ID}`,
          {},
          {
            headers: {
              Authorization: `Basic ${Buffer.from(`${ZOOM_CLIENT_ID}:${ZOOM_CLIENT_SECRET}`).toString('base64')}`,
              'Content-Type': 'application/x-www-form-urlencoded'
            },
            timeout: 10000 // 10 second timeout
          }
        );
        return response.data.access_token;
      });
    },
    {
      category: 'user',
      priority: 2, // High priority for auth
      cacheKey: 'zoom_access_token',
      cacheTTL: 3300, // 55 minutes
      identifier: 'access-token',
      enableCache: true
    }
  );
};

// Generate JWT signature for Zoom Web SDK (Updated for SDK v3+)
const generateZoomSignature = (meetingNumber, role) => {
  const iat = Math.round(new Date().getTime() / 1000) - 30;
  const exp = iat + 60 * 60 * 2; // 2 hours
  
  const payload = {
    iss: ZOOM_CLIENT_ID,
    exp,
    iat,
    aud: 'zoom',
    appKey: ZOOM_CLIENT_ID,
    tokenExp: exp,
    alg: 'HS256'
  };
  
  // Add meeting-specific claims if provided
  if (meetingNumber) {
    payload.meetingNumber = meetingNumber.toString();
  }
  if (typeof role !== 'undefined') {
    payload.role = parseInt(role) || 0;
  }
  
  try {
    return jwt.sign(payload, ZOOM_CLIENT_SECRET, { algorithm: 'HS256' });
  } catch (error) {
    console.error('Error generating JWT signature:', error);
    throw new Error('Failed to generate meeting signature');
  }
};

// Route to create a Zoom meeting with real-time integration
router.post('/create-meeting', async (req, res) => {
  try {
    const accessToken = await getZoomAccessToken();
    const io = req.app.get('io');
    const globalState = req.app.get('globalState');

    // First try to create an instant meeting for easier testing
    let meetingData = {
      topic: req.body.topic || 'New Meeting',
      type: 1, // Instant meeting (starts immediately)
      duration: req.body.duration || 5, // Set correct duration in minutes
      password: req.body.password || null, // Only set password if explicitly provided
      agenda: req.body.agenda || '',
      settings: {
        host_video: req.body.settings?.host_video !== undefined ? req.body.settings.host_video : true,
        participant_video: req.body.settings?.participant_video !== undefined ? req.body.settings.participant_video : true,
        cn_meeting: false,
        in_meeting: false,
        join_before_host: true, // Allow participants to join before host
        mute_upon_entry: req.body.settings?.mute_upon_entry !== undefined ? req.body.settings.mute_upon_entry : true,
        watermark: false,
        use_pmi: false,
        approval_type: 0, // Automatically approve
        audio: 'both',
        auto_recording: req.body.settings?.auto_recording || 'none',
        waiting_room: req.body.settings?.waiting_room !== undefined ? req.body.settings.waiting_room : false,
        // Additional settings to ensure smooth joining
        registrants_confirmation_email: false,
        registrants_email_notification: false
      }
    };
    
    // If scheduled meeting is explicitly requested
    if (req.body.type === 2 || req.body.start_time) {
      meetingData.type = 2;
      meetingData.start_time = req.body.start_time || new Date(Date.now() + 5 * 60000).toISOString(); // 5 minutes from now
      meetingData.timezone = req.body.timezone || 'America/New_York';
    }

    try {
      const meetingResponse = await zoomRequestQueue.enqueue(
        async () => {
          return await axios.post(
            `https://api.zoom.us/v2/users/me/meetings`,
            meetingData,
            {
              headers: {
                Authorization: `Bearer ${accessToken}`,
                'Content-Type': 'application/json',
              },
            }
          );
        },
        {
          category: 'meeting',
          priority: 3,
          identifier: `create-meeting-${Date.now()}`,
          retryCount: 3
        }
      );
      
      // Store meeting details in database for tracking
      let savedMeeting = null;
      try {
        savedMeeting = await storeZoomMeetingDetails({
          ...meetingResponse.data,
          metadata: {
            createdBy: req.body.hostEmail || 'system',
            department: req.body.department,
            course: req.body.course,
            session: req.body.session,
            tags: req.body.tags || []
          }
        });
        console.log('✅ Scheduled meeting saved to database successfully');
      } catch (dbError) {
        console.error('❌ Failed to store scheduled meeting details:', dbError);
      }
      
      // Real-time notification for meeting creation
      if (io && globalState) {
        const meetingInfo = {
          ...meetingResponse.data,
          createdAt: new Date().toISOString(),
          status: 'scheduled',
          saved: !!savedMeeting
        };
        
        // Store in global state
        globalState.activeMeetings.set(meetingInfo.id, meetingInfo);
        globalState.meetingAnalytics.totalMeetings++;
        globalState.meetingAnalytics.activeNow = globalState.activeMeetings.size;
        
        // Send real-time notification
        const notification = {
          id: Date.now(),
          type: 'meeting_created',
          title: '📅 Scheduled Meeting Created',
          message: `Scheduled meeting "${meetingInfo.topic}" has been created successfully`,
          timestamp: new Date().toISOString(),
          meetingId: meetingInfo.id,
          success: true
        };
        
        globalState.notifications.push(notification);
        io.emit('notification', notification);
        io.emit('meetingCreated', { 
          meeting: meetingInfo, 
          savedMeeting: savedMeeting,
          timestamp: new Date().toISOString() 
        });
      }
      
      // Schedule automatic termination after the duration
      const meetingDuration = meetingResponse.data.duration || 5;
      try {
        const terminationTime = meetingTerminationService.scheduleMeetingTermination(
          meetingResponse.data.id.toString(),
          meetingDuration
        );
        console.log(`⏰ Scheduled automatic termination for meeting ${meetingResponse.data.id} in ${meetingDuration} minutes`);
      } catch (terminationError) {
        console.error('❌ Failed to schedule meeting termination:', terminationError.message);
      }
      
      // Return comprehensive response with both Zoom API data and database info
      const responseData = {
        ...meetingResponse.data,
        success: true,
        saved: !!savedMeeting,
        database_id: savedMeeting?._id,
        created_at: new Date().toISOString(),
        message: 'Scheduled meeting created and saved successfully',
        autoTermination: {
          enabled: true,
          duration: meetingDuration,
          message: `Meeting will be automatically terminated after ${meetingDuration} minutes`
        }
      };
      
      res.json(responseData);
    } catch (scheduleError) {
      // If scheduled meeting fails due to scope issues, try instant meeting
      console.log('Scheduled meeting failed, trying instant meeting:', scheduleError.response?.data);
      
      if (scheduleError.response?.data?.code === 4711) {
        // Permission error - try instant meeting
        meetingData.type = 1; // Instant meeting
        delete meetingData.start_time;
        delete meetingData.timezone;
        
        try {
          const instantMeetingResponse = await zoomRequestQueue.enqueue(
            async () => {
              return await axios.post(
                `https://api.zoom.us/v2/users/me/meetings`,
                meetingData,
                {
                  headers: {
                    Authorization: `Bearer ${accessToken}`,
                    'Content-Type': 'application/json',
                  },
                }
              );
            },
            {
              category: 'meeting',
              priority: 3,
              identifier: `create-instant-meeting-${Date.now()}`,
              retryCount: 3
            }
          );
          
          // Store meeting details in database for tracking
          let savedMeeting = null;
          try {
            savedMeeting = await storeZoomMeetingDetails({
              ...instantMeetingResponse.data,
              metadata: {
                createdBy: req.body.hostEmail || 'system',
                department: req.body.department,
                course: req.body.course,
                session: req.body.session,
                tags: req.body.tags || []
              }
            });
            console.log('✅ Meeting saved to database successfully');
          } catch (dbError) {
            console.error('❌ Failed to store meeting details:', dbError);
          }
          
          // Real-time notification for meeting creation
          if (io && globalState) {
            const meetingInfo = {
              ...instantMeetingResponse.data,
              createdAt: new Date().toISOString(),
              status: 'active',
              saved: !!savedMeeting
            };
            
            // Store in global state
            globalState.activeMeetings.set(meetingInfo.id, meetingInfo);
            globalState.meetingAnalytics.totalMeetings++;
            globalState.meetingAnalytics.activeNow = globalState.activeMeetings.size;
            
            // Send real-time notification
            const notification = {
              id: Date.now(),
              type: 'meeting_created',
              title: '🎥 Zoom Meeting Created',
              message: `Meeting "${meetingInfo.topic}" has been created successfully`,
              timestamp: new Date().toISOString(),
              meetingId: meetingInfo.id,
              success: true
            };
            
            globalState.notifications.push(notification);
            io.emit('notification', notification);
            io.emit('meetingCreated', { 
              meeting: meetingInfo, 
              savedMeeting: savedMeeting,
              timestamp: new Date().toISOString() 
            });
          }
          
          // Schedule automatic termination for the instant meeting too
          const meetingDuration = instantMeetingResponse.data.duration || 5;
          try {
            const terminationTime = meetingTerminationService.scheduleMeetingTermination(
              instantMeetingResponse.data.id.toString(),
              meetingDuration
            );
            console.log(`⏰ Scheduled automatic termination for instant meeting ${instantMeetingResponse.data.id} in ${meetingDuration} minutes`);
          } catch (terminationError) {
            console.error('❌ Failed to schedule instant meeting termination:', terminationError.message);
          }
          
          // Return comprehensive response with both Zoom API data and database info
          const responseData = {
            ...instantMeetingResponse.data,
            success: true,
            saved: !!savedMeeting,
            database_id: savedMeeting?._id,
            created_at: new Date().toISOString(),
            message: 'Meeting created and saved successfully',
            autoTermination: {
              enabled: true,
              duration: meetingDuration,
              message: `Meeting will be automatically terminated after ${meetingDuration} minutes`
            }
          };
          
          // Auto-start attendance tracking for the new meeting
          try {
            const AttendanceTracker = require('../services/attendanceTracker');
            const attendanceTracker = new AttendanceTracker();
            
            console.log(`🎯 Auto-starting attendance tracking for new meeting: ${instantMeetingResponse.data.id}`);
            
            // Start tracking after a short delay to allow meeting to be fully created
            setTimeout(async () => {
              try {
                const trackingResult = await attendanceTracker.startTrackingMeeting(instantMeetingResponse.data.id.toString());
                if (trackingResult) {
                  console.log(`✅ Auto-started tracking for meeting: ${instantMeetingResponse.data.id}`);
                } else {
                  console.log(`⚠️ Could not auto-start tracking for meeting: ${instantMeetingResponse.data.id} (meeting may not be active yet)`);
                }
              } catch (trackingError) {
                console.warn(`⚠️ Auto-tracking failed for meeting ${instantMeetingResponse.data.id}:`, trackingError.message);
              }
            }, 5000); // 5 second delay
            
          } catch (autoTrackError) {
            console.warn('⚠️ Could not initialize auto-tracking:', autoTrackError.message);
          }
          
          res.json(responseData);
        } catch (instantError) {
          console.error('Instant meeting also failed:', instantError.response?.data);
          return res.status(400).json({ 
            error: 'Meeting creation failed. Please check your Zoom app permissions.',
            message: 'Your Zoom app needs "meeting:write:meeting" and "meeting:write:meeting:admin" scopes.',
            zoomError: instantError.response?.data || instantError.message
          });
        }
      } else {
        // Handle other errors
        console.error('Scheduled meeting error:', scheduleError.response?.data);
        return res.status(400).json({
          error: 'Meeting creation failed',
          message: scheduleError.response?.data?.message || scheduleError.message,
          zoomError: scheduleError.response?.data || scheduleError.message
        });
      }
    }
  } catch (error) {
    console.error('Error creating Zoom meeting:', error.response ? error.response.data : error.message);
    res.status(500).json({ 
      error: error.response?.data?.message || error.message,
      details: error.response?.data
    });
  }
});

// Route to get JWT token for Zoom Web SDK
router.post('/get-token', async (req, res) => {
  try {
    const { meetingNumber, role } = req.body;
    const token = generateZoomSignature(meetingNumber, role || 0);
    res.json({ 
      token,
      sdkKey: ZOOM_CLIENT_ID
    });
  } catch (error) {
    console.error('Error generating JWT token:', error);
    res.status(500).json({ error: 'Failed to generate token' });
  }
});

// Route to get meeting details
router.get('/meeting/:meetingId', async (req, res) => {
  try {
    const accessToken = await getZoomAccessToken();
    const { meetingId } = req.params;

    const meetingResponse = await zoomRequestQueue.enqueue(
      async () => {
        return await axios.get(
          `https://api.zoom.us/v2/meetings/${meetingId}`,
          {
            headers: {
              Authorization: `Bearer ${accessToken}`,
              'Content-Type': 'application/json',
            },
          }
        );
      },
      {
        category: 'meeting',
        priority: 2,
        identifier: `get-meeting-${meetingId}`,
        cacheKey: `meeting_${meetingId}`,
        cacheTTL: 300,
        enableCache: true
      }
    );

    res.json(meetingResponse.data);
  } catch (error) {
    console.error('Error getting meeting details:', error.response ? error.response.data : error.message);
    res.status(500).json({ error: error.message });
  }
});

// Route to get meeting participants
router.get('/meeting/:meetingId/participants', async (req, res) => {
  try {
    const accessToken = await getZoomAccessToken();
    const { meetingId } = req.params;

    const participantsResponse = await zoomRequestQueue.enqueue(
      async () => {
        return await axios.get(
          `https://api.zoom.us/v2/meetings/${meetingId}/participants`,
          {
            headers: {
              Authorization: `Bearer ${accessToken}`,
              'Content-Type': 'application/json',
            },
          }
        );
      },
      {
        category: 'meeting',
        priority: 2,
        identifier: `get-participants-${meetingId}`,
        cacheKey: `participants_${meetingId}`,
        cacheTTL: 60,
        enableCache: true
      }
    );

    res.json(participantsResponse.data);
  } catch (error) {
    console.error('Error getting meeting participants:', error.response ? error.response.data : error.message);
    res.status(500).json({ error: error.message });
  }
});

// Route to end a meeting
router.patch('/meeting/:meetingId/end', async (req, res) => {
  try {
    const accessToken = await getZoomAccessToken();
    const { meetingId } = req.params;

    const endResponse = await zoomRequestQueue.enqueue(
      async () => {
        return await axios.patch(
          `https://api.zoom.us/v2/meetings/${meetingId}/status`,
          { action: 'end' },
          {
            headers: {
              Authorization: `Bearer ${accessToken}`,
              'Content-Type': 'application/json',
            },
          }
        );
      },
      {
        category: 'meeting',
        priority: 1, // High priority for ending meetings
        identifier: `end-meeting-${meetingId}`,
        retryCount: 2
      }
    );

    res.json({ message: 'Meeting ended successfully' });
  } catch (error) {
    console.error('Error ending meeting:', error.response ? error.response.data : error.message);
    res.status(500).json({ error: error.message });
  }
});

// Route to get meeting attendance report
router.get('/report/:meetingId/participants', async (req, res) => {
  try {
    const accessToken = await getZoomAccessToken();
    const { meetingId } = req.params;

    const reportResponse = await zoomRequestQueue.enqueue(
      async () => {
        return await axios.get(
          `https://api.zoom.us/v2/report/meetings/${meetingId}/participants`,
          {
            headers: {
              Authorization: `Bearer ${accessToken}`,
              'Content-Type': 'application/json',
            },
          }
        );
      },
      {
        category: 'report',
        priority: 3,
        identifier: `report-participants-${meetingId}`,
        cacheKey: `report_${meetingId}`,
        cacheTTL: 600,
        enableCache: true
      }
    );

    res.json(reportResponse.data);
  } catch (error) {
    console.error('Error getting meeting report:', error.response ? error.response.data : error.message);
    res.status(500).json({ error: error.message });
  }
});

// Route to generate signature for Zoom Web SDK
router.post('/generate-signature', async (req, res) => {
  try {
    const { meetingNumber, role } = req.body;
    
    if (!meetingNumber) {
      return res.status(400).json({ error: 'Meeting number is required' });
    }
    
    const signature = generateZoomSignature(meetingNumber, role || 0);
    
    res.json({ 
      signature,
      sdkKey: ZOOM_CLIENT_ID,
      meetingNumber: meetingNumber.toString(),
      role: parseInt(role) || 0
    });
  } catch (error) {
    console.error('Error generating signature:', error);
    res.status(500).json({ error: 'Failed to generate signature' });
  }
});

// Route to validate Zoom credentials
router.get('/validate-credentials', async (req, res) => {
  try {
    const accessToken = await getZoomAccessToken();
    console.log('Successfully retrieved Zoom access token');
    
    // Test the token by making a simple API call
    const userResponse = await zoomRequestQueue.enqueue(
      async () => {
        return await axios.get(
          'https://api.zoom.us/v2/users/me',
          {
            headers: {
              Authorization: `Bearer ${accessToken}`,
              'Content-Type': 'application/json',
            },
          }
        );
      },
      {
        category: 'user',
        priority: 2,
        identifier: 'validate-credentials',
        cacheKey: 'user_me',
        cacheTTL: 300,
        enableCache: true
      }
    );

    res.json({ 
      valid: true, 
      user: userResponse.data.first_name + ' ' + userResponse.data.last_name,
      email: userResponse.data.email
    });
  } catch (error) {
    console.error('Error validating credentials:', error.response ? error.response.data : error.message);
    res.status(500).json({ valid: false, error: error.message });
  }
});

// Route to proxy meetings from /api/meetings to /api/zoom/meetings
router.get('/meetings', async (req, res) => {
  try {
    console.log('📋 Proxy endpoint: Forwarding to /api/meetings');
    
    // Forward the query parameters
    const { status, type } = req.query;
    
    let query = {};
    
    // Filter by status if provided
    if (status) {
      query.status = status;
    }
    
    // Filter by type if provided
    if (type) {
      query['metadata.meetingType'] = type;
    }
    
    const ZoomMeeting = require('../models/ZoomMeeting');
    const meetings = await ZoomMeeting.find(query)
      .sort({ createdAt: -1 })
      .lean();
    
    // Transform data for Frontend compatibility
    const transformedMeetings = meetings.map(meeting => ({
      id: meeting.meetingId,
      topic: meeting.topic,
      status: meeting.status,
      start_time: meeting.startTime,
      created_at: meeting.createdAt,
      join_url: meeting.joinUrl,
      password: meeting.password,
      agenda: meeting.metadata?.agenda || '',
      settings: meeting.settings,
      host_email: meeting.hostEmail,
      participants: meeting.participants?.length || 0,
      uuid: meeting.meetingUuid,
      duration: meeting.duration
    }));
    
    res.json({
      success: true,
      meetings: transformedMeetings,
      total: transformedMeetings.length
    });
  } catch (error) {
    console.error('Error fetching meetings:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch meetings',
      error: error.message
    });
  }
});

// Route to get attendance reports for dashboard
router.get('/attendance-reports', async (req, res) => {
  try {
    console.log('📊 Fetching attendance reports for dashboard...');
    
    // Get data from different sources
    const attendanceRecords = [];
    
    try {
      // Try to get data from ZoomMeeting model
      const meetings = await ZoomMeeting.find({
        status: { $in: ['ended', 'completed'] },
        participants: { $exists: true, $ne: [] }
      }).sort({ createdAt: -1 }).limit(100);
      
      console.log(`Found ${meetings.length} completed meetings with participants`);
      
      // Extract participant data from meetings
      meetings.forEach(meeting => {
        if (meeting.participants && meeting.participants.length > 0) {
          meeting.participants.forEach(participant => {
            attendanceRecords.push({
              id: `${meeting._id}_${participant.participantId}`,
              studentId: participant.participantId,
              name: participant.name,
              email: participant.email,
              meetingId: meeting.meetingId,
              meetingTopic: meeting.topic,
              joinTime: participant.joinTime,
              leaveTime: participant.leaveTime,
              duration: participant.duration,
              attendanceStatus: participant.attendanceStatus,
              attendancePercentage: participant.attendancePercentage,
              attendanceGrade: participant.attendanceGrade,
              meetingDate: meeting.createdAt,
              timestamp: participant.updatedAt || meeting.createdAt
            });
          });
        }
      });
    } catch (dbError) {
      console.warn('Database query failed:', dbError.message);
    }
    
    // Also check Attendance model if it exists
    try {
      const attendanceData = await Attendance.find({})
        .populate('student', 'name email studentId')
        .sort({ createdAt: -1 })
        .limit(100);
      
      attendanceData.forEach(record => {
        attendanceRecords.push({
          id: record._id,
          studentId: record.student?.studentId || record.studentId,
          name: record.student?.name || record.name,
          email: record.student?.email || record.email,
          meetingId: record.meetingId,
          meetingTopic: record.meetingTopic || 'N/A',
          joinTime: record.joinTime,
          leaveTime: record.leaveTime,
          duration: record.duration,
          attendanceStatus: record.status || record.attendanceStatus,
          attendancePercentage: record.percentage || record.attendancePercentage,
          attendanceGrade: record.grade || record.attendanceGrade,
          meetingDate: record.meetingDate || record.createdAt,
          timestamp: record.createdAt
        });
      });
    } catch (attendanceError) {
      console.warn('Attendance model query failed:', attendanceError.message);
    }
    
    console.log(`📊 Returning ${attendanceRecords.length} attendance records`);
    
    res.json({
      success: true,
      records: attendanceRecords,
      total: attendanceRecords.length,
      message: `Found ${attendanceRecords.length} attendance records`
    });
    
  } catch (error) {
    console.error('Error fetching attendance reports:', error);
    res.status(500).json({
      success: false,
      error: error.message,
      records: [],
      message: 'Failed to fetch attendance reports'
    });
  }
});

// Route to track link clicks with real-time notifications (Enhanced)
router.post('/track-link-click', async (req, res) => {
  try {
    const io = req.app.get('io');
    const globalState = req.app.get('globalState');
    
    const {
      meetingId,
      meetingTopic,
      name,
      email,
      studentId,
      userId,
      clickTime,
      joinUrl,
      userAgent,
      platform,
      language
    } = req.body;
    
    const clickData = {
      ...req.body,
      id: require('uuid').v4(),
      serverTimestamp: new Date().toISOString(),
      deviceInfo: {
        userAgent,
        platform,
        language
      }
    };

    console.log('📊 Enhanced link click tracked:', {
      meetingId,
      meetingTopic,
      name,
      email,
      studentId,
      userId,
      clickTime,
      deviceInfo: { userAgent, platform, language }
    });

    // Send real-time notification
    if (io && globalState) {
      const notification = {
        id: Date.now(),
        type: 'link_click',
        title: '🔗 Zoom Link Clicked',
        message: `${name} (${studentId}) clicked the Zoom link for "${meetingTopic}"`,
        timestamp: new Date().toISOString(),
        meetingId: meetingId,
        studentId: studentId,
        userId: userId
      };

      globalState.notifications.push(notification);
      io.emit('notification', notification);

      // Broadcast link click event
      io.emit('linkClicked', {
        clickData,
        timestamp: new Date().toISOString()
      });
    }

    res.json({
      success: true,
      clickData,
      message: 'Enhanced link click tracked successfully',
      trackingId: `click_${meetingId}_${userId}_${Date.now()}`
    });
  } catch (error) {
    console.error('Error tracking link click:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Route to track participant joining via SDK (Enhanced for immediate dashboard tracking)
router.post('/track-participant-join', async (req, res) => {
  try {
    const {
      meetingId,
      name,
      email,
      userId,
      studentId,
      joinTime,
      source,
      userInfo
    } = req.body;
    
    if (!meetingId) {
      return res.status(400).json({
        success: false,
        error: 'Meeting ID is required'
      });
    }
    
    console.log('🚀 Enhanced participant join tracking:', {
      meetingId,
      name,
      email,
      userId,
      studentId,
      joinTime,
      source,
      userInfo
    });
    
    // Find or create meeting document
    let meeting = await ZoomMeeting.findOne({ meetingId });
    if (!meeting) {
      console.log('⚠️ Meeting not found in database, creating placeholder...');
      meeting = new ZoomMeeting({
        meetingId,
        topic: `Meeting ${meetingId}`,
        status: 'started',
        participants: [],
        createdAt: new Date()
      });
    }
    
    // Check if participant already exists
    const existingParticipant = meeting.participants.find(
      p => p.email === email || p.userId === userId
    );
    
    if (existingParticipant) {
      console.log('👤 Participant already tracked, updating join time...');
      existingParticipant.joinTime = new Date(joinTime);
      existingParticipant.source = source;
      existingParticipant.userInfo = userInfo;
      existingParticipant.status = 'joined';
    } else {
      console.log('👤 New participant joining, adding to tracking...');
      meeting.participants.push({
        name,
        email,
        userId,
        studentId,
        joinTime: new Date(joinTime),
        source,
        userInfo,
        status: 'joined'
      });
    }
    
    // Save meeting with updated participants
    await meeting.save();
    
    // Also track using the existing trackParticipantJoin function for compatibility
    try {
      const trackedMeeting = await trackParticipantJoin({
        meetingId,
        name,
        email,
        userId,
        joinTime: joinTime ? new Date(joinTime) : new Date()
      });
    } catch (trackingError) {
      console.warn('Legacy tracking failed (non-critical):', trackingError.message);
    }
    
    // Immediately create attendance record in database for admin dashboard
    try {
      const Participant = require('../models/Participant');
      const Student = require('../models/Student');
      
      // Check if student exists
      let student = null;
      if (studentId) {
        student = await Student.findOne({ StudentID: studentId });
      }
      
      // Create or update participant record immediately
      let participant = await Participant.findOne({ 
        meetingId, 
        $or: [
          { email },
          { userId },
          { studentId }
        ]
      });
      
      const joinTimeDate = new Date(joinTime);
      
      if (participant) {
        // Update existing participant
        participant.joinTime = joinTimeDate;
        participant.source = source;
        participant.attendanceStatus = 'present';
        participant.duration = 0;
        participant.isActive = true;
        participant.lastActivity = new Date();
        participant.userInfo = userInfo;
        
        // Update student information if found
        if (student) {
          participant.studentId = student._id;
          participant.studentFirstName = student.FirstName;
          participant.studentLastName = student.LastName;
          participant.studentEmail = student.Email;
          participant.studentDepartment = student.Department;
        }
      } else {
        // Create new participant record
        participant = new Participant({
          meetingId,
          participantId: `dashboard_${userId}_${Date.now()}`,
          participantName: name,
          email,
          userId,
          studentId,
          joinTime: joinTimeDate,
          source,
          attendanceStatus: 'present',
          duration: 0,
          isActive: true,
          lastActivity: new Date(),
          userInfo,
          zoomUserId: userId,
          // Student information if found
          studentId: student ? student._id : null,
          studentFirstName: student ? student.FirstName : null,
          studentLastName: student ? student.LastName : null,
          studentEmail: student ? student.Email : null,
          studentDepartment: student ? student.Department : null
        });
      }
      
      await participant.save();
      console.log('✅ Participant record created/updated in database immediately');
      
    } catch (dbError) {
      console.error('❌ Error creating immediate participant record:', dbError.message);
    }
    
    // Send real-time notification and admin dashboard update
    const io = req.app.get('io');
    const globalState = req.app.get('globalState');
    
    try {
      if (io && globalState) {
      const notification = {
        id: Date.now(),
        type: 'participant_joined',
        title: '👋 Participant Joined',
        message: `${name} (${studentId}) joined meeting "${meeting.topic}"`,
        timestamp: new Date().toISOString(),
        meetingId: meetingId,
        participantData: { name, email, userId, studentId }
      };
      
      globalState.notifications.push(notification);
      io.emit('notification', notification);
      
      // Emit to meeting room
      io.to(`meeting_${meetingId}`).emit('participantJoined', {
        participant: {
          name,
          email,
          userId,
          studentId,
          joinTime,
          source
        },
        meetingId,
        participantCount: meeting.participants.filter(p => p.status === 'joined').length,
        timestamp: new Date().toISOString()
      });
      
      // IMMEDIATE ADMIN DASHBOARD UPDATE - Force refresh of attendance data
      io.emit('participantJoinedImmediate', {
        meetingId,
        participant: {
          participantName: name,
          email,
          userId,
          studentId,
          joinTime,
          source: 'user_dashboard',
          attendanceStatus: 'present',
          duration: 0,
          isActive: true,
          isAuthenticated: !!userId,
          authenticatedUser: userId ? { username: name, email, role: 'student' } : null
        },
        timestamp: new Date().toISOString(),
        actionRequired: 'refresh_attendance_table'
      });
      
      console.log('🚀 Real-time admin dashboard update broadcasted');
      
      // Broadcast to all connected clients
      io.emit('participantUpdate', {
        action: 'joined',
        meetingId,
        participant: {
          name,
          email,
          userId,
          studentId,
          joinTime,
          source,
          userInfo
        }
      });
      }
    } catch (ioError) {
      console.error('❌ Error emitting WebSocket events:', ioError.message);
    }
    
    console.log('✅ Enhanced participant join tracked successfully');
    
    res.json({
      success: true,
      message: 'Enhanced participant join tracked immediately',
      participantCount: meeting.participants.filter(p => p.status === 'joined').length,
      trackingId: `join_${meetingId}_${userId}_${Date.now()}`,
      timestamp: new Date().toISOString()
    });
    
  } catch (error) {
    console.error('❌ Error tracking enhanced participant join:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to track participant join',
      details: error.message
    });
  }
});

// Route to track participant leaving via SDK (Enhanced for immediate dashboard tracking)
router.post('/track-participant-leave', async (req, res) => {
  try {
    const { meetingId, userId, email, leaveTime, source } = req.body;
    
    if (!meetingId) {
      return res.status(400).json({
        success: false,
        error: 'Meeting ID is required'
      });
    }
    
    console.log('👋 Enhanced participant leave tracking:', {
      meetingId,
      userId,
      email,
      leaveTime,
      source
    });
    
    // Find meeting document
    const meeting = await ZoomMeeting.findOne({ meetingId });
    if (!meeting) {
      console.log('⚠️ Meeting not found for leave tracking');
      return res.status(404).json({
        success: false,
        error: 'Meeting not found'
      });
    }
    
    // Find participant
    const participant = meeting.participants.find(
      p => p.email === email || p.userId === userId
    );
    
    if (participant) {
      participant.leaveTime = new Date(leaveTime);
      participant.status = 'left';
      participant.leaveSource = source;
      
      // Calculate duration if join time exists
      if (participant.joinTime) {
        const duration = new Date(leaveTime) - new Date(participant.joinTime);
        participant.duration = Math.round(duration / 1000 / 60); // duration in minutes
      }
      
      await meeting.save();
      
      // Also track using the existing trackParticipantLeave function for compatibility
      try {
        const legacyMeeting = await trackParticipantLeave({
          meetingId,
          userId,
          email,
          leaveTime: leaveTime ? new Date(leaveTime) : new Date()
        });
      } catch (trackingError) {
        console.warn('Legacy leave tracking failed (non-critical):', trackingError.message);
      }
      
      // Send real-time notification
      const io = req.app.get('io');
      const globalState = req.app.get('globalState');
      
      if (io && globalState) {
        const notification = {
          id: Date.now(),
          type: 'participant_left',
          title: '👋 Participant Left',
          message: `${participant.name} left meeting "${meeting.topic}" after ${participant.duration} minutes`,
          timestamp: new Date().toISOString(),
          meetingId: meetingId,
          participantData: { 
            name: participant.name, 
            email: participant.email, 
            duration: participant.duration,
            userId: participant.userId,
            studentId: participant.studentId
          }
        };
        
        globalState.notifications.push(notification);
        io.emit('notification', notification);
        io.to(`meeting_${meetingId}`).emit('participantLeft', {
          participant: {
            name: participant.name,
            email: participant.email,
            userId: participant.userId,
            studentId: participant.studentId,
            duration: participant.duration,
            leaveTime,
            source
          },
          participantCount: meeting.participants.filter(p => p.status === 'joined').length,
          timestamp: new Date().toISOString()
        });
        
        // Broadcast to all connected clients
        io.emit('participantUpdate', {
          action: 'left',
          meetingId,
          participant: {
            name: participant.name,
            email: participant.email,
            userId: participant.userId,
            studentId: participant.studentId,
            duration: participant.duration,
            leaveTime,
            source
          }
        });
      }
      
      console.log('✅ Enhanced participant leave tracked successfully');
      
      res.json({
        success: true,
        message: 'Enhanced participant leave tracked',
        duration: participant.duration,
        participantCount: meeting.participants.filter(p => p.status === 'joined').length,
        timestamp: new Date().toISOString()
      });
    } else {
      console.log('⚠️ Participant not found for leave tracking');
      res.status(404).json({
        success: false,
        error: 'Participant not found'
      });
    }
    
  } catch (error) {
    console.error('❌ Error tracking enhanced participant leave:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to track participant leave',
      details: error.message
    });
  }
});

// Route to get all tracked participants for a meeting
router.get('/meeting/:meetingId/tracked-participants', async (req, res) => {
  try {
    const { meetingId } = req.params;
    
    const meeting = await ZoomMeeting.findOne({ meetingId: meetingId.toString() });
    
    if (!meeting) {
      return res.status(404).json({
        success: false,
        error: 'Meeting not found'
      });
    }
    
    res.json({
      success: true,
      meeting: {
        id: meeting.meetingId,
        topic: meeting.topic,
        status: meeting.status,
        totalParticipants: meeting.totalParticipants,
        uniqueParticipants: meeting.uniqueParticipants
      },
      participants: meeting.participants.map(p => ({
        participantId: p.participantId,
        name: p.name,
        email: p.email,
        joinTime: p.joinTime,
        leaveTime: p.leaveTime,
        duration: p.duration,
        status: p.status,
        isMatched: p.isMatched,
        studentInfo: p.isMatched ? {
          studentId: p.studentId,
          firstName: p.studentFirstName,
          lastName: p.studentLastName,
          department: p.studentDepartment,
          email: p.studentEmail
        } : null
      }))
    });
  } catch (error) {
    console.error('Error getting tracked participants:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Enhanced routes using ZoomService

// Note: Enhanced create-meeting route is defined below with full implementation

// Get meeting details using enhanced service
router.get('/enhanced/meeting/:meetingId', async (req, res) => {
  try {
    const meeting = await zoomService.getMeetingDetails(req.params.meetingId);
    res.json({
      success: true,
      meeting
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Get meeting participants using enhanced service
router.get('/enhanced/meeting/:meetingId/participants', async (req, res) => {
  try {
    const participants = await zoomService.getMeetingParticipants(req.params.meetingId);
    res.json({
      success: true,
      participants
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Enhanced signature generation
router.post('/enhanced/generate-signature', (req, res) => {
  try {
    const { meetingNumber, role } = req.body;
    
    if (!meetingNumber) {
      return res.status(400).json({
        success: false,
        error: 'Meeting number is required'
      });
    }
    
    const signature = zoomService.generateSignature(meetingNumber, role);
    
    res.json({
      success: true,
      signature,
      sdkKey: process.env.ZOOM_CLIENT_ID,
      meetingNumber: meetingNumber.toString(),
      role: parseInt(role) || 0
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Enhanced meeting creation endpoint for dashboard compatibility
router.post('/enhanced/create-meeting', async (req, res) => {
  try {
    const accessToken = await getZoomAccessToken();
    const io = req.app.get('io');
    const globalState = req.app.get('globalState');

    // Create meeting data with enhanced settings
    let meetingData = {
      topic: req.body.topic || 'New Meeting',
      type: req.body.type || 1, // Instant meeting by default
      duration: req.body.duration || 5,
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
    
    // Handle scheduled meetings
    if (req.body.type === 2 || req.body.start_time) {
      meetingData.type = 2;
      meetingData.start_time = req.body.start_time || new Date(Date.now() + 5 * 60000).toISOString();
      meetingData.timezone = req.body.timezone || 'America/New_York';
    }

    try {
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
      
      // Store meeting details in database for tracking
      try {
        await storeZoomMeetingDetails({
          ...meeting,
          metadata: {
            createdBy: req.body.hostEmail || 'system',
            department: req.body.department,
            course: req.body.course,
            session: req.body.session,
            tags: req.body.tags || []
          }
        });
      } catch (dbError) {
        console.error('Failed to store meeting details:', dbError);
      }
      
      // Real-time notification for meeting creation
      if (io && globalState) {
        const meetingInfo = {
          ...meeting,
          createdAt: new Date().toISOString(),
          status: 'created'
        };
        
        // Store in global state
        globalState.activeMeetings.set(meeting.id, meetingInfo);
        globalState.meetingAnalytics.totalMeetings++;
        globalState.meetingAnalytics.activeNow = globalState.activeMeetings.size;
        
        // Send real-time notification
        const notification = {
          id: Date.now(),
          type: 'meeting_created',
          title: '🎥 Meeting Created',
          message: `Meeting "${meeting.topic}" has been created successfully`,
          timestamp: new Date().toISOString(),
          meetingId: meeting.id
        };
        
        globalState.notifications.push(notification);
        io.emit('notification', notification);
        io.emit('meetingCreated', { meeting: meetingInfo, timestamp: new Date().toISOString() });
      }
      
      // Auto-start attendance tracking for the new meeting
      try {
        const AttendanceTracker = require('../services/attendanceTracker');
        const attendanceTracker = new AttendanceTracker();
        
        console.log(`🎯 Auto-starting attendance tracking for enhanced meeting: ${meeting.id}`);
        
        // Start tracking after a short delay to allow meeting to be fully created
        setTimeout(async () => {
          try {
            const trackingResult = await attendanceTracker.startTrackingMeeting(meeting.id.toString());
            if (trackingResult) {
              console.log(`✅ Auto-started tracking for enhanced meeting: ${meeting.id}`);
            } else {
              console.log(`⚠️ Could not auto-start tracking for enhanced meeting: ${meeting.id} (meeting may not be active yet)`);
            }
          } catch (trackingError) {
            console.warn(`⚠️ Auto-tracking failed for enhanced meeting ${meeting.id}:`, trackingError.message);
          }
        }, 5000); // 5 second delay
        
      } catch (autoTrackError) {
        console.warn('⚠️ Could not initialize auto-tracking for enhanced meeting:', autoTrackError.message);
      }
      
      res.json(meeting);
      
    } catch (createError) {
      console.error('Meeting creation failed:', createError.response?.data);
      
      // If scheduled meeting fails, try instant meeting
      if (createError.response?.data?.code === 4711 && meetingData.type === 2) {
        meetingData.type = 1; // Instant meeting
        delete meetingData.start_time;
        delete meetingData.timezone;
        
        try {
          const instantMeetingResponse = await axios.post(
            `https://api.zoom.us/v2/users/me/meetings`,
            meetingData,
            {
              headers: {
                Authorization: `Bearer ${accessToken}`,
                'Content-Type': 'application/json',
              },
            }
          );
          
          const meeting = instantMeetingResponse.data;
          
          // Store and notify for instant meeting
          try {
            await storeZoomMeetingDetails({
              ...meeting,
              metadata: {
                createdBy: req.body.hostEmail || 'system',
                department: req.body.department,
                course: req.body.course,
                session: req.body.session,
                tags: req.body.tags || []
              }
            });
          } catch (dbError) {
            console.error('Failed to store meeting details:', dbError);
          }
          
          // Real-time notification
          if (io && globalState) {
            const meetingInfo = {
              ...meeting,
              createdAt: new Date().toISOString(),
              status: 'created'
            };
            
            globalState.activeMeetings.set(meeting.id, meetingInfo);
            globalState.meetingAnalytics.totalMeetings++;
            globalState.meetingAnalytics.activeNow = globalState.activeMeetings.size;
            
            const notification = {
              id: Date.now(),
              type: 'meeting_created',
              title: '🎥 Meeting Created',
              message: `Meeting "${meeting.topic}" has been created successfully`,
              timestamp: new Date().toISOString(),
              meetingId: meeting.id
            };
            
            globalState.notifications.push(notification);
            io.emit('notification', notification);
            io.emit('meetingCreated', { meeting: meetingInfo, timestamp: new Date().toISOString() });
          }
          
          res.json(meeting);
          
        } catch (instantError) {
          console.error('Instant meeting also failed:', instantError.response?.data);
          throw new Error('Meeting creation failed. Please check your Zoom app permissions.');
        }
      } else {
        throw createError;
      }
    }
    
  } catch (error) {
    console.error('Enhanced create meeting error:', error);
    res.status(500).json({
      error: error.response?.data?.message || error.message,
      details: error.response?.data
    });
  }
});

// Enhanced participant tracking
router.post('/enhanced/track-join', async (req, res) => {
  try {
    const result = await zoomService.trackParticipantJoin(
      req.body.meetingId,
      req.body
    );
    
    // Real-time notification
    const io = req.app.get('io');
    if (io) {
      io.to(`meeting_${req.body.meetingId}`).emit('participantJoined', {
        participant: result.participant,
        timestamp: new Date().toISOString()
      });
    }
    
    res.json({
      success: true,
      ...result
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

router.post('/enhanced/track-leave', async (req, res) => {
  try {
    const result = await zoomService.trackParticipantLeave(
      req.body.meetingId,
      req.body
    );
    
    // Real-time notification
    const io = req.app.get('io');
    if (io) {
      io.to(`meeting_${req.body.meetingId}`).emit('participantLeft', {
        participant: result.participant,
        duration: result.duration,
        timestamp: new Date().toISOString()
      });
    }
    
    res.json({
      success: true,
      ...result
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Enhanced webhook endpoint for Zoom events with comprehensive participant tracking
router.post('/webhook', async (req, res) => {
  try {
    // Zoom webhook validation
    const event = req.body.event;
    const payload = req.body.payload;
    
    console.log('📡 Zoom webhook received:', event);
    console.log('📋 Payload preview:', JSON.stringify(payload, null, 2));
    
    const io = req.app.get('io');
    const globalState = req.app.get('globalState');
    
    // Process different webhook events
    switch (event) {
      case 'meeting.started':
        await handleMeetingStarted(payload, io, globalState);
        break;
        
      case 'meeting.ended':
        await handleMeetingEnded(payload, io, globalState);
        break;
        
      case 'meeting.participant_joined':
        await handleParticipantJoined(payload, io, globalState);
        break;
        
      case 'meeting.participant_left':
        await handleParticipantLeft(payload, io, globalState);
        break;
        
      case 'meeting.participant_updated':
        await handleParticipantUpdated(payload, io, globalState);
        break;
        
      // Additional participant events for comprehensive tracking
      case 'meeting.participant_waiting_for_host':
        await handleParticipantWaitingRoom(payload, io, globalState);
        break;
        
      case 'meeting.participant_admitted':
        await handleParticipantAdmitted(payload, io, globalState);
        break;
        
      case 'meeting.participant_put_in_waiting_room':
        await handleParticipantPutInWaitingRoom(payload, io, globalState);
        break;
        
      case 'meeting.sharing_started':
        await handleSharingStarted(payload, io, globalState);
        break;
        
      case 'meeting.sharing_ended':
        await handleSharingEnded(payload, io, globalState);
        break;
        
      case 'meeting.recording_started':
        await handleRecordingStarted(payload, io, globalState);
        break;
        
      case 'meeting.recording_stopped':
        await handleRecordingStopped(payload, io, globalState);
        break;
        
      default:
        console.log('⚠️ Unhandled webhook event:', event);
        // Log all unhandled events for debugging
        console.log('📋 Unhandled payload:', JSON.stringify(payload, null, 2));
    }
    
    // Always process through zoom service
    await zoomService.processWebhook(event, payload);
    
    // Real-time notification to dashboard
    if (io) {
      io.emit('zoomWebhook', {
        event,
        payload,
        timestamp: new Date().toISOString()
      });
    }
    
    res.status(200).json({ success: true });
  } catch (error) {
    console.error('🚨 Webhook processing error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Webhook event handlers
async function handleMeetingStarted(payload, io, globalState) {
  try {
    const meeting = payload.object;
    console.log('🎬 Meeting started:', meeting.topic);
    
    // Update global state
    const meetingInfo = {
      id: meeting.id.toString(),
      uuid: meeting.uuid,
      topic: meeting.topic,
      startTime: meeting.start_time,
      hostId: meeting.host_id,
      status: 'started',
      participants: []
    };
    
    globalState.activeMeetings.set(meeting.id.toString(), meetingInfo);
    globalState.meetingAnalytics.activeNow = globalState.activeMeetings.size;
    
    // Real-time notification
    const notification = {
      id: Date.now(),
      type: 'meeting_started',
      title: '🎬 Meeting Started',
      message: `Meeting "${meeting.topic}" has started`,
      timestamp: new Date().toISOString(),
      meetingId: meeting.id.toString()
    };
    
    globalState.notifications.push(notification);
    if (io) {
      io.emit('notification', notification);
      io.emit('meetingStarted', { meeting: meetingInfo, timestamp: new Date().toISOString() });
    }
    
  } catch (error) {
    console.error('Error handling meeting started:', error);
  }
}

async function handleMeetingEnded(payload, io, globalState) {
  try {
    const meeting = payload.object;
    console.log('🎬 Meeting ended:', meeting.topic);
    
    const meetingId = meeting.id.toString();
    
    // Update global state
    globalState.activeMeetings.delete(meetingId);
    globalState.meetingAnalytics.activeNow = globalState.activeMeetings.size;
    
    // Auto-generate attendance records for all participants
    await autoGenerateAttendance(meetingId);
    
    // Real-time notification
    const notification = {
      id: Date.now(),
      type: 'meeting_ended',
      title: '🏁 Meeting Ended',
      message: `Meeting "${meeting.topic}" has ended`,
      timestamp: new Date().toISOString(),
      meetingId: meetingId
    };
    
    globalState.notifications.push(notification);
    if (io) {
      io.emit('notification', notification);
      io.emit('meetingEnded', { meeting, timestamp: new Date().toISOString() });
    }
    
  } catch (error) {
    console.error('Error handling meeting ended:', error);
  }
}

async function handleParticipantJoined(payload, io, globalState) {
  try {
    const participant = payload.object.participant;
    const meetingId = payload.object.id.toString();
    
    console.log('👤 Participant joined:', participant.user_name, 'in meeting', meetingId);
    
    // Create comprehensive participant record
    const participantRecord = {
      participantName: participant.user_name,
      participantId: participant.id || participant.user_id,
      zoomUserId: participant.user_id,
      email: participant.email || '',
      meetingId: meetingId,
      meetingTopic: payload.object.topic || 'Zoom Meeting',
      joinTime: new Date(),
      device: determineDevice(participant),
      connectionStatus: 'joined',
      isActive: true
    };
    
    // Try to match with student record
    if (participantRecord.email) {
      try {
        const Student = require('../models/Student');
        const student = await Student.findOne({
          Email: { $regex: new RegExp(participantRecord.email, 'i') }
        });
        
        if (student) {
          participantRecord.studentId = student.StudentID;
          participantRecord.studentFirstName = student.FirstName;
          participantRecord.studentLastName = student.LastName;
          participantRecord.studentDepartment = student.Department;
          participantRecord.studentEmail = student.Email;
          participantRecord.userType = 'student';
        }
      } catch (studentError) {
        console.warn('Student matching failed:', studentError.message);
      }
    }
    
    // Save to database using participant route logic
    try {
      const Participant = require('../models/Participant');
      const newParticipant = new Participant(participantRecord);
      await newParticipant.save();
      
      // Update global state
      globalState.activeParticipants.set(participantRecord.participantId, {
        ...participantRecord,
        lastUpdate: new Date().toISOString()
      });
      
    } catch (dbError) {
      console.error('Failed to save participant to database:', dbError.message);
    }
    
    // Real-time notifications
    const notification = {
      id: Date.now(),
      type: 'participant_joined',
      title: '👋 Participant Joined',
      message: `${participant.user_name} joined the meeting`,
      timestamp: new Date().toISOString(),
      meetingId: meetingId,
      participantData: participantRecord
    };
    
    globalState.notifications.push(notification);
    if (io) {
      io.emit('notification', notification);
      io.to(`meeting_${meetingId}`).emit('participantJoined', {
        participant: participantRecord,
        timestamp: new Date().toISOString()
      });
      
      // Broadcast to all connected clients
      io.emit('participantUpdate', {
        action: 'joined',
        participant: participantRecord,
        meetingId: meetingId
      });
    }
    
  } catch (error) {
    console.error('Error handling participant joined:', error);
  }
}

async function handleParticipantLeft(payload, io, globalState) {
  try {
    const participant = payload.object.participant;
    const meetingId = payload.object.id.toString();
    
    console.log('👋 Participant left:', participant.user_name, 'from meeting', meetingId);
    
    // Update participant record in database
    try {
      const Participant = require('../models/Participant');
      const participantRecord = await Participant.findOne({
        meetingId: meetingId,
        $or: [
          { participantId: participant.id || participant.user_id },
          { zoomUserId: participant.user_id },
          { email: participant.email }
        ],
        isActive: true
      });
      
      if (participantRecord) {
        const leaveTime = new Date();
        const duration = Math.round((leaveTime - participantRecord.joinTime) / (1000 * 60)); // minutes
        
        participantRecord.leaveTime = leaveTime;
        participantRecord.duration = duration;
        participantRecord.isActive = false;
        participantRecord.connectionStatus = 'left';
        participantRecord.attendanceStatus = duration >= 5 ? 'Present' : 'Left Early';
        
        await participantRecord.save();
        
        // Remove from global state
        globalState.activeParticipants.delete(participant.id || participant.user_id);
        
        // Real-time notification
        const notification = {
          id: Date.now(),
          type: 'participant_left',
          title: '👋 Participant Left',
          message: `${participant.user_name} left after ${duration} minutes`,
          timestamp: new Date().toISOString(),
          meetingId: meetingId,
          participantData: {
            name: participant.user_name,
            duration: duration
          }
        };
        
        globalState.notifications.push(notification);
        if (io) {
          io.emit('notification', notification);
          io.to(`meeting_${meetingId}`).emit('participantLeft', {
            participant: {
              name: participant.user_name,
              id: participant.id || participant.user_id,
              duration: duration
            },
            timestamp: new Date().toISOString()
          });
          
          // Broadcast to all connected clients
          io.emit('participantUpdate', {
            action: 'left',
            participant: participantRecord,
            meetingId: meetingId
          });
        }
      }
    } catch (dbError) {
      console.error('Failed to update participant in database:', dbError.message);
    }
    
  } catch (error) {
    console.error('Error handling participant left:', error);
  }
}

async function handleParticipantUpdated(payload, io, globalState) {
  try {
    const participant = payload.object.participant;
    const meetingId = payload.object.id.toString();
    
    console.log('🔄 Participant updated:', participant.user_name);
    
    // Update participant record in database
    try {
      const Participant = require('../models/Participant');
      const participantRecord = await Participant.findOne({
        meetingId: meetingId,
        $or: [
          { participantId: participant.id || participant.user_id },
          { zoomUserId: participant.user_id },
          { email: participant.email }
        ],
        isActive: true
      });
      
      if (participantRecord) {
        // Update participant status
        participantRecord.audioStatus = !participant.muted;
        participantRecord.videoStatus = participant.video === 'on';
        participantRecord.sharingScreen = participant.sharing_screen || false;
        participantRecord.lastActivity = new Date();
        
        await participantRecord.save();
        
        // Update global state
        globalState.activeParticipants.set(participant.id || participant.user_id, {
          ...participantRecord.toObject(),
          lastUpdate: new Date().toISOString()
        });
        
        // Real-time update
        if (io) {
          io.to(`meeting_${meetingId}`).emit('participantStatusUpdate', {
            participant: participantRecord,
            timestamp: new Date().toISOString()
          });
          
          // Broadcast to all connected clients
          io.emit('participantUpdate', {
            action: 'updated',
            participant: participantRecord,
            meetingId: meetingId
          });
        }
      }
    } catch (dbError) {
      console.error('Failed to update participant status:', dbError.message);
    }
    
  } catch (error) {
    console.error('Error handling participant updated:', error);
  }
}

// Additional webhook event handlers for comprehensive tracking

// Handle participant waiting in waiting room
async function handleParticipantWaitingRoom(payload, io, globalState) {
  try {
    const participant = payload.object.participant;
    const meetingId = payload.object.id.toString();
    
    console.log('⏳ Participant waiting for host:', participant.user_name, 'in meeting', meetingId);
    
    // Real-time notification
    const notification = {
      id: Date.now(),
      type: 'participant_waiting',
      title: '⏳ Participant Waiting',
      message: `${participant.user_name} is waiting for the host to admit them`,
      timestamp: new Date().toISOString(),
      meetingId: meetingId,
      participantData: {
        name: participant.user_name,
        email: participant.email || ''
      }
    };
    
    globalState.notifications.push(notification);
    if (io) {
      io.emit('notification', notification);
      io.to(`meeting_${meetingId}`).emit('participantWaiting', {
        participant: {
          name: participant.user_name,
          email: participant.email || '',
          id: participant.id || participant.user_id
        },
        timestamp: new Date().toISOString()
      });
    }
    
  } catch (error) {
    console.error('Error handling participant waiting:', error);
  }
}

// Handle participant admitted from waiting room
async function handleParticipantAdmitted(payload, io, globalState) {
  try {
    const participant = payload.object.participant;
    const meetingId = payload.object.id.toString();
    
    console.log('✅ Participant admitted:', participant.user_name, 'to meeting', meetingId);
    
    // Update participant record if exists
    try {
      const Participant = require('../models/Participant');
      let participantRecord = await Participant.findOne({
        meetingId: meetingId,
        $or: [
          { participantId: participant.id || participant.user_id },
          { zoomUserId: participant.user_id },
          { email: participant.email }
        ]
      });
      
      if (!participantRecord) {
        // Create new participant record since they're now admitted
        participantRecord = new Participant({
          participantName: participant.user_name,
          participantId: participant.id || participant.user_id,
          zoomUserId: participant.user_id,
          email: participant.email || '',
          meetingId: meetingId,
          meetingTopic: payload.object.topic || 'Zoom Meeting',
          joinTime: new Date(),
          device: determineDevice(participant),
          connectionStatus: 'admitted',
          isActive: true
        });
        
        // Try to match with student record
        if (participantRecord.email) {
          try {
            const Student = require('../models/Student');
            const student = await Student.findOne({
              Email: { $regex: new RegExp(participantRecord.email, 'i') }
            });
            
            if (student) {
              participantRecord.studentId = student.StudentID;
              participantRecord.studentFirstName = student.FirstName;
              participantRecord.studentLastName = student.LastName;
              participantRecord.studentDepartment = student.Department;
              participantRecord.studentEmail = student.Email;
              participantRecord.userType = 'student';
            }
          } catch (studentError) {
            console.warn('Student matching failed:', studentError.message);
          }
        }
        
        await participantRecord.save();
      } else {
        // Update existing record
        participantRecord.connectionStatus = 'admitted';
        participantRecord.isActive = true;
        participantRecord.lastActivity = new Date();
        await participantRecord.save();
      }
      
      // Update global state
      globalState.activeParticipants.set(participantRecord.participantId, {
        ...participantRecord.toObject(),
        lastUpdate: new Date().toISOString()
      });
      
    } catch (dbError) {
      console.error('Failed to update participant admission:', dbError.message);
    }
    
    // Real-time notification
    const notification = {
      id: Date.now(),
      type: 'participant_admitted',
      title: '✅ Participant Admitted',
      message: `${participant.user_name} has been admitted to the meeting`,
      timestamp: new Date().toISOString(),
      meetingId: meetingId,
      participantData: {
        name: participant.user_name,
        email: participant.email || ''
      }
    };
    
    globalState.notifications.push(notification);
    if (io) {
      io.emit('notification', notification);
      io.to(`meeting_${meetingId}`).emit('participantAdmitted', {
        participant: {
          name: participant.user_name,
          email: participant.email || '',
          id: participant.id || participant.user_id
        },
        timestamp: new Date().toISOString()
      });
    }
    
  } catch (error) {
    console.error('Error handling participant admitted:', error);
  }
}

// Handle participant put in waiting room
async function handleParticipantPutInWaitingRoom(payload, io, globalState) {
  try {
    const participant = payload.object.participant;
    const meetingId = payload.object.id.toString();
    
    console.log('🚪 Participant put in waiting room:', participant.user_name, 'in meeting', meetingId);
    
    // Update participant record
    try {
      const Participant = require('../models/Participant');
      const participantRecord = await Participant.findOne({
        meetingId: meetingId,
        $or: [
          { participantId: participant.id || participant.user_id },
          { zoomUserId: participant.user_id },
          { email: participant.email }
        ],
        isActive: true
      });
      
      if (participantRecord) {
        participantRecord.connectionStatus = 'in_waiting_room';
        participantRecord.lastActivity = new Date();
        await participantRecord.save();
        
        // Update global state
        globalState.activeParticipants.set(participant.id || participant.user_id, {
          ...participantRecord.toObject(),
          lastUpdate: new Date().toISOString()
        });
      }
    } catch (dbError) {
      console.error('Failed to update participant waiting room status:', dbError.message);
    }
    
    // Real-time notification
    const notification = {
      id: Date.now(),
      type: 'participant_waiting_room',
      title: '🚪 Participant in Waiting Room',
      message: `${participant.user_name} has been moved to the waiting room`,
      timestamp: new Date().toISOString(),
      meetingId: meetingId,
      participantData: {
        name: participant.user_name,
        email: participant.email || ''
      }
    };
    
    globalState.notifications.push(notification);
    if (io) {
      io.emit('notification', notification);
      io.to(`meeting_${meetingId}`).emit('participantMovedToWaitingRoom', {
        participant: {
          name: participant.user_name,
          email: participant.email || '',
          id: participant.id || participant.user_id
        },
        timestamp: new Date().toISOString()
      });
    }
    
  } catch (error) {
    console.error('Error handling participant put in waiting room:', error);
  }
}

// Handle screen sharing started
async function handleSharingStarted(payload, io, globalState) {
  try {
    const participant = payload.object.participant;
    const meetingId = payload.object.id.toString();
    
    console.log('📺 Screen sharing started:', participant?.user_name || 'Host', 'in meeting', meetingId);
    
    // Update participant record if it's a participant sharing
    if (participant) {
      try {
        const Participant = require('../models/Participant');
        const participantRecord = await Participant.findOne({
          meetingId: meetingId,
          $or: [
            { participantId: participant.id || participant.user_id },
            { zoomUserId: participant.user_id },
            { email: participant.email }
          ],
          isActive: true
        });
        
        if (participantRecord) {
          participantRecord.sharingScreen = true;
          participantRecord.lastActivity = new Date();
          await participantRecord.save();
          
          // Update global state
          globalState.activeParticipants.set(participant.id || participant.user_id, {
            ...participantRecord.toObject(),
            lastUpdate: new Date().toISOString()
          });
        }
      } catch (dbError) {
        console.error('Failed to update sharing status:', dbError.message);
      }
    }
    
    // Real-time notification
    const notification = {
      id: Date.now(),
      type: 'sharing_started',
      title: '📺 Screen Sharing Started',
      message: `${participant?.user_name || 'Host'} started sharing their screen`,
      timestamp: new Date().toISOString(),
      meetingId: meetingId,
      participantData: {
        name: participant?.user_name || 'Host',
        email: participant?.email || ''
      }
    };
    
    globalState.notifications.push(notification);
    if (io) {
      io.emit('notification', notification);
      io.to(`meeting_${meetingId}`).emit('sharingStarted', {
        participant: {
          name: participant?.user_name || 'Host',
          email: participant?.email || '',
          id: participant?.id || participant?.user_id
        },
        timestamp: new Date().toISOString()
      });
    }
    
  } catch (error) {
    console.error('Error handling sharing started:', error);
  }
}

// Handle screen sharing ended
async function handleSharingEnded(payload, io, globalState) {
  try {
    const participant = payload.object.participant;
    const meetingId = payload.object.id.toString();
    
    console.log('📺 Screen sharing ended:', participant?.user_name || 'Host', 'in meeting', meetingId);
    
    // Update participant record if it's a participant sharing
    if (participant) {
      try {
        const Participant = require('../models/Participant');
        const participantRecord = await Participant.findOne({
          meetingId: meetingId,
          $or: [
            { participantId: participant.id || participant.user_id },
            { zoomUserId: participant.user_id },
            { email: participant.email }
          ],
          isActive: true
        });
        
        if (participantRecord) {
          participantRecord.sharingScreen = false;
          participantRecord.lastActivity = new Date();
          await participantRecord.save();
          
          // Update global state
          globalState.activeParticipants.set(participant.id || participant.user_id, {
            ...participantRecord.toObject(),
            lastUpdate: new Date().toISOString()
          });
        }
      } catch (dbError) {
        console.error('Failed to update sharing status:', dbError.message);
      }
    }
    
    // Real-time notification
    const notification = {
      id: Date.now(),
      type: 'sharing_ended',
      title: '📺 Screen Sharing Ended',
      message: `${participant?.user_name || 'Host'} stopped sharing their screen`,
      timestamp: new Date().toISOString(),
      meetingId: meetingId,
      participantData: {
        name: participant?.user_name || 'Host',
        email: participant?.email || ''
      }
    };
    
    globalState.notifications.push(notification);
    if (io) {
      io.emit('notification', notification);
      io.to(`meeting_${meetingId}`).emit('sharingEnded', {
        participant: {
          name: participant?.user_name || 'Host',
          email: participant?.email || '',
          id: participant?.id || participant?.user_id
        },
        timestamp: new Date().toISOString()
      });
    }
    
  } catch (error) {
    console.error('Error handling sharing ended:', error);
  }
}

// Handle recording started
async function handleRecordingStarted(payload, io, globalState) {
  try {
    const meeting = payload.object;
    const meetingId = meeting.id.toString();
    
    console.log('🎥 Recording started for meeting:', meeting.topic, meetingId);
    
    // Update meeting state if we have it
    if (globalState.activeMeetings.has(meetingId)) {
      const meetingInfo = globalState.activeMeetings.get(meetingId);
      meetingInfo.recording = true;
      meetingInfo.recordingStarted = new Date().toISOString();
      globalState.activeMeetings.set(meetingId, meetingInfo);
    }
    
    // Real-time notification
    const notification = {
      id: Date.now(),
      type: 'recording_started',
      title: '🎥 Recording Started',
      message: `Recording has started for meeting "${meeting.topic}"`,
      timestamp: new Date().toISOString(),
      meetingId: meetingId
    };
    
    globalState.notifications.push(notification);
    if (io) {
      io.emit('notification', notification);
      io.to(`meeting_${meetingId}`).emit('recordingStarted', {
        meeting: {
          id: meetingId,
          topic: meeting.topic
        },
        timestamp: new Date().toISOString()
      });
    }
    
  } catch (error) {
    console.error('Error handling recording started:', error);
  }
}

// Handle recording stopped
async function handleRecordingStopped(payload, io, globalState) {
  try {
    const meeting = payload.object;
    const meetingId = meeting.id.toString();
    
    console.log('🎥 Recording stopped for meeting:', meeting.topic, meetingId);
    
    // Update meeting state if we have it
    if (globalState.activeMeetings.has(meetingId)) {
      const meetingInfo = globalState.activeMeetings.get(meetingId);
      meetingInfo.recording = false;
      meetingInfo.recordingStopped = new Date().toISOString();
      globalState.activeMeetings.set(meetingId, meetingInfo);
    }
    
    // Real-time notification
    const notification = {
      id: Date.now(),
      type: 'recording_stopped',
      title: '🎥 Recording Stopped',
      message: `Recording has stopped for meeting "${meeting.topic}"`,
      timestamp: new Date().toISOString(),
      meetingId: meetingId
    };
    
    globalState.notifications.push(notification);
    if (io) {
      io.emit('notification', notification);
      io.to(`meeting_${meetingId}`).emit('recordingStopped', {
        meeting: {
          id: meetingId,
          topic: meeting.topic
        },
        timestamp: new Date().toISOString()
      });
    }
    
  } catch (error) {
    console.error('Error handling recording stopped:', error);
  }
}

// Helper function to determine device type
function determineDevice(participant) {
  // This is a simplified device detection - you can enhance based on Zoom's participant data
  if (participant.device) {
    return participant.device;
  }
  // Default fallback
  return 'Unknown';
}

// Auto-generate attendance records when meeting ends
async function autoGenerateAttendance(meetingId) {
  try {
    console.log('📊 Auto-generating attendance for meeting:', meetingId);
    
    const Participant = require('../models/Participant');
    const Attendance = require('../models/Attendance');
    
    // Get all participants for this meeting
    const participants = await Participant.find({ meetingId }).populate('studentId');
    
    for (const participant of participants) {
      if (participant.studentId && participant.duration > 0) {
        // Create attendance record
        const attendanceRecord = new Attendance({
          StudentID: participant.studentId,
          Date: participant.joinTime || new Date(),
          Status: participant.attendanceStatus || 'Present',
          Remarks: `Zoom meeting attendance: ${participant.duration} minutes in "${participant.meetingTopic}"`
        });
        
        try {
          await attendanceRecord.save();
          console.log(`✅ Attendance recorded for student ${participant.studentId}`);
        } catch (attendanceError) {
          console.error(`Failed to save attendance for ${participant.studentId}:`, attendanceError.message);
        }
      }
    }
    
  } catch (error) {
    console.error('Error in auto-generating attendance:', error);
  }
}


// Helper function to calculate attendance percentage
function calculateAttendancePercentage(actualMinutes, expectedMinutes) {
  if (expectedMinutes <= 0) return 0;
  return Math.min(Math.round((actualMinutes / expectedMinutes) * 100), 100);
}

// Helper function to determine connection quality
function determineConnectionQuality(participant) {
  // This could be enhanced with actual quality metrics from Zoom
  const audioQuality = participant.audio_quality;
  const videoQuality = participant.video_quality;
  
  if (audioQuality === 'good' && videoQuality === 'good') {
    return 'excellent';
  } else if (audioQuality === 'fair' || videoQuality === 'fair') {
    return 'fair';
  } else if (audioQuality === 'poor' || videoQuality === 'poor') {
    return 'poor';
  }
  return 'unknown';
}

// Bulk update participant data from Zoom webhooks or API polling
router.post('/update-participants-bulk', async (req, res) => {
  try {
    const { meetingId, participants, source = 'api_poll' } = req.body;
    
    if (!meetingId || !Array.isArray(participants)) {
      return res.status(400).json({
        success: false,
        error: 'Meeting ID and participants array are required'
      });
    }
    
    const Participant = require('../models/Participant');
    const io = req.app.get('io');
    const globalState = req.app.get('globalState');
;
    
    const updateResults = {
      updated: 0,
      created: 0,
      errors: []
    };
    
    for (const participantData of participants) {
      try {
        const query = {
          meetingId: meetingId,
          $or: [
            { participantId: participantData.id || participantData.user_id },
            { zoomUserId: participantData.user_id },
            { email: participantData.email }
          ].filter(condition => Object.values(condition)[1]) // Filter out undefined values
        };
        
        let participant = await Participant.findOne(query);
        
        if (participant) {
          // Update existing participant
          participant.participantName = participantData.name || participant.participantName;
          participant.email = participantData.email || participant.email;
          participant.lastActivity = new Date();
          
          // Update status based on Zoom data
          if (participantData.status === 'in_meeting' && !participant.isActive) {
            participant.isActive = true;
            participant.connectionStatus = 'reconnected';
          } else if (participantData.status === 'left' && participant.isActive) {
            participant.isActive = false;
            participant.leaveTime = new Date();
            participant.connectionStatus = 'left';
            if (participant.joinTime) {
              participant.duration = Math.round((participant.leaveTime - participant.joinTime) / (1000 * 60));
            }
          }
          
          await participant.save();
          updateResults.updated++;
          
        } else {
          // Create new participant record
          const newParticipant = new Participant({
            participantName: participantData.name,
            participantId: participantData.id || participantData.user_id,
            zoomUserId: participantData.user_id,
            email: participantData.email || '',
            meetingId: meetingId,
            joinTime: participantData.join_time ? new Date(participantData.join_time) : new Date(),
            leaveTime: participantData.leave_time ? new Date(participantData.leave_time) : null,
            duration: participantData.duration || 0,
            isActive: participantData.status === 'in_meeting',
            connectionStatus: participantData.status === 'in_meeting' ? 'joined' : 'left',
            lastActivity: new Date()
          });
          
          // Try to match with student
          if (newParticipant.email) {
            try {
              const Student = require('../models/Student');
              const student = await Student.findOne({
                Email: { $regex: new RegExp(newParticipant.email, 'i') }
              });
              
              if (student) {
                newParticipant.studentId = student.StudentID;
                newParticipant.studentFirstName = student.FirstName;
                newParticipant.studentLastName = student.LastName;
                newParticipant.studentDepartment = student.Department;
                newParticipant.studentEmail = student.Email;
                newParticipant.userType = 'student';
              }
            } catch (studentError) {
              console.warn('Student matching failed:', studentError.message);
            }
          }
          
          await newParticipant.save();
          updateResults.created++;
          
          participant = newParticipant;
        }
        
        // Update global state
        if (globalState) {
          globalState.activeParticipants.set(participant.participantId, {
            ...participant.toObject(),
            lastUpdate: new Date().toISOString()
          });
        }
        
      } catch (participantError) {
        console.error('Error processing participant:', participantError);
        updateResults.errors.push({
          participant: participantData.name || participantData.id,
          error: participantError.message
        });
      }
    }
    
    // Send real-time update to all connected clients
    if (io) {
      io.emit('participantsBulkUpdate', {
        meetingId,
        source,
        results: updateResults,
        timestamp: new Date().toISOString()
      });
      
      // Also send to specific meeting room
      io.to(`meeting_${meetingId}`).emit('participantsRefreshed', {
        meetingId,
        results: updateResults,
        timestamp: new Date().toISOString()
      });
    }
    
    res.json({
      success: true,
      meetingId,
      source,
      results: updateResults,
      timestamp: new Date().toISOString()
    });
    
  } catch (error) {
    console.error('🚨 Bulk participant update error:', error);
    res.status(500).json({
      success: false,
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

// Test minimal Zoom API access (doesn't require meeting scopes)
router.get('/test-minimal', async (req, res) => {
  try {
    const accessToken = await getZoomAccessToken();
    
    // Test with minimal API call that doesn't need meeting scopes
    const userResponse = await axios.get(
      'https://api.zoom.us/v2/users/me',
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
      }
    );
    
    res.json({ 
      success: true,
      message: 'Token works for basic user info',
      user: {
        id: userResponse.data.id,
        first_name: userResponse.data.first_name,
        last_name: userResponse.data.last_name,
        email: userResponse.data.email,
        account_id: userResponse.data.account_id
      },
      token_info: {
        account_id: ZOOM_ACCOUNT_ID,
        client_id: ZOOM_CLIENT_ID.substring(0, 8) + '...'
      }
    });
  } catch (error) {
    console.error('Test minimal API error:', error.response?.data || error.message);
    res.status(500).json({ 
      success: false,
      error: error.message,
      details: error.response?.data,
      suggestion: 'Check if your Zoom app has basic user:read:user scope'
    });
  }
});

// Test meeting scopes specifically
router.get('/test-meeting-scopes', async (req, res) => {
  try {
    const accessToken = await getZoomAccessToken();
    
    // Try to list meetings - this requires meeting scopes
    const meetingsResponse = await axios.get(
      'https://api.zoom.us/v2/users/me/meetings?type=scheduled&page_size=10',
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
      }
    );
    
    res.json({ 
      success: true,
      message: 'Meeting scopes are working correctly',
      meetings_count: meetingsResponse.data.meetings?.length || 0,
      scopes_working: [
        'meeting:read:list_meetings',
        'meeting:read:meeting'
      ]
    });
    
  } catch (error) {
    console.error('Meeting scopes test error:', error.response?.data || error.message);
    
    // Provide specific guidance based on error
    let suggestion = 'Unknown error occurred';
    if (error.response?.data?.code === 4711) {
      suggestion = 'Missing meeting scopes. Add meeting:read:list_meetings and meeting:read:meeting to your Zoom app.';
    } else if (error.response?.data?.message?.includes('scopes')) {
      suggestion = `Missing scopes: ${error.response.data.message}`;
    }
    
    res.status(error.response?.status || 500).json({ 
      success: false,
      error: error.message,
      details: error.response?.data,
      suggestion,
      fix_instructions: 'See ZOOM_SCOPE_FIX.md for detailed fix instructions'
    });
  }
});

// Route to get all meetings (for dashboard)
router.get('/meetings', async (req, res) => {
  try {
    const accessToken = await getZoomAccessToken();
    
    // Get meetings from Zoom API
    const meetingsResponse = await axios.get(
      'https://api.zoom.us/v2/users/me/meetings?type=live&page_size=100',
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
      }
    );
    
    // Also get scheduled meetings
    const scheduledResponse = await axios.get(
      'https://api.zoom.us/v2/users/me/meetings?type=scheduled&page_size=100',
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
      }
    );
    
    // Combine meetings
    const allMeetings = [
      ...(meetingsResponse.data.meetings || []),
      ...(scheduledResponse.data.meetings || [])
    ];
    
    // Sort by creation date
    allMeetings.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
    
    res.json({
      success: true,
      meetings: allMeetings,
      total: allMeetings.length,
      timestamp: new Date().toISOString()
    });
    
  } catch (error) {
    console.error('Error fetching meetings:', error.response?.data || error.message);
    
    // If the error is scope-related, try to get from database
    if (error.response?.data?.code === 4711) {
      try {
        const dbMeetings = await ZoomMeeting.find({})
          .sort({ createdAt: -1 })
          .limit(100)
          .lean();
        
        const formattedMeetings = dbMeetings.map(meeting => ({
          id: meeting.meetingId || meeting._id,
          topic: meeting.topic || 'Untitled Meeting',
          start_time: meeting.startTime || meeting.createdAt,
          created_at: meeting.createdAt,
          duration: meeting.duration || 60,
          join_url: meeting.joinUrl || `https://zoom.us/j/${meeting.meetingId}`,
          status: meeting.status || 'waiting',
          host_id: meeting.hostId || 'unknown',
          settings: meeting.settings || {}
        }));
        
        return res.json({
          success: true,
          meetings: formattedMeetings,
          total: formattedMeetings.length,
          source: 'database',
          message: 'Meetings retrieved from database due to API permissions',
          timestamp: new Date().toISOString()
        });
      } catch (dbError) {
        console.error('Database fallback failed:', dbError);
      }
    }
    
    res.status(500).json({
      success: false,
      error: error.message,
      meetings: [],
      total: 0,
      timestamp: new Date().toISOString()
    });
  }
});

// Real-time endpoint for active meetings and participants
router.get('/real-time', (req, res) => {
  try {
    const { globalState } = require('../server');
    
    if (!globalState) {
      return res.status(500).json({
        success: false,
        error: 'Global state not available',
        activeMeetings: [],
        participants: []
      });
    }
    
    // Get active meetings from global state
    const activeMeetings = Array.from(globalState.activeMeetings.values()).map(meeting => ({
      ...meeting,
      participantCount: Array.from(globalState.activeParticipants.values())
        .filter(p => p.meetingId === meeting.id && p.isActive).length,
      participants: Array.from(globalState.activeParticipants.values())
        .filter(p => p.meetingId === meeting.id)
        .map(p => ({
          id: p.id,
          name: p.name,
          email: p.email,
          joinTime: p.joinTime,
          isActive: p.isActive,
          attendanceStatus: p.attendanceStatus || 'Present',
          video: p.video || false,
          audio: p.audio || false,
          sharing: p.sharing || false
        }))
    }));
    
    // Get all active participants
    const participants = Array.from(globalState.activeParticipants.values())
      .filter(p => p.isActive)
      .map(p => ({
        id: p.id,
        meetingId: p.meetingId,
        name: p.name,
        email: p.email,
        joinTime: p.joinTime,
        attendanceStatus: p.attendanceStatus || 'Present',
        video: p.video || false,
        audio: p.audio || false,
        sharing: p.sharing || false,
        lastUpdate: p.lastUpdate
      }));
    
    res.json({
      success: true,
      activeMeetings,
      participants,
      analytics: {
        totalMeetings: globalState.meetingAnalytics.totalMeetings,
        activeMeetings: globalState.activeMeetings.size,
        totalParticipants: globalState.activeParticipants.size,
        activeParticipants: participants.length
      },
      timestamp: new Date().toISOString()
    });
    
  } catch (error) {
    console.error('Error getting real-time data:', error);
    res.status(500).json({
      success: false,
      error: error.message,
      activeMeetings: [],
      participants: [],
      timestamp: new Date().toISOString()
    });
  }
});

// Test endpoint to manually register an active meeting in global state
router.post('/test-register-meeting', (req, res) => {
  try {
    const { globalState } = require('../server');
    const io = req.app.get('io');
    
    const { meetingId, topic, joinUrl, status = 'active' } = req.body;
    
    if (!meetingId || !topic) {
      return res.status(400).json({
        success: false,
        error: 'Meeting ID and topic are required'
      });
    }
    
    // Create meeting object
    const meetingInfo = {
      id: meetingId.toString(),
      topic: topic,
      join_url: joinUrl || `https://zoom.us/j/${meetingId}`,
      start_time: new Date().toISOString(),
      created_at: new Date().toISOString(),
      status: status,
      duration: 60,
      participants: [],
      participantCount: 0
    };
    
    // Store in global state
    globalState.activeMeetings.set(meetingId.toString(), meetingInfo);
    globalState.meetingAnalytics.totalMeetings++;
    globalState.meetingAnalytics.activeNow = globalState.activeMeetings.size;
    
    // Send real-time notification
    const notification = {
      id: Date.now(),
      type: 'meeting_registered',
      title: '📅 Meeting Registered',
      message: `Meeting "${topic}" has been registered for live tracking`,
      timestamp: new Date().toISOString(),
      meetingId: meetingId.toString()
    };
    
    globalState.notifications.push(notification);
    
    if (io) {
      io.emit('notification', notification);
      io.emit('meetingCreated', { 
        meeting: meetingInfo, 
        timestamp: new Date().toISOString() 
      });
    }
    
    res.json({
      success: true,
      meeting: meetingInfo,
      message: 'Meeting registered successfully for live tracking',
      globalStateSize: globalState.activeMeetings.size
    });
    
  } catch (error) {
    console.error('Error registering test meeting:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Health check endpoint
router.get('/health', async (req, res) => {
  try {
    // Check if we can get a token
    const token = await zoomService.getAccessToken();
    
    res.json({
      status: 'healthy',
      timestamp: new Date().toISOString(),
      services: {
        zoomAPI: 'connected',
        database: 'connected',
        authentication: 'valid'
      }
    });
  } catch (error) {
    res.status(500).json({
      status: 'unhealthy',
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

// GET /api/zoom/meeting/:meetingId/live-participants - Get live participants for admin dashboard
router.get('/meeting/:meetingId/live-participants', async (req, res) => {
  try {
    const { meetingId } = req.params;
    
    console.log(`🔍 Admin Dashboard requesting participants for meeting: ${meetingId}`);
    
    // Try to get participants from multiple sources
    const Participant = require('../models/Participant');
    const ZoomMeeting = require('../models/ZoomMeeting');
    
    // First, get the meeting details - handle both MongoDB ObjectId and Zoom meeting IDs
    let meeting;
    try {
      console.log(`🔍 Looking for meeting with ID: ${meetingId} (length: ${meetingId.length})`);
      
      // Try as MongoDB ObjectId first
      if (meetingId.length === 24) {
        console.log(`📋 Trying to find by ObjectId...`);
        meeting = await ZoomMeeting.findById(meetingId);
        console.log(`📋 ObjectId search result:`, meeting ? 'FOUND' : 'NOT FOUND');
      }
      
      // If not found, try as Zoom meeting ID
      if (!meeting) {
        console.log(`📋 Trying to find by meetingId field...`);
        meeting = await ZoomMeeting.findOne({ meetingId: meetingId });
        console.log(`📋 meetingId field search result:`, meeting ? 'FOUND' : 'NOT FOUND');
      }
      
      // If still not found, try partial matches or any meeting ID field
      if (!meeting) {
        console.log(`📋 Trying broad search with $or query...`);
        meeting = await ZoomMeeting.findOne({ 
          $or: [
            { meetingId: meetingId },
            { _id: meetingId },
            { 'metadata.meetingId': meetingId }
          ]
        });
        console.log(`📋 Broad search result:`, meeting ? 'FOUND' : 'NOT FOUND');
      }
      
      // If still not found, check if it exists in the general Meeting model
      if (!meeting) {
        console.log(`📋 Meeting not found in ZoomMeeting collection. Checking general Meeting model...`);
        const Meeting = require('../models/Meeting');
        const generalMeeting = await Meeting.findById(meetingId);
        if (generalMeeting) {
          console.log(`📋 Found meeting in general Meeting collection:`, generalMeeting.title);
          // Create a ZoomMeeting-compatible object from the general meeting
          meeting = {
            _id: generalMeeting._id,
            meetingId: generalMeeting._id.toString(),
            topic: generalMeeting.title,
            status: generalMeeting.status
          };
        }
      }
    } catch (error) {
      console.warn('Error finding meeting:', error.message);
    }
    
    if (!meeting) {
      return res.status(404).json({
        success: false,
        error: 'Meeting not found',
        participants: [],
        statistics: {
          total_participants: 0,
          active_now: 0,
          students_identified: 0,
          average_duration: 0
        }
      });
    }
    
    // Get participants from the Participant model
    const participants = await Participant.find({ 
      $or: [
        { meetingId: meetingId },
        { meetingId: meeting.meetingId }
      ]
    })
    .populate('userId', 'firstName lastName email')
    .populate('studentId', 'FirstName LastName Email StudentID Department')
    .sort({ joinTime: -1 });
    
    console.log(`📊 Found ${participants.length} participants in database`);
    
    // Transform participants to match frontend expectations
    const transformedParticipants = participants.map(participant => {
      const studentInfo = participant.studentId ? {
        firstName: participant.studentId.FirstName,
        lastName: participant.studentId.LastName,
        email: participant.studentId.Email,
        studentId: participant.studentId.StudentID,
        department: participant.studentId.Department
      } : (participant.studentFirstName ? {
        firstName: participant.studentFirstName,
        lastName: participant.studentLastName,
        email: participant.studentEmail,
        studentId: participant.studentId,
        department: participant.studentDepartment
      } : null);
      
      const userInfo = participant.userId ? {
        firstName: participant.userId.firstName,
        lastName: participant.userId.lastName,
        email: participant.userId.email
      } : null;
      
      return {
        id: participant._id,
        name: participant.participantName,
        email: participant.email || studentInfo?.email || userInfo?.email,
        joinTime: participant.joinTime ? participant.joinTime.toISOString() : null,
        leaveTime: participant.leaveTime ? participant.leaveTime.toISOString() : null,
        duration: participant.duration || participant.calculateTotalDuration(),
        isActive: participant.isActive,
        attendanceStatus: participant.attendanceStatus,
        connectionStatus: participant.connectionStatus,
        userType: participant.userType,
        device: participant.device,
        
        // Authentication info
        isAuthenticated: !!participant.userId || participant.authenticatedUser?.joinedViaAuth,
        authenticatedUser: participant.authenticatedUser?.username ? {
          username: participant.authenticatedUser.username,
          email: participant.authenticatedUser.email,
          role: participant.authenticatedUser.role
        } : (userInfo ? {
          username: userInfo.firstName + ' ' + userInfo.lastName,
          email: userInfo.email,
          role: 'user'
        } : null),
        
        // Student info
        studentInfo: studentInfo,
        
        // Engagement metrics
        audioStatus: participant.audioStatus,
        videoStatus: participant.videoStatus,
        sharingScreen: participant.sharingScreen,
        handRaised: participant.handRaised,
        
        // Metadata
        lastActivity: participant.lastActivity,
        sessions: participant.sessions
      };
    });
    
    // Calculate statistics
    const statistics = {
      total_participants: transformedParticipants.length,
      active_now: transformedParticipants.filter(p => p.isActive).length,
      students_identified: transformedParticipants.filter(p => p.studentInfo).length,
      average_duration: transformedParticipants.length > 0 
        ? Math.round(transformedParticipants.reduce((sum, p) => sum + (p.duration || 0), 0) / transformedParticipants.length)
        : 0
    };
    
    console.log('📈 Participant statistics:', statistics);
    
    res.json({
      success: true,
      meetingId: meetingId,
      meetingTitle: meeting.topic,
      participants: transformedParticipants,
      statistics: statistics,
      lastUpdated: new Date().toISOString()
    });
    
  } catch (error) {
    console.error('❌ Error fetching live participants:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch participants: ' + error.message,
      participants: [],
      statistics: {
        total_participants: 0,
        active_now: 0,
        students_identified: 0,
        average_duration: 0
      }
    });
  }
});

// POST /api/zoom/join-tracking - Store join tracking data
router.post('/join-tracking', (req, res) => {
  try {
    const { globalState } = require('../server');
    const io = req.app.get('io');
    
    const {
      meetingId,
      meetingTopic,
      userId,
      userName,
      userEmail,
      studentId,
      participantCount,
      timestamp
    } = req.body;
    
    console.log('📊 [Join Tracking API] Received join tracking data:', req.body);
    
    // Validate required fields
    if (!meetingId || !userId || !userName) {
      return res.status(400).json({
        success: false,
        error: 'Missing required fields: meetingId, userId, userName'
      });
    }
    
    // Create tracking data object
    const trackingData = {
      trackingId: Date.now().toString() + '-' + Math.random().toString(36).substr(2, 9),
      meetingId,
      meetingTopic: meetingTopic || 'Unknown Meeting',
      userId,
      userName,
      userEmail: userEmail || null,
      studentId: studentId || null,
      participantCount: participantCount || 1,
      timestamp: timestamp || new Date().toISOString(),
      message: `Joined "${meetingTopic || 'Unknown Meeting'}" as participant #${participantCount || 1}`
    };
    
    // Store in global state
    globalState.joinTracking.unshift(trackingData);
    
    // Keep only the last 100 join tracking records
    if (globalState.joinTracking.length > 100) {
      globalState.joinTracking = globalState.joinTracking.slice(0, 100);
    }
    
    console.log('📊 [Join Tracking API] Stored tracking data:', trackingData);
    console.log('📊 [Join Tracking API] Total tracking records:', globalState.joinTracking.length);
    
    // Send real-time notification to admin dashboard
    const notification = {
      id: Date.now(),
      type: 'join_tracking',
      title: '👥 User Joined Meeting',
      message: `${userName} joined "${meetingTopic}"`,
      timestamp: new Date().toISOString(),
      meetingId: meetingId,
      trackingData: trackingData
    };
    
    globalState.notifications.push(notification);
    
    if (io) {
      io.emit('notification', notification);
      io.emit('joinTrackingUpdate', { 
        data: trackingData, 
        timestamp: new Date().toISOString() 
      });
    }
    
    res.json({
      success: true,
      trackingId: trackingData.trackingId,
      participantCount: trackingData.participantCount,
      timestamp: trackingData.timestamp,
      message: 'Join tracking data stored successfully'
    });
    
  } catch (error) {
    console.error('❌ Error storing join tracking data:', error);
    res.status(500).json({
      success: false,
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

// GET /api/zoom/join-tracking - Retrieve all join tracking data
router.get('/join-tracking', async (req, res) => {
  try {
    const { globalState } = require('../server');
    const { 
      calculateSessionBasedAttendancePercentage,
      determineSessionBasedAttendanceStatus 
    } = require('../utils/attendanceUtils');
    
    console.log('📊 [Join Tracking API] Fetching join tracking data');
    console.log('📊 [Join Tracking API] Total records available:', globalState.joinTracking.length);
    
    // Get query parameters for filtering
    const { meetingId, userId, limit = 50, threshold = 85 } = req.query;
    const attendanceThreshold = parseFloat(threshold);
    
    let trackingData = [...globalState.joinTracking];
    
    // Filter by meetingId if provided
    if (meetingId) {
      trackingData = trackingData.filter(item => item.meetingId === meetingId);
      console.log('📊 [Join Tracking API] Filtered by meetingId:', meetingId, 'Records:', trackingData.length);
    }
    
    // Filter by userId if provided
    if (userId) {
      trackingData = trackingData.filter(item => item.userId === userId);
      console.log('📊 [Join Tracking API] Filtered by userId:', userId, 'Records:', trackingData.length);
    }
    
    // Apply limit
    const limitNum = parseInt(limit);
    if (limitNum > 0) {
      trackingData = trackingData.slice(0, limitNum);
    }
    
    // Get meeting duration from Participant model if meetingId is specified
    let meetingDuration = 60; // Default to 60 minutes if not found
    let meetingInfo = {};
    
    if (meetingId) {
      try {
        // First try to get from ZoomMeeting model
        const ZoomMeeting = require('../models/ZoomMeeting');
        const meeting = await ZoomMeeting.findOne({ meetingId: meetingId.toString() });
        
        if (meeting) {
          meetingInfo = {
            meetingId: meeting.meetingId,
            topic: meeting.topic,
            startTime: meeting.startTime,
            endTime: meeting.endTime,
            duration: meeting.duration || meeting.actualDuration,
            status: meeting.status
          };
          meetingDuration = meetingInfo.duration || 60;
          console.log(`📊 [Join Tracking API] Found meeting duration: ${meetingDuration} minutes`);
        }
      } catch (meetingError) {
        console.warn('⚠️ [Join Tracking API] Could not fetch meeting details:', meetingError.message);
      }
    }
    
    // Enhance tracking data with attendance calculations
    trackingData = trackingData.map(item => {
      // Calculate session duration based on join timestamp and current time (or leave time if available)
      const joinTime = new Date(item.timestamp);
      const leaveTime = item.leaveTime ? new Date(item.leaveTime) : new Date();
      const sessionDuration = Math.round((leaveTime - joinTime) / (1000 * 60)); // Convert to minutes
      
      // Calculate attendance percentage
      const attendancePercentage = calculateSessionBasedAttendancePercentage(
        sessionDuration,
        meetingDuration,
        item.isActive || false
      );
      
      // Determine attendance status based on 85% threshold
      const attendanceStatus = determineSessionBasedAttendanceStatus(
        attendancePercentage,
        item.isActive || false,
        sessionDuration,
        attendanceThreshold
      );
      
      // Check if participant meets the threshold
      const meetsThreshold = attendancePercentage >= attendanceThreshold;
      
      return {
        ...item,
        duration: sessionDuration,
        meetingDuration,
        attendancePercentage,
        attendanceStatus,
        meetsThreshold
      };
    });
    
    // Calculate statistics
    const totalJoins = globalState.joinTracking.length;
    const uniqueUsers = new Set(globalState.joinTracking.map(item => item.userId)).size;
    const uniqueMeetings = new Set(globalState.joinTracking.map(item => item.meetingId)).size;
    const recentJoins = globalState.joinTracking.filter(item => 
      new Date(item.timestamp) > new Date(Date.now() - 24 * 60 * 60 * 1000)
    ).length;
    
    // Calculate attendance-specific statistics
    const presentCount = trackingData.filter(p => 
      p.meetsThreshold || p.attendanceStatus === 'In Progress'
    ).length;
    
    const absentCount = trackingData.length - presentCount;
    
    const totalAttendancePercentage = trackingData.reduce((sum, p) => 
      sum + (p.attendancePercentage || 0), 0
    );
    
    const averageAttendance = trackingData.length > 0 
      ? Math.round(totalAttendancePercentage / trackingData.length) 
      : 0;
    
    const attendanceRate = trackingData.length > 0 
      ? Math.round((presentCount / trackingData.length) * 100) 
      : 0;
      
    const statistics = {
      totalJoins,
      uniqueUsers,
      uniqueMeetings,
      recentJoins,
      filteredRecords: trackingData.length,
      presentCount,
      absentCount,
      averageAttendance,
      attendanceRate,
      meetingDuration,
      threshold: attendanceThreshold
    };
    
    console.log('📊 [Join Tracking API] Returning data:', {
      records: trackingData.length,
      statistics
    });
    
    res.json({
      success: true,
      data: trackingData,
      statistics,
      filters: {
        meetingId: meetingId || null,
        userId: userId || null,
        limit: limitNum,
        threshold: attendanceThreshold
      },
      timestamp: new Date().toISOString()
    });
    
  } catch (error) {
    console.error('❌ Error retrieving join tracking data:', error);
    res.status(500).json({
      success: false,
      error: error.message,
      data: [],
      statistics: {
        totalJoins: 0,
        uniqueUsers: 0,
        uniqueMeetings: 0,
        recentJoins: 0,
        filteredRecords: 0
      },
      timestamp: new Date().toISOString()
    });
  }
});

// DELETE /api/zoom/join-tracking - Clear all join tracking data
router.delete('/join-tracking', (req, res) => {
  try {
    const { globalState } = require('../server');
    const io = req.app.get('io');
    
    const recordCount = globalState.joinTracking.length;
    
    // Clear join tracking data
    globalState.joinTracking = [];
    
    console.log('🗑️ [Join Tracking API] Cleared all join tracking data:', recordCount, 'records removed');
    
    // Send real-time notification
    const notification = {
      id: Date.now(),
      type: 'join_tracking_cleared',
      title: '🗑️ Join Tracking Cleared',
      message: `All join tracking data cleared (${recordCount} records)`,
      timestamp: new Date().toISOString()
    };
    
    globalState.notifications.push(notification);
    
    if (io) {
      io.emit('notification', notification);
      io.emit('joinTrackingCleared', { 
        timestamp: new Date().toISOString(),
        recordsCleared: recordCount
      });
    }
    
    res.json({
      success: true,
      message: 'All join tracking data cleared successfully',
      recordsCleared: recordCount,
      timestamp: new Date().toISOString()
    });
    
  } catch (error) {
    console.error('❌ Error clearing join tracking data:', error);
    res.status(500).json({
      success: false,
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

module.exports = router;
