const express = require('express');
const AttendanceTracker = require('../services/attendanceTracker');

const router = express.Router();

// Initialize AttendanceTracker instance
let attendanceTracker = null;

// Initialize the tracker when this module is required
const initializeTracker = async () => {
  try {
    if (!attendanceTracker) {
      attendanceTracker = new AttendanceTracker();
      attendanceTracker.init();
      console.log('✅ AttendanceTracker initialized');
    }
    return attendanceTracker;
  } catch (error) {
    console.error('❌ Failed to initialize AttendanceTracker:', error);
    throw error;
  }
};

// Initialize the tracker immediately
initializeTracker().catch(error => {
  console.error('❌ Failed to initialize AttendanceTracker on module load:', error);
});

// POST /api/attendance-tracker/start/:meetingId - Start tracking attendance for a meeting
router.post('/start/:meetingId', async (req, res) => {
  try {
    if (!attendanceTracker) {
      await initializeTracker();
    }

    const { meetingId } = req.params;
    
    if (!meetingId) {
      return res.status(400).json({
        success: false,
        error: 'Meeting ID is required',
        message: 'Please provide a valid meeting ID to start tracking'
      });
    }

    console.log(`🎯 Starting attendance tracking for meeting: ${meetingId}`);

    // Start tracking the meeting
    const result = await attendanceTracker.startTrackingMeeting(meetingId);
    
    if (result) {
      // Get real-time updates via Socket.IO
      const io = req.app.get('io');
      if (io) {
        io.emit('attendanceTrackingStarted', {
          meetingId,
          message: 'Attendance tracking started successfully',
          timestamp: new Date().toISOString()
        });
      }

      res.json({
        success: true,
        meetingId,
        message: 'Attendance tracking started successfully',
        trackingStatus: attendanceTracker.getTrackingStatus(),
        timestamp: new Date().toISOString()
      });
    } else {
      res.status(400).json({
        success: false,
        meetingId,
        error: 'Failed to start attendance tracking',
        message: 'Unable to start tracking for this meeting. Please check if the meeting exists and is accessible.',
        timestamp: new Date().toISOString()
      });
    }
  } catch (error) {
    console.error(`❌ Error starting attendance tracking for meeting ${req.params.meetingId}:`, error);
    
    res.status(500).json({
      success: false,
      meetingId: req.params.meetingId,
      error: error.message,
      message: 'An error occurred while starting attendance tracking',
      details: error.stack || 'No additional details available',
      timestamp: new Date().toISOString()
    });
  }
});

// POST /api/attendance-tracker/start-test/:meetingId - Start test tracking with mock data
router.post('/start-test/:meetingId', async (req, res) => {
  try {
    if (!attendanceTracker) {
      await initializeTracker();
    }

    const { meetingId } = req.params;
    
    if (!meetingId) {
      return res.status(400).json({
        success: false,
        error: 'Meeting ID is required',
        message: 'Please provide a valid meeting ID to start test tracking'
      });
    }

    console.log(`🧪 Starting test attendance tracking for meeting: ${meetingId}`);

    // Start test tracking the meeting
    const result = await attendanceTracker.startTrackingWithTestData(meetingId);
    
    if (result) {
      // Get real-time updates via Socket.IO
      const io = req.app.get('io');
      if (io) {
        io.emit('attendanceTrackingStarted', {
          meetingId,
          mode: 'test',
          message: 'Test attendance tracking started successfully',
          timestamp: new Date().toISOString()
        });
      }

      res.json({
        success: true,
        meetingId,
        mode: 'test',
        message: 'Test attendance tracking started successfully',
        trackingStatus: attendanceTracker.getTrackingStatus(),
        timestamp: new Date().toISOString()
      });
    } else {
      res.status(400).json({
        success: false,
        meetingId,
        mode: 'test',
        error: 'Failed to start test attendance tracking',
        message: 'Unable to start test tracking for this meeting.',
        timestamp: new Date().toISOString()
      });
    }
  } catch (error) {
    console.error(`❌ Error starting test attendance tracking for meeting ${req.params.meetingId}:`, error);
    
    res.status(500).json({
      success: false,
      meetingId: req.params.meetingId,
      mode: 'test',
      error: error.message,
      message: 'An error occurred while starting test attendance tracking',
      details: error.stack || 'No additional details available',
      timestamp: new Date().toISOString()
    });
  }
});

// POST /api/attendance-tracker/stop/:meetingId - Stop tracking attendance for a meeting
router.post('/stop/:meetingId', async (req, res) => {
  try {
    if (!attendanceTracker) {
      return res.status(500).json({
        success: false,
        error: 'AttendanceTracker not initialized'
      });
    }

    const { meetingId } = req.params;
    
    console.log(`⏹️ Stopping attendance tracking for meeting: ${meetingId}`);

    const result = attendanceTracker.stopTrackingMeeting(meetingId);
    
    // Get real-time updates via Socket.IO
    const io = req.app.get('io');
    if (io) {
      io.emit('attendanceTrackingStopped', {
        meetingId,
        message: 'Attendance tracking stopped',
        timestamp: new Date().toISOString()
      });
    }

    if (result) {
      res.json({
        success: true,
        meetingId,
        message: 'Attendance tracking stopped successfully',
        trackingStatus: attendanceTracker.getTrackingStatus(),
        timestamp: new Date().toISOString()
      });
    } else {
      res.status(404).json({
        success: false,
        meetingId,
        error: 'Meeting was not being tracked',
        message: 'No active tracking found for this meeting',
        timestamp: new Date().toISOString()
      });
    }
  } catch (error) {
    console.error(`❌ Error stopping attendance tracking for meeting ${req.params.meetingId}:`, error);
    
    res.status(500).json({
      success: false,
      meetingId: req.params.meetingId,
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

// GET /api/attendance-tracker/status - Get tracking status for all meetings
router.get('/status', async (req, res) => {
  try {
    if (!attendanceTracker) {
      await initializeTracker();
    }

    const trackingStatus = attendanceTracker.getTrackingStatus();
    
    res.json({
      success: true,
      ...trackingStatus,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('❌ Error getting tracking status:', error);
    
    res.status(500).json({
      success: false,
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

// GET /api/attendance-tracker/status/:meetingId - Get tracking status for a specific meeting
router.get('/status/:meetingId', async (req, res) => {
  try {
    if (!attendanceTracker) {
      await initializeTracker();
    }

    const { meetingId } = req.params;
    const trackingStatus = attendanceTracker.getTrackingStatus();
    
    const isTracking = trackingStatus.activeMeetings.includes(meetingId);
    
    res.json({
      success: true,
      meetingId,
      isTracking,
      trackingStatus,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error(`❌ Error getting tracking status for meeting ${req.params.meetingId}:`, error);
    
    res.status(500).json({
      success: false,
      meetingId: req.params.meetingId,
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

// GET /api/attendance-tracker/attendance/:meetingId - Get current attendance for a meeting
router.get('/attendance/:meetingId', async (req, res) => {
  try {
    if (!attendanceTracker) {
      await initializeTracker();
    }

    const { meetingId } = req.params;
    const { enriched } = req.query; // Add query parameter to get enriched data
    
    console.log(`📊 Getting ${enriched === 'true' ? 'enriched' : 'current'} attendance for meeting: ${meetingId}`);

    // Get attendance data (enriched with user session info or regular)
    let attendanceData;
    if (enriched === 'true') {
      attendanceData = await attendanceTracker.getEnrichedAttendanceData(meetingId);
    } else {
      attendanceData = await attendanceTracker.getCurrentAttendance(meetingId);
    }
    
    // Emit Socket.IO update if successful
    if (attendanceData.success) {
      try {
        const io = req.app.get('io');
        if (io) {
          io.emit('attendanceDataFetched', {
            meetingId,
            type: enriched === 'true' ? 'enriched' : 'regular',
            ...attendanceData,
            requestedAt: new Date().toISOString()
          });
        }
      } catch (socketError) {
        console.warn('Socket.IO emission failed:', socketError.message);
      }
    }
    
    res.json(attendanceData);
  } catch (error) {
    console.error(`❌ Error getting attendance for meeting ${req.params.meetingId}:`, error);
    
    res.status(500).json({
      success: false,
      meetingId: req.params.meetingId,
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

// POST /api/attendance-tracker/generate-report/:meetingId - Generate final attendance report
router.post('/generate-report/:meetingId', async (req, res) => {
  try {
    if (!attendanceTracker) {
      await initializeTracker();
    }

    const { meetingId } = req.params;
    
    console.log(`📋 Generating final attendance report for meeting: ${meetingId}`);

    const reportData = await attendanceTracker.generateFinalAttendanceReport(meetingId);
    
    // Get real-time updates via Socket.IO
    const io = req.app.get('io');
    if (io) {
      io.emit('attendanceReportGenerated', {
        meetingId,
        reportData,
        timestamp: new Date().toISOString()
      });
    }
    
    res.json(reportData);
  } catch (error) {
    console.error(`❌ Error generating attendance report for meeting ${req.params.meetingId}:`, error);
    
    res.status(500).json({
      success: false,
      meetingId: req.params.meetingId,
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

// GET /api/attendance-tracker/summary - Get attendance summary for multiple meetings
router.get('/summary', async (req, res) => {
  try {
    if (!attendanceTracker) {
      await initializeTracker();
    }

    const { dateFrom, dateTo, studentId } = req.query;
    
    console.log(`📊 Getting attendance summary from ${dateFrom} to ${dateTo} for student ${studentId || 'all'}`);

    const summaryData = await attendanceTracker.getAttendanceSummary(dateFrom, dateTo, studentId);
    
    res.json(summaryData);
  } catch (error) {
    console.error('❌ Error getting attendance summary:', error);
    
    res.status(500).json({
      success: false,
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

// GET /api/attendance-tracker/zoom-duration-attendance/:meetingId - Get 85% threshold attendance data
router.get('/zoom-duration-attendance/:meetingId', async (req, res) => {
  try {
    if (!attendanceTracker) {
      await initializeTracker();
    }

    const { meetingId } = req.params;
    const { threshold = '85' } = req.query; // Default to 85% threshold
    const thresholdValue = parseInt(threshold, 10);
    
    console.log(`📊 Getting ${thresholdValue}% duration attendance for meeting: ${meetingId}`);

    // Get attendance data 
    const attendanceData = await attendanceTracker.getCurrentAttendance(meetingId);
    
    if (attendanceData.success) {
      // Convert attendance data with 85% threshold logic
      const meetingDuration = attendanceData.statistics?.meetingDuration || 60; // Default to 60 min if not available
      
      // Apply 85% threshold to participants
      const processedParticipants = (attendanceData.participants || []).map(participant => {
        const duration = participant.duration || 0;
        const attendancePercentage = Math.round((duration / meetingDuration) * 100);
        const meetsThreshold = attendancePercentage >= thresholdValue;
        
        return {
          ...participant,
          attendancePercentage,
          meetsThreshold,
          attendanceStatus: participant.isActive 
            ? 'In Progress' 
            : meetsThreshold ? 'Present' : 'Absent',
          thresholdDuration: Math.round(meetingDuration * (thresholdValue / 100))
        };
      });
      
      // Calculate statistics
      const presentCount = processedParticipants.filter(p => p.meetsThreshold || p.attendanceStatus === 'In Progress').length;
      const absentCount = processedParticipants.length - presentCount;
      const totalPercentage = processedParticipants.reduce((sum, p) => sum + (p.attendancePercentage || 0), 0);
      
      const enhancedResponse = {
        success: true,
        meetingId,
        participants: processedParticipants,
        statistics: {
          totalParticipants: processedParticipants.length,
          presentCount,
          absentCount,
          averageAttendance: processedParticipants.length > 0 ? Math.round(totalPercentage / processedParticipants.length) : 0,
          meetingDuration,
          attendanceRate: processedParticipants.length > 0 ? Math.round((presentCount / processedParticipants.length) * 100) : 0,
          thresholdDuration: Math.round(meetingDuration * (thresholdValue / 100)),
          threshold: thresholdValue
        },
        timestamp: new Date().toISOString()
      };
      
      // Emit Socket.IO update if successful
      try {
        const io = req.app.get('io');
        if (io) {
          io.emit('attendanceDurationDataFetched', {
            meetingId,
            threshold: thresholdValue,
            timestamp: new Date().toISOString()
          });
        }
      } catch (socketError) {
        console.warn('Socket.IO emission failed:', socketError.message);
      }
      
      res.json(enhancedResponse);
    } else {
      res.json(attendanceData); // Pass through the error response
    }
  } catch (error) {
    console.error(`❌ Error getting duration-based attendance for meeting ${req.params.meetingId}:`, error);
    
    res.status(500).json({
      success: false,
      meetingId: req.params.meetingId,
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

// GET /api/attendance-tracker/health - Health check for AttendanceTracker
router.get('/health', async (req, res) => {
  try {
    const isInitialized = !!attendanceTracker;
    let trackingStatus = null;
    
    if (isInitialized) {
      trackingStatus = attendanceTracker.getTrackingStatus();
    }
    
    res.json({
      success: true,
      health: 'ok',
      initialized: isInitialized,
      tracking: trackingStatus,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      health: 'error',
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

// GET /api/attendance-tracker/enhanced-metrics - Get enhanced health metrics
router.get('/enhanced-metrics', async (req, res) => {
  try {
    if (!attendanceTracker) {
      await initializeTracker();
    }

    const healthMetrics = attendanceTracker.getHealthMetrics();
    const trackingStatus = attendanceTracker.getTrackingStatus();
    
    res.json({
      success: true,
      healthMetrics,
      trackingStatus,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('❌ Error getting enhanced metrics:', error);
    
    res.status(500).json({
      success: false,
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

// GET /api/attendance-tracker/cache-stats - Get caching statistics
router.get('/cache-stats', async (req, res) => {
  try {
    if (!attendanceTracker) {
      await initializeTracker();
    }

    const healthMetrics = attendanceTracker.getHealthMetrics();
    const cacheStats = healthMetrics.cache || {};
    
    res.json({
      success: true,
      cache: cacheStats,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('❌ Error getting cache stats:', error);
    
    res.status(500).json({
      success: false,
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

// GET /api/attendance-tracker/retry-stats - Get retry statistics
router.get('/retry-stats', async (req, res) => {
  try {
    if (!attendanceTracker) {
      await initializeTracker();
    }

    const healthMetrics = attendanceTracker.getHealthMetrics();
    const retryStats = healthMetrics.retries || {};
    
    res.json({
      success: true,
      retries: retryStats,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('❌ Error getting retry stats:', error);
    
    res.status(500).json({
      success: false,
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

// GET /api/attendance-tracker/configuration - Get current configuration
router.get('/configuration', async (req, res) => {
  try {
    if (!attendanceTracker) {
      await initializeTracker();
    }

    const trackingStatus = attendanceTracker.getTrackingStatus();
    const configuration = trackingStatus.configuration || {};
    
    res.json({
      success: true,
      configuration,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('❌ Error getting configuration:', error);
    
    res.status(500).json({
      success: false,
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

// POST /api/attendance-tracker/configuration - Update configuration
router.post('/configuration', async (req, res) => {
  try {
    if (!attendanceTracker) {
      await initializeTracker();
    }

    const { configuration } = req.body;
    
    if (!configuration) {
      return res.status(400).json({
        success: false,
        error: 'Configuration data is required',
        timestamp: new Date().toISOString()
      });
    }

    // Update configuration using the enhanced tracker's method
    const result = attendanceTracker.updateConfiguration(configuration);
    
    // Get real-time updates via Socket.IO
    const io = req.app.get('io');
    if (io) {
      io.emit('attendanceTrackerConfigUpdated', {
        configuration: result.configuration,
        timestamp: new Date().toISOString()
      });
    }
    
    res.json({
      success: true,
      message: 'Configuration updated successfully',
      configuration: result.configuration,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('❌ Error updating configuration:', error);
    
    res.status(500).json({
      success: false,
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

// POST /api/attendance-tracker/reset-metrics - Reset health metrics
router.post('/reset-metrics', async (req, res) => {
  try {
    if (!attendanceTracker) {
      await initializeTracker();
    }

    // Reset health metrics using the enhanced tracker's method
    attendanceTracker.resetHealthMetrics();
    
    // Get real-time updates via Socket.IO
    const io = req.app.get('io');
    if (io) {
      io.emit('attendanceTrackerMetricsReset', {
        timestamp: new Date().toISOString()
      });
    }
    
    res.json({
      success: true,
      message: 'Health metrics reset successfully',
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('❌ Error resetting metrics:', error);
    
    res.status(500).json({
      success: false,
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

// GET /api/attendance-tracker/system-overview - Get comprehensive system overview
router.get('/system-overview', async (req, res) => {
  try {
    if (!attendanceTracker) {
      await initializeTracker();
    }

    const healthMetrics = attendanceTracker.getHealthMetrics();
    const trackingStatus = attendanceTracker.getTrackingStatus();
    
    // Comprehensive overview combining all enhanced features
    const systemOverview = {
      health: {
        status: healthMetrics.requests?.total > 0 ? 
                (healthMetrics.requests.successful / healthMetrics.requests.total > 0.9 ? 'healthy' : 'warning') : 
                'unknown',
        uptime: trackingStatus.uptime,
        requests: healthMetrics.requests,
        errors: healthMetrics.errors,
        rateLimit: healthMetrics.rateLimit,
        memory: healthMetrics.memory
      },
      cache: {
        ...healthMetrics.cache,
        hitRate: healthMetrics.cache?.hits > 0 ? 
                 (healthMetrics.cache.hits / (healthMetrics.cache.hits + healthMetrics.cache.misses) * 100).toFixed(1) : '0'
      },
      retries: healthMetrics.retries,
      tracking: {
        activeMeetings: Object.keys(trackingStatus.activeMeetings || {}).length,
        totalMeetingsTracked: trackingStatus.totalMeetingsTracked || 0,
        activeMeetingsList: trackingStatus.activeMeetings
      },
      configuration: trackingStatus.configuration
    };
    
    res.json({
      success: true,
      overview: systemOverview,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('❌ Error getting system overview:', error);
    
    res.status(500).json({
      success: false,
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

module.exports = router;
