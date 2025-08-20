const axios = require('axios');
const ZoomAttendance = require('../models/ZoomAttendance');
const ZoomMeeting = require('../models/ZoomMeeting');
const rateLimiter = require('../utils/rateLimiter');
const zoomRequestQueue = require('../utils/zoomRequestQueue');

class ReconciliationService {
  constructor() {
    this.maxRetries = 3;
    this.retryDelay = 5000; // 5 seconds
    this.reconciliationInProgress = new Set(); // Track ongoing reconciliations
  }

  /**
   * Get Zoom OAuth access token with rate limiting
   * @returns {String} - Access token
   */
  async getZoomAccessToken() {
    return await rateLimiter.getAccessToken(async () => {
      const response = await axios.post(
        `https://zoom.us/oauth/token?grant_type=account_credentials&account_id=${process.env.ZOOM_ACCOUNT_ID}`,
        {},
        {
          headers: {
            Authorization: `Basic ${Buffer.from(`${process.env.ZOOM_CLIENT_ID}:${process.env.ZOOM_CLIENT_SECRET}`).toString('base64')}`,
            'Content-Type': 'application/x-www-form-urlencoded'
          },
          timeout: 10000
        }
      );
      return response.data.access_token;
    });
  }

  /**
   * Reconcile meeting attendance data using Zoom's past meetings API
   * @param {String} meetingId - Meeting ID (can be ID or UUID)
   * @param {Object} options - Reconciliation options
   * @returns {Object} - Reconciliation result
   */
  async reconcileMeetingAttendance(meetingId, options = {}) {
    try {
      // Prevent concurrent reconciliation of the same meeting
      if (this.reconciliationInProgress.has(meetingId)) {
        console.log(`⚠️ Reconciliation already in progress for meeting ${meetingId}`);
        return {
          success: false,
          error: 'Reconciliation already in progress for this meeting',
          meetingId
        };
      }

      this.reconciliationInProgress.add(meetingId);
      console.log(`🔄 Starting reconciliation for meeting: ${meetingId}`);

      // Get meeting data from database
      let meeting = await ZoomMeeting.findOne({
        $or: [
          { meetingId: meetingId },
          { meetingUuid: meetingId }
        ]
      });

      if (!meeting) {
        console.error(`❌ Meeting not found in database: ${meetingId}`);
        this.reconciliationInProgress.delete(meetingId);
        return {
          success: false,
          error: 'Meeting not found in database',
          meetingId
        };
      }

      // Use UUID for API calls (handle double-encoding issue)
      const meetingUuidForApi = this.encodeMeetingUuid(meeting.meetingUuid);
      
      const result = {
        meetingId: meeting.meetingId,
        meetingUuid: meeting.meetingUuid,
        startTime: new Date(),
        webhook: {
          participants: 0,
          matched: 0
        },
        api: {
          participants: 0,
          processed: 0
        },
        reconciliation: {
          created: 0,
          updated: 0,
          matched: 0,
          errors: []
        },
        success: false
      };

      try {
        // Get webhook attendance data
        const webhookAttendance = await ZoomAttendance.find({
          meetingUuid: meeting.meetingUuid,
          source: 'webhook'
        });

        result.webhook.participants = webhookAttendance.length;
        result.webhook.matched = webhookAttendance.filter(a => a.isMatched).length;

        // Get participant data from Zoom API with rate limiting and queue
        const apiParticipants = await this.getParticipantsFromAPI(meetingUuidForApi);
        result.api.participants = apiParticipants.length;

        console.log(`📊 Found ${webhookAttendance.length} webhook records and ${apiParticipants.length} API records`);

        // Process each API participant
        for (const apiParticipant of apiParticipants) {
          try {
            const reconcileResult = await this.reconcileParticipant(
              meeting,
              apiParticipant,
              webhookAttendance
            );

            if (reconcileResult.created) result.reconciliation.created++;
            if (reconcileResult.updated) result.reconciliation.updated++;
            if (reconcileResult.matched) result.reconciliation.matched++;

            result.api.processed++;

          } catch (participantError) {
            console.error(`❌ Error reconciling participant:`, participantError.message);
            result.reconciliation.errors.push({
              participant: apiParticipant.user_name,
              error: participantError.message
            });
          }
        }

        // Update meeting as reconciled
        meeting.reconciliationCompleted = true;
        meeting.reconciliationCompletedAt = new Date();
        meeting.reportGenerated = true;
        meeting.reportGeneratedAt = new Date();
        await meeting.save();

        result.success = true;
        result.endTime = new Date();
        result.duration = result.endTime - result.startTime;

        console.log(`✅ Reconciliation completed for meeting ${meetingId}`);
        console.log(`📊 Summary: Created ${result.reconciliation.created}, Updated ${result.reconciliation.updated}, Matched ${result.reconciliation.matched}`);

      } catch (apiError) {
        console.error(`❌ API error during reconciliation:`, apiError.message);
        result.reconciliation.errors.push({
          error: `API Error: ${apiError.message}`,
          type: 'api_error'
        });

        // Mark meeting as failed
        meeting.reportGenerationFailed = true;
        meeting.reportGenerationError = apiError.message;
        await meeting.save();
      }

      this.reconciliationInProgress.delete(meetingId);
      return result;

    } catch (error) {
      console.error(`❌ Critical error in reconciliation:`, error);
      this.reconciliationInProgress.delete(meetingId);
      return {
        success: false,
        error: error.message,
        meetingId,
        timestamp: new Date()
      };
    }
  }

  /**
   * Get participants from Zoom API with proper error handling and rate limiting
   * @param {String} meetingUuid - Encoded meeting UUID
   * @returns {Array} - Participant data from API
   */
  async getParticipantsFromAPI(meetingUuid) {
    try {
      const accessToken = await this.getZoomAccessToken();

      // Use the request queue for API calls
      const response = await zoomRequestQueue.enqueue(
        async () => {
          return await rateLimiter.executeApiCall(
            async () => {
              return await axios.get(
                `https://api.zoom.us/v2/past_meetings/${meetingUuid}/participants`,
                {
                  headers: {
                    Authorization: `Bearer ${accessToken}`,
                    'Content-Type': 'application/json'
                  },
                  params: {
                    page_size: 300,
                    page_number: 1
                  },
                  timeout: 15000
                }
              );
            },
            `past-meetings-participants-${meetingUuid}`,
            {
              isReportsCall: true,
              cacheKey: `participants-${meetingUuid}`,
              cacheTTL: 300, // 5 minutes cache
              retryCount: this.maxRetries
            }
          );
        },
        {
          category: 'reconciliation',
          priority: 3,
          identifier: `reconcile-participants-${meetingUuid}`,
          cacheKey: `reconcile_participants_${meetingUuid}`,
          cacheTTL: 300,
          enableCache: true,
          retryCount: this.maxRetries
        }
      );

      return response.data.participants || [];

    } catch (error) {
      if (error.response?.status === 404) {
        console.log(`ℹ️ Meeting not found or no participants: ${meetingUuid}`);
        return [];
      }
      
      if (error.response?.status === 400) {
        console.error(`❌ Bad request for meeting: ${meetingUuid}. Possibly invalid UUID format.`);
        throw new Error(`Invalid meeting UUID format: ${meetingUuid}`);
      }

      console.error(`❌ API error fetching participants:`, error.message);
      throw error;
    }
  }

  /**
   * Reconcile individual participant data
   * @param {Object} meeting - Meeting document
   * @param {Object} apiParticipant - Participant data from API
   * @param {Array} webhookAttendance - Existing webhook attendance records
   * @returns {Object} - Reconciliation result for participant
   */
  async reconcileParticipant(meeting, apiParticipant, webhookAttendance) {
    const result = {
      created: false,
      updated: false,
      matched: false,
      participant: apiParticipant.user_name
    };

    try {
      // Try to find existing attendance record by multiple criteria
      let attendance = this.findMatchingWebhookRecord(apiParticipant, webhookAttendance);

      const participantData = {
        meetingId: meeting.meetingId,
        meetingUuid: meeting.meetingUuid,
        meetingTopic: meeting.topic,
        participantId: apiParticipant.id,
        participantName: apiParticipant.user_name,
        participantEmail: apiParticipant.email || null,
        zoomUserId: apiParticipant.user_id || null,
        joinTime: new Date(apiParticipant.join_time),
        leaveTime: apiParticipant.leave_time ? new Date(apiParticipant.leave_time) : null,
        duration: apiParticipant.duration || 0,
        connectionStatus: 'left', // API data is for completed sessions
        source: 'api_reconcile',
        isReconciled: true,
        reconciledAt: new Date(),
        metadata: {
          attentiveness: apiParticipant.attentiveness_score,
          failover: apiParticipant.failover,
          status: apiParticipant.status,
          role: apiParticipant.role,
          in_waiting_room: apiParticipant.in_waiting_room
        }
      };

      // Calculate attendance status based on meeting duration
      if (meeting.actualDuration) {
        participantData.attendancePercentage = Math.round((apiParticipant.duration / (meeting.actualDuration * 60)) * 100);
        
        if (participantData.attendancePercentage >= 75) {
          participantData.attendanceStatus = 'Present';
        } else if (participantData.attendancePercentage >= 30) {
          participantData.attendanceStatus = 'Partial';
        } else if (participantData.attendancePercentage > 0) {
          participantData.attendanceStatus = 'Late';
        } else {
          participantData.attendanceStatus = 'Absent';
        }
      }

      if (attendance) {
        // Update existing webhook record with API data
        console.log(`📝 Updating webhook record with API data: ${apiParticipant.user_name}`);
        
        // Merge API data with webhook data (API data takes precedence for timing)
        Object.assign(attendance, participantData);
        
        // Keep original webhook events
        // attendance.webhookEvents remains unchanged
        
        await attendance.save();
        result.updated = true;

      } else {
        // Create new record from API data (webhook event was missed)
        console.log(`📝 Creating new record from API data: ${apiParticipant.user_name}`);
        
        // Generate a UUID for participant (since webhook didn't provide one)
        participantData.participantUuid = `api_${meeting.meetingUuid}_${apiParticipant.id}`;
        
        attendance = new ZoomAttendance(participantData);
        await attendance.save();
        result.created = true;
      }

      // Try to match with student
      const wasMatched = attendance.isMatched;
      await attendance.matchWithStudent();
      
      if (attendance.isMatched && !wasMatched) {
        result.matched = true;
      }

    } catch (error) {
      console.error(`❌ Error reconciling participant ${apiParticipant.user_name}:`, error.message);
      throw error;
    }

    return result;
  }

  /**
   * Find matching webhook record for API participant
   * @param {Object} apiParticipant - API participant data
   * @param {Array} webhookRecords - Webhook attendance records
   * @returns {Object|null} - Matching webhook record
   */
  findMatchingWebhookRecord(apiParticipant, webhookRecords) {
    // Try multiple matching strategies
    const strategies = [
      // Match by participant ID
      (api, webhook) => api.id && webhook.participantId === api.id,
      
      // Match by user ID
      (api, webhook) => api.user_id && webhook.zoomUserId === api.user_id,
      
      // Match by email (exact)
      (api, webhook) => api.email && webhook.participantEmail && 
        api.email.toLowerCase() === webhook.participantEmail.toLowerCase(),
      
      // Match by name (exact)
      (api, webhook) => api.user_name && webhook.participantName &&
        api.user_name.toLowerCase() === webhook.participantName.toLowerCase(),
        
      // Match by name (fuzzy - contains)
      (api, webhook) => api.user_name && webhook.participantName &&
        (api.user_name.toLowerCase().includes(webhook.participantName.toLowerCase()) ||
         webhook.participantName.toLowerCase().includes(api.user_name.toLowerCase())),
         
      // Match by time proximity (within 5 minutes of join time)
      (api, webhook) => {
        if (!api.join_time || !webhook.joinTime) return false;
        const apiJoinTime = new Date(api.join_time);
        const timeDiff = Math.abs(apiJoinTime - webhook.joinTime) / 1000 / 60; // minutes
        return timeDiff <= 5;
      }
    ];

    for (const strategy of strategies) {
      const match = webhookRecords.find(webhook => strategy(apiParticipant, webhook));
      if (match) {
        console.log(`🔍 Matched participant using strategy, API: ${apiParticipant.user_name}, Webhook: ${match.participantName}`);
        return match;
      }
    }

    return null;
  }

  /**
   * Encode meeting UUID for API calls (handle // issue)
   * @param {String} uuid - Raw meeting UUID
   * @returns {String} - Encoded UUID
   */
  encodeMeetingUuid(uuid) {
    if (!uuid) return uuid;
    
    // Double URL encode if UUID contains / or //
    if (uuid.includes('/')) {
      return encodeURIComponent(encodeURIComponent(uuid));
    }
    
    return encodeURIComponent(uuid);
  }

  /**
   * Process reconciliation queue from webhook event handler
   * @param {Array} queuedMeetings - Meetings queued for reconciliation
   * @returns {Array} - Processing results
   */
  async processReconciliationQueue(queuedMeetings) {
    const results = [];
    
    console.log(`🔄 Processing reconciliation queue: ${queuedMeetings.length} meetings`);

    for (const queuedMeeting of queuedMeetings) {
      try {
        // Add delay between reconciliations to respect rate limits
        if (results.length > 0) {
          await this.sleep(2000); // 2 second delay
        }

        const result = await this.reconcileMeetingAttendance(queuedMeeting.meetingId, {
          source: 'queue',
          priority: queuedMeeting.priority,
          attempts: queuedMeeting.attempts || 0
        });

        results.push({
          meetingId: queuedMeeting.meetingId,
          success: result.success,
          error: result.error,
          summary: result.success ? {
            webhook: result.webhook,
            api: result.api,
            reconciliation: result.reconciliation
          } : null
        });

        console.log(`${result.success ? '✅' : '❌'} Reconciliation ${result.success ? 'completed' : 'failed'} for meeting ${queuedMeeting.meetingId}`);

      } catch (error) {
        console.error(`❌ Error processing queued meeting ${queuedMeeting.meetingId}:`, error.message);
        results.push({
          meetingId: queuedMeeting.meetingId,
          success: false,
          error: error.message
        });
      }
    }

    return results;
  }

  /**
   * Get reconciliation statistics
   * @returns {Object} - Statistics
   */
  async getReconciliationStats() {
    try {
      const stats = await ZoomAttendance.aggregate([
        {
          $facet: {
            bySource: [
              { $group: { _id: '$source', count: { $sum: 1 } } }
            ],
            byReconciliation: [
              { $group: { _id: '$isReconciled', count: { $sum: 1 } } }
            ],
            byMatching: [
              { $group: { _id: '$isMatched', count: { $sum: 1 } } }
            ],
            recent: [
              { $match: { createdAt: { $gte: new Date(Date.now() - 24 * 60 * 60 * 1000) } } },
              { $group: { _id: '$source', count: { $sum: 1 } } }
            ]
          }
        }
      ]);

      return {
        summary: stats[0],
        inProgress: Array.from(this.reconciliationInProgress),
        timestamp: new Date()
      };

    } catch (error) {
      return {
        error: error.message,
        timestamp: new Date()
      };
    }
  }

  /**
   * Sleep utility for rate limiting
   * @param {Number} ms - Milliseconds to sleep
   */
  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Clear reconciliation progress tracking (for cleanup)
   */
  clearInProgressTracking() {
    this.reconciliationInProgress.clear();
    console.log('🧹 Cleared reconciliation progress tracking');
  }
}

module.exports = ReconciliationService;
