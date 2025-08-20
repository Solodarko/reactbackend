const crypto = require('crypto');

class WebhookValidator {
  constructor() {
    this.secretToken = process.env.ZOOM_WEBHOOK_SECRET_TOKEN || 'default_secret_token';
  }

  /**
   * Validate webhook URL challenge (required by Zoom during webhook setup)
   * @param {Object} req - Express request object
   * @param {Object} res - Express response object
   */
  validateChallenge(req, res) {
    const event = req.body;
    
    console.log('🔐 Zoom webhook challenge received:', event);
    
    // Check if this is a URL validation request
    if (event.event === 'endpoint.url_validation') {
      const hashForValidate = this.createHMAC(event.payload.plainToken);
      
      const response = {
        plainToken: event.payload.plainToken,
        encryptedToken: hashForValidate
      };
      
      console.log('✅ Webhook challenge validated successfully');
      return res.status(200).json(response);
    }
    
    // Not a challenge request
    return false;
  }

  /**
   * Verify webhook authenticity using HMAC signature
   * @param {Object} req - Express request object
   * @returns {Boolean} - True if webhook is authentic
   */
  verifyWebhookSignature(req) {
    try {
      const signature = req.headers['x-zm-signature'];
      const timestamp = req.headers['x-zm-request-timestamp'];
      const body = JSON.stringify(req.body);
      
      if (!signature || !timestamp) {
        console.error('❌ Missing required headers for webhook verification');
        return false;
      }
      
      // Check if timestamp is within 5 minutes (protect against replay attacks)
      const currentTimestamp = Math.floor(Date.now() / 1000);
      if (Math.abs(currentTimestamp - parseInt(timestamp)) > 300) {
        console.error('❌ Webhook timestamp too old, possible replay attack');
        return false;
      }
      
      // Create the message for verification
      const message = `v0:${timestamp}:${body}`;
      const expectedSignature = `v0=${this.createHMAC(message)}`;
      
      // Compare signatures securely
      const isValid = this.safeCompare(signature, expectedSignature);
      
      if (isValid) {
        console.log('✅ Webhook signature verified successfully');
        return true;
      } else {
        console.error('❌ Webhook signature verification failed');
        console.error('Expected:', expectedSignature);
        console.error('Received:', signature);
        return false;
      }
      
    } catch (error) {
      console.error('❌ Error verifying webhook signature:', error);
      return false;
    }
  }

  /**
   * Create HMAC-SHA256 hash
   * @param {String} message - Message to hash
   * @returns {String} - HMAC hash
   */
  createHMAC(message) {
    return crypto
      .createHmac('sha256', this.secretToken)
      .update(message)
      .digest('hex');
  }

  /**
   * Safely compare two strings to prevent timing attacks
   * @param {String} a - First string
   * @param {String} b - Second string
   * @returns {Boolean} - True if strings match
   */
  safeCompare(a, b) {
    if (a.length !== b.length) {
      return false;
    }
    
    let result = 0;
    for (let i = 0; i < a.length; i++) {
      result |= a.charCodeAt(i) ^ b.charCodeAt(i);
    }
    
    return result === 0;
  }

  /**
   * Extract and validate event data
   * @param {Object} eventData - Raw webhook event data
   * @returns {Object} - Processed event data or null if invalid
   */
  processEventData(eventData) {
    try {
      // Basic validation
      if (!eventData.event || !eventData.payload) {
        console.error('❌ Invalid event structure - missing event or payload');
        return null;
      }

      const event = eventData.event;
      const payload = eventData.payload;

      // Validate required fields based on event type
      switch (event) {
        case 'meeting.participant_joined':
        case 'meeting.participant_left':
          if (!payload.object?.participant || !payload.object?.id) {
            console.error(`❌ Invalid ${event} event - missing participant or meeting data`);
            return null;
          }
          break;
          
        case 'meeting.ended':
          if (!payload.object?.id || !payload.object?.topic) {
            console.error('❌ Invalid meeting.ended event - missing meeting data');
            return null;
          }
          break;
          
        default:
          console.log(`ℹ️ Ignoring unhandled event type: ${event}`);
          return null;
      }

      return {
        eventType: event,
        timestamp: new Date(eventData.event_ts || Date.now()),
        payload: payload,
        meetingId: payload.object?.id?.toString(),
        meetingUuid: payload.object?.uuid,
        meetingTopic: payload.object?.topic,
        participant: payload.object?.participant || null,
        isValid: true
      };

    } catch (error) {
      console.error('❌ Error processing event data:', error);
      return null;
    }
  }

  /**
   * Middleware function for Express routes
   * @param {Object} req - Express request
   * @param {Object} res - Express response  
   * @param {Function} next - Express next function
   */
  validateWebhookMiddleware() {
    return (req, res, next) => {
      console.log(`🔔 Webhook received: ${req.body?.event || 'unknown event'}`);
      
      // Handle URL validation challenge
      if (this.validateChallenge(req, res)) {
        return; // Response already sent
      }
      
      // Verify webhook signature
      if (!this.verifyWebhookSignature(req)) {
        console.error('❌ Webhook signature verification failed');
        return res.status(401).json({
          error: 'Unauthorized',
          message: 'Invalid webhook signature'
        });
      }
      
      // Process event data
      const processedEvent = this.processEventData(req.body);
      if (!processedEvent) {
        console.error('❌ Failed to process webhook event data');
        return res.status(400).json({
          error: 'Bad Request',
          message: 'Invalid event data'
        });
      }
      
      // Add processed data to request
      req.zoomEvent = processedEvent;
      next();
    };
  }

  /**
   * Log webhook for debugging purposes
   * @param {Object} event - Processed event data
   */
  logWebhookEvent(event) {
    const logData = {
      timestamp: new Date().toISOString(),
      eventType: event.eventType,
      meetingId: event.meetingId,
      meetingTopic: event.meetingTopic,
      participantName: event.participant?.user_name,
      participantEmail: event.participant?.email,
      participantId: event.participant?.id,
    };
    
    console.log('📝 Webhook Event Log:', JSON.stringify(logData, null, 2));
  }

  /**
   * Generate webhook URL for Zoom configuration
   * @param {String} baseUrl - Your server's base URL
   * @param {String} endpoint - Webhook endpoint path
   * @returns {String} - Complete webhook URL
   */
  generateWebhookUrl(baseUrl, endpoint = '/api/zoom/webhooks') {
    const cleanBaseUrl = baseUrl.replace(/\/$/, '');
    const cleanEndpoint = endpoint.startsWith('/') ? endpoint : '/' + endpoint;
    return cleanBaseUrl + cleanEndpoint;
  }

  /**
   * Validate configuration
   * @returns {Object} - Configuration status
   */
  validateConfiguration() {
    const issues = [];
    
    if (!this.secretToken || this.secretToken === 'default_secret_token') {
      issues.push('ZOOM_WEBHOOK_SECRET_TOKEN not configured properly');
    }
    
    if (!process.env.ZOOM_ACCOUNT_ID) {
      issues.push('ZOOM_ACCOUNT_ID not configured');
    }
    
    if (!process.env.ZOOM_CLIENT_ID) {
      issues.push('ZOOM_CLIENT_ID not configured');  
    }
    
    if (!process.env.ZOOM_CLIENT_SECRET) {
      issues.push('ZOOM_CLIENT_SECRET not configured');
    }
    
    return {
      isValid: issues.length === 0,
      issues: issues,
      secretTokenConfigured: this.secretToken !== 'default_secret_token',
      timestamp: new Date().toISOString()
    };
  }
}

module.exports = WebhookValidator;
