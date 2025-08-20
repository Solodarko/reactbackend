const express = require('express');
const simpleZoomService = require('../services/simpleZoomService');

const router = express.Router();

// Health check endpoint
router.get('/health', async (req, res) => {
  try {
    const health = await simpleZoomService.healthCheck();
    
    if (health.status === 'healthy') {
      res.json({
        success: true,
        message: 'Zoom integration is healthy',
        ...health
      });
    } else {
      res.status(503).json({
        success: false,
        message: 'Zoom integration is unhealthy',
        ...health
      });
    }
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

// Generate signature for SDK
router.post('/generate-signature', async (req, res) => {
  try {
    const { meetingNumber, role } = req.body;

    if (!meetingNumber) {
      return res.status(400).json({
        success: false,
        error: 'Meeting number is required'
      });
    }

    // Normalize meeting number format (remove all non-digits)
    const normalizedMeetingNumber = String(meetingNumber).replace(/[^0-9]/g, '');
    
    console.log('📝 Generating signature for meeting:', meetingNumber);
    console.log('🔧 Normalized meeting number:', normalizedMeetingNumber);

    if (!/^\d{9,11}$/.test(normalizedMeetingNumber)) {
      return res.status(400).json({
        success: false,
        error: `Invalid meeting number format. Expected 9-11 digits, got: "${normalizedMeetingNumber}"`
      });
    }

    const signature = simpleZoomService.generateSignature(normalizedMeetingNumber, role);

    res.json({
      success: true,
      signature,
      sdkKey: process.env.ZOOM_CLIENT_ID,
      meetingNumber: normalizedMeetingNumber, // Return the normalized number
      role: parseInt(role) || 0
    });

  } catch (error) {
    console.error('❌ Signature generation error:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Create meeting
router.post('/create-meeting', async (req, res) => {
  try {
    console.log('🚀 Creating new meeting...');

    const meetingData = {
      topic: req.body.topic || 'New Meeting',
      type: req.body.type || 1,
      duration: req.body.duration || 60,
      password: req.body.password || undefined,
      agenda: req.body.agenda || '',
      settings: {
        host_video: req.body.settings?.host_video !== undefined ? req.body.settings.host_video : true,
        participant_video: req.body.settings?.participant_video !== undefined ? req.body.settings.participant_video : true,
        join_before_host: req.body.settings?.join_before_host !== undefined ? req.body.settings.join_before_host : true,
        mute_upon_entry: req.body.settings?.mute_upon_entry !== undefined ? req.body.settings.mute_upon_entry : false,
        waiting_room: req.body.settings?.waiting_room !== undefined ? req.body.settings.waiting_room : false,
        approval_type: req.body.settings?.approval_type !== undefined ? req.body.settings.approval_type : 0,
        auto_recording: req.body.settings?.auto_recording || 'none'
      }
    };

    const meeting = await simpleZoomService.createMeeting(meetingData);

    res.json({
      success: true,
      message: 'Meeting created successfully',
      meeting
    });

  } catch (error) {
    console.error('❌ Meeting creation error:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Get meeting details
router.get('/meeting/:meetingId', async (req, res) => {
  try {
    const { meetingId } = req.params;

    if (!meetingId) {
      return res.status(400).json({
        success: false,
        error: 'Meeting ID is required'
      });
    }

    console.log('📋 Getting meeting details for:', meetingId);

    const meeting = await simpleZoomService.getMeetingDetails(meetingId);

    res.json({
      success: true,
      meeting
    });

  } catch (error) {
    console.error('❌ Get meeting details error:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Get user info (for testing credentials)
router.get('/user-info', async (req, res) => {
  try {
    console.log('👤 Getting user info...');

    const userInfo = await simpleZoomService.getUserInfo();

    res.json({
      success: true,
      message: 'User info retrieved successfully',
      user: {
        id: userInfo.id,
        email: userInfo.email,
        first_name: userInfo.first_name,
        last_name: userInfo.last_name,
        account_id: userInfo.account_id
      }
    });

  } catch (error) {
    console.error('❌ Get user info error:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Test endpoint to validate setup
router.get('/test', async (req, res) => {
  try {
    console.log('🧪 Running Zoom integration test...');

    // Check environment variables
    const requiredEnvVars = ['ZOOM_ACCOUNT_ID', 'ZOOM_CLIENT_ID', 'ZOOM_CLIENT_SECRET'];
    const missingVars = requiredEnvVars.filter(varName => !process.env[varName]);

    if (missingVars.length > 0) {
      return res.status(500).json({
        success: false,
        error: `Missing environment variables: ${missingVars.join(', ')}`,
        setup: 'incomplete'
      });
    }

    // Test API connection
    const userInfo = await simpleZoomService.getUserInfo();

    // Test signature generation
    const testSignature = simpleZoomService.generateSignature('123456789', 0);

    res.json({
      success: true,
      message: 'Zoom integration test successful',
      tests: {
        environment: 'passed',
        authentication: 'passed',
        signature_generation: 'passed'
      },
      user: {
        email: userInfo.email,
        name: `${userInfo.first_name} ${userInfo.last_name}`
      },
      setup: 'complete'
    });

  } catch (error) {
    console.error('❌ Integration test failed:', error);
    res.status(500).json({
      success: false,
      error: error.message,
      tests: {
        environment: 'unknown',
        authentication: 'failed',
        signature_generation: 'unknown'
      },
      setup: 'incomplete'
    });
  }
});

module.exports = router;
