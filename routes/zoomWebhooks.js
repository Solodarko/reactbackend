const express = require('express');
const WebhookValidator = require('../services/webhookValidator');
const WebhookEventHandler = require('../services/webhookEventHandler');
const ReconciliationService = require('../services/reconciliationService');
const ZoomAttendance = require('../models/ZoomAttendance');
const ZoomMeeting = require('../models/ZoomMeeting');

const router = express.Router();

// Initialize services
const webhookValidator = new WebhookValidator();
const reconciliationService = new ReconciliationService();
let webhookEventHandler = null; // Will be initialized with io and globalState

/**
 * Initialize webhook routes with Socket.IO and global state
 * @param {Object} io - Socket.IO instance
 * @param {Object} globalState - Global application state
 */
function initializeWebhookRoutes(io, globalState) {
  webhookEventHandler = new WebhookEventHandler(io, globalState);
  console.log('✅ Webhook routes initialized with Socket.IO');
}

/**
 * POST /api/webhooks/zoom
 * Main webhook endpoint - handles all Zoom webhook events
 */
router.post('/zoom', webhookValidator.validateWebhookMiddleware(), async (req, res) => {
  try {
    console.log(`🎯 Processing webhook: ${req.zoomEvent.eventType}`);
    
    // Log the webhook event for debugging
    webhookValidator.logWebhookEvent(req.zoomEvent);

    // Process the webhook event
    let result = { success: false, message: 'Event handler not initialized' };
    
    if (webhookEventHandler) {
      result = await webhookEventHandler.processWebhookEvent(req.zoomEvent);
    }

    // Send response to Zoom
    res.status(200).json({
      message: 'Webhook processed successfully',
      eventType: req.zoomEvent.eventType,
      meetingId: req.zoomEvent.meetingId,
      processed: result.success,
      timestamp: new Date().toISOString()
    });

    console.log(`${result.success ? '✅' : '❌'} Webhook processing ${result.success ? 'completed' : 'failed'}`);

  } catch (error) {
    console.error('❌ Error processing webhook:', error);
    res.status(500).json({
      error: 'Internal server error',
      message: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

/**
 * GET /api/webhooks/webhook-config
 * Get webhook configuration information
 */
router.get('/webhook-config', (req, res) => {
  try {
    const config = webhookValidator.validateConfiguration();
    const baseUrl = process.env.FRONTEND_URL || req.get('origin') || `${req.protocol}://${req.get('host')}`;
    
    res.json({
      configuration: config,
      webhookUrl: webhookValidator.generateWebhookUrl(baseUrl.replace(':5173', ':5000'), '/api/webhooks/zoom'),
      supportedEvents: [
        'meeting.participant_joined',
        'meeting.participant_left', 
        'meeting.ended',
        'endpoint.url_validation'
      ],
      setup: {
        step1: 'Configure ZOOM_WEBHOOK_SECRET_TOKEN in your .env file',
        step2: 'Add the webhook URL to your Zoom app configuration',
        step3: 'Subscribe to the supported events',
        step4: 'Test with the /test-webhook endpoint'
      },
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /api/webhooks/test-webhook
 * Test webhook functionality with sample data
 */
router.post('/test-webhook', async (req, res) => {
  try {
    const { event, payload } = req.body;

    if (!event || !payload) {
      return res.status(400).json({
        success: false,
        error: 'Invalid test webhook payload. Must include event and payload fields.',
        timestamp: new Date().toISOString()
      });
    }

    const testEvent = {
      event: event,
      payload: payload,
      isValid: true // Mark as valid for testing purposes
    };

    let result = { success: false, message: 'Event handler not initialized' };
    
    if (webhookEventHandler) {
      result = await webhookEventHandler.processWebhookEvent(testEvent);
    }

    res.json({
      success: true,
      message: 'Test webhook processed',
      testEvent: {
        eventType: testEvent.eventType,
        meetingId: testEvent.meetingId,
        participantName: testEvent.participant?.user_name
      },
      result: result,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('❌ Error testing webhook:', error);
    res.status(500).json({
      success: false,
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

/**
 * GET /api/zoom/attendance/:meetingId
 * Get real-time attendance data for a meeting
 */
router.get('/attendance/:meetingId', async (req, res) => {
  try {
    const { meetingId } = req.params;
    const { format = 'json' } = req.query;

    const attendanceSummary = await ZoomAttendance.getAttendanceSummary(meetingId);
    
    if (format === 'csv') {
      // Convert to CSV format
      const csvHeaders = 'Meeting ID,Student ID,Name,Email,Department,Join Time,Leave Time,Duration (sec),Status,Attendance %,Matched\n';
      const csvRows = attendanceSummary.participants.map(p => {
        const student = p.student;
        return [
          meetingId,
          student?.StudentID || 'N/A',
          student ? `${student.FirstName} ${student.LastName}` : p.participantName,
          p.participantEmail || student?.Email || 'N/A',
          student?.Department || 'N/A',
          new Date(p.joinTime).toISOString(),
          p.leaveTime ? new Date(p.leaveTime).toISOString() : 'Still in meeting',
          p.duration || 0,
          p.attendanceStatus,
          p.attendancePercentage || 0,
          p.isMatched
        ].join(',');
      }).join('\n');

      const csv = csvHeaders + csvRows;
      
      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', `attachment; filename="attendance-${meetingId}-${new Date().toISOString().split('T')[0]}.csv"`);
      res.send(csv);
      return;
    }

    res.json(attendanceSummary);

  } catch (error) {
    console.error('❌ Error getting attendance:', error);
    res.status(500).json({
      success: false,
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

/**
 * POST /api/zoom/reconcile/:meetingId
 * Manually trigger reconciliation for a specific meeting
 */
router.post('/reconcile/:meetingId', async (req, res) => {
  try {
    const { meetingId } = req.params;
    const { force = false } = req.query;

    // Check if meeting exists and hasn't been reconciled (unless forced)
    const meeting = await ZoomMeeting.findOne({
      $or: [{ meetingId }, { meetingUuid: meetingId }]
    });

    if (!meeting) {
      return res.status(404).json({
        success: false,
        error: 'Meeting not found',
        meetingId
      });
    }

    if (meeting.reconciliationCompleted && !force) {
      return res.status(409).json({
        success: false,
        error: 'Meeting already reconciled. Use ?force=true to reconcile again.',
        meetingId,
        reconciledAt: meeting.reconciliationCompletedAt
      });
    }

    console.log(`🔄 Manual reconciliation requested for meeting: ${meetingId}`);
    const result = await reconciliationService.reconcileMeetingAttendance(meetingId);

    res.json({
      success: result.success,
      meetingId: result.meetingId,
      summary: result.success ? {
        webhook: result.webhook,
        api: result.api,
        reconciliation: result.reconciliation,
        duration: result.duration
      } : null,
      error: result.error,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('❌ Error in manual reconciliation:', error);
    res.status(500).json({
      success: false,
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

/**
 * GET /api/zoom/reconciliation-queue
 * Get current reconciliation queue status
 */
router.get('/reconciliation-queue', (req, res) => {
  try {
    const queue = webhookEventHandler ? webhookEventHandler.getReconciliationQueue() : [];
    const stats = webhookEventHandler ? webhookEventHandler.getProcessingStats() : {};

    res.json({
      queue: queue,
      stats: stats,
      actions: {
        process: 'POST /api/zoom/process-reconciliation-queue',
        clear: 'DELETE /api/zoom/reconciliation-queue'
      },
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /api/zoom/process-reconciliation-queue
 * Process all queued meetings for reconciliation
 */
router.post('/process-reconciliation-queue', async (req, res) => {
  try {
    if (!webhookEventHandler) {
      return res.status(503).json({
        error: 'Webhook event handler not initialized'
      });
    }

    const queue = webhookEventHandler.getReconciliationQueue();
    
    if (queue.length === 0) {
      return res.json({
        success: true,
        message: 'No meetings in reconciliation queue',
        processed: 0,
        timestamp: new Date().toISOString()
      });
    }

    console.log(`🔄 Processing reconciliation queue: ${queue.length} meetings`);
    const results = await reconciliationService.processReconciliationQueue(queue);

    // Remove processed meetings from queue
    results.forEach(result => {
      if (result.success) {
        webhookEventHandler.removeFromReconciliationQueue(result.meetingId);
      }
    });

    const successful = results.filter(r => r.success).length;
    const failed = results.filter(r => !r.success).length;

    res.json({
      success: true,
      message: `Processed reconciliation queue: ${successful} successful, ${failed} failed`,
      results: results,
      summary: { successful, failed, total: results.length },
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('❌ Error processing reconciliation queue:', error);
    res.status(500).json({
      success: false,
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

/**
 * DELETE /api/zoom/reconciliation-queue
 * Clear the reconciliation queue
 */
router.delete('/reconciliation-queue', (req, res) => {
  try {
    if (webhookEventHandler) {
      const queueSize = webhookEventHandler.getReconciliationQueue().length;
      webhookEventHandler.reconciliationQueue = [];
      
      res.json({
        success: true,
        message: `Cleared reconciliation queue (${queueSize} items removed)`,
        timestamp: new Date().toISOString()
      });
    } else {
      res.status(503).json({
        error: 'Webhook event handler not initialized'
      });
    }
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/zoom/reconciliation-stats
 * Get reconciliation statistics
 */
router.get('/reconciliation-stats', async (req, res) => {
  try {
    const stats = await reconciliationService.getReconciliationStats();
    res.json(stats);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/zoom/webhook-events/:meetingId
 * Get webhook events for a specific meeting
 */
router.get('/webhook-events/:meetingId', async (req, res) => {
  try {
    const { meetingId } = req.params;
    const { limit = 50 } = req.query;

    // Get meeting
    const meeting = await ZoomMeeting.findOne({
      $or: [{ meetingId }, { meetingUuid: meetingId }]
    });

    if (!meeting) {
      return res.status(404).json({ error: 'Meeting not found' });
    }

    // Get attendance records with webhook events
    const attendanceRecords = await ZoomAttendance.find({
      meetingUuid: meeting.meetingUuid
    })
    .sort({ createdAt: -1 })
    .limit(parseInt(limit));

    // Extract all webhook events
    const allEvents = [];
    attendanceRecords.forEach(record => {
      record.webhookEvents.forEach(event => {
        allEvents.push({
          participantName: record.participantName,
          participantEmail: record.participantEmail,
          eventType: event.eventType,
          timestamp: event.timestamp,
          processed: event.processed,
          attendanceId: record._id
        });
      });
    });

    // Add meeting-level webhook events
    meeting.webhookEvents.forEach(event => {
      allEvents.push({
        eventType: event.eventType,
        timestamp: event.timestamp,
        processed: event.processed,
        source: event.source,
        meetingLevel: true
      });
    });

    // Sort by timestamp
    allEvents.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

    res.json({
      meetingId: meeting.meetingId,
      meetingTopic: meeting.topic,
      totalEvents: allEvents.length,
      events: allEvents.slice(0, limit),
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('❌ Error getting webhook events:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/zoom/webhook-status
 * Get webhook system status
 */
router.get('/webhook-status', (req, res) => {
  try {
    const config = webhookValidator.validateConfiguration();
    const eventHandlerStats = webhookEventHandler ? webhookEventHandler.getProcessingStats() : null;

    res.json({
      system: {
        webhookValidatorReady: true,
        eventHandlerReady: !!webhookEventHandler,
        reconciliationServiceReady: true
      },
      configuration: config,
      processing: eventHandlerStats,
      endpoints: {
        webhook: '/api/webhooks/zoom',
        testWebhook: '/api/webhooks/test-webhook',
        config: '/api/webhooks/webhook-config',
        attendance: '/api/webhooks/attendance/:meetingId',
        reconcile: '/api/webhooks/reconcile/:meetingId',
        queue: '/api/webhooks/reconciliation-queue'
      },
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Export the router and initialization function
module.exports = {
  router,
  initializeWebhookRoutes
};
