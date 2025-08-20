const express = require('express');
const router = express.Router();
const ZoomMeeting = require('../models/ZoomMeeting');

/**
 * Clear all Zoom-related data
 * POST /api/zoom/clear-all
 */
router.post('/clear-all', async (req, res) => {
  try {
    console.log('🧹 Clear Zoom Data: Starting clear operation');
    
    let deletedCount = 0;
    let clearedCollections = [];

    // Clear Zoom meetings from database
    try {
      const result = await ZoomMeeting.deleteMany({});
      deletedCount += result.deletedCount;
      clearedCollections.push(`ZoomMeetings (${result.deletedCount} records)`);
      console.log(`✅ Cleared ${result.deletedCount} zoom meetings from database`);
    } catch (dbError) {
      console.warn('⚠️ Could not clear ZoomMeeting collection:', dbError.message);
    }

    // Get socket.io instance and emit clear event
    const io = req.app.get('io');
    const globalState = req.app.get('globalState');
    
    if (io) {
      // Clear active meetings and participants from global state
      if (globalState) {
        const activeMeetings = globalState.activeMeetings?.size || 0;
        const activeParticipants = globalState.activeParticipants?.size || 0;
        
        globalState.activeMeetings?.clear();
        globalState.activeParticipants?.clear();
        
        // Reset meeting analytics
        if (globalState.meetingAnalytics) {
          globalState.meetingAnalytics.totalMeetings = 0;
          globalState.meetingAnalytics.activeNow = 0;
          globalState.meetingAnalytics.totalParticipants = 0;
        }
        
        clearedCollections.push(`Active meetings (${activeMeetings})`);
        clearedCollections.push(`Active participants (${activeParticipants})`);
        
        console.log(`✅ Cleared ${activeMeetings} active meetings and ${activeParticipants} participants from memory`);
      }
      
      // Emit clear event to all connected clients
      io.emit('zoomDataCleared', {
        timestamp: new Date().toISOString(),
        deletedCount,
        clearedCollections,
        message: 'All Zoom data has been cleared'
      });
      
      console.log('📡 Emitted zoomDataCleared event to all clients');
    }

    // Clear any cached data (if using cache)
    // You can add cache clearing logic here if needed

    const response = {
      success: true,
      message: `Successfully cleared all Zoom data`,
      details: {
        deletedRecords: deletedCount,
        clearedCollections,
        timestamp: new Date().toISOString()
      }
    };

    console.log('🧹 Clear Zoom Data: Operation completed successfully', response.details);
    
    res.json(response);
    
  } catch (error) {
    console.error('❌ Clear Zoom Data: Operation failed:', error);
    
    res.status(500).json({
      success: false,
      error: 'Failed to clear Zoom data',
      details: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

/**
 * Clear specific meeting data
 * POST /api/zoom/clear-meeting/:meetingId
 */
router.post('/clear-meeting/:meetingId', async (req, res) => {
  try {
    const { meetingId } = req.params;
    console.log(`🧹 Clear Meeting Data: Starting clear for meeting ${meetingId}`);
    
    let deletedCount = 0;
    let clearedItems = [];

    // Clear specific meeting from database
    try {
      const result = await ZoomMeeting.deleteOne({ meetingId: meetingId });
      deletedCount += result.deletedCount;
      if (result.deletedCount > 0) {
        clearedItems.push(`Meeting ${meetingId} from database`);
      }
    } catch (dbError) {
      console.warn(`⚠️ Could not clear meeting ${meetingId} from database:`, dbError.message);
    }

    // Clear from global state
    const globalState = req.app.get('globalState');
    if (globalState) {
      // Remove from active meetings
      if (globalState.activeMeetings?.has(meetingId)) {
        globalState.activeMeetings.delete(meetingId);
        clearedItems.push(`Meeting ${meetingId} from active meetings`);
      }
      
      // Remove participants of this meeting
      if (globalState.activeParticipants) {
        const participantsToRemove = [];
        for (const [key, participant] of globalState.activeParticipants.entries()) {
          if (participant.meetingId === meetingId) {
            participantsToRemove.push(key);
          }
        }
        
        participantsToRemove.forEach(key => {
          globalState.activeParticipants.delete(key);
        });
        
        if (participantsToRemove.length > 0) {
          clearedItems.push(`${participantsToRemove.length} participants of meeting ${meetingId}`);
        }
      }
    }

    // Emit clear event for specific meeting
    const io = req.app.get('io');
    if (io) {
      io.emit('meetingDataCleared', {
        meetingId,
        timestamp: new Date().toISOString(),
        clearedItems,
        message: `Meeting ${meetingId} data has been cleared`
      });
    }

    const response = {
      success: true,
      message: `Successfully cleared data for meeting ${meetingId}`,
      details: {
        meetingId,
        deletedRecords: deletedCount,
        clearedItems,
        timestamp: new Date().toISOString()
      }
    };

    console.log(`🧹 Clear Meeting Data: Operation completed for meeting ${meetingId}`, response.details);
    
    res.json(response);
    
  } catch (error) {
    console.error(`❌ Clear Meeting Data: Operation failed for meeting ${req.params.meetingId}:`, error);
    
    res.status(500).json({
      success: false,
      error: 'Failed to clear meeting data',
      details: error.message,
      meetingId: req.params.meetingId,
      timestamp: new Date().toISOString()
    });
  }
});

/**
 * Get clear operation status/history
 * GET /api/zoom/clear-status
 */
router.get('/clear-status', async (req, res) => {
  try {
    const globalState = req.app.get('globalState');
    
    const status = {
      success: true,
      timestamp: new Date().toISOString(),
      currentState: {
        activeMeetings: globalState?.activeMeetings?.size || 0,
        activeParticipants: globalState?.activeParticipants?.size || 0,
        totalNotifications: globalState?.notifications?.length || 0
      },
      database: {
        // You can add database counts here if needed
      }
    };

    res.json(status);
    
  } catch (error) {
    console.error('❌ Clear Status: Failed to get status:', error);
    
    res.status(500).json({
      success: false,
      error: 'Failed to get clear status',
      details: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

module.exports = router;
