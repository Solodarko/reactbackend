      if (this.io) {
        this.io.emit('meetingStarted', {
          meetingId: event.meetingId,
          meetingTopic: event.meetingTopic,
          startTime: startTime,
          timestamp: new Date().toISOString()
        });
      }

const ZoomAttendance = require('../models/ZoomAttendance');
const ZoomMeeting = require('../models/ZoomMeeting');
const Student = require('../models/Student');
const EnhancedAttendanceCalculator = require('./enhancedAttendanceCalculator');
const moment = require('moment');

class WebhookEventHandler {
  constructor(io = null, globalState = null) {
    this.io = io;
    this.globalState = globalState;
    this.processedEvents = new Map(); // Prevent duplicate processing
    this.reconciliationQueue = []; // Queue meetings for reconciliation
    this.attendanceCalculator = new EnhancedAttendanceCalculator(); // Enhanced attendance calculations
    this.meetingStartTimes = new Map(); // Track meeting start times from meeting.started events
  }

  /**
   * Process incoming webhook event
   * @param {Object} event - Processed webhook event from validator
   * @returns {Object} - Processing result
   */
  async processWebhookEvent(event) {
    try {
      if (event.payload?.object?.participant) {
        event.participant = event.payload.object.participant;
      }
      console.log(`🎯 Processing webhook event: ${event.eventType}`);
      
      // Prevent duplicate processing using event timestamp + meeting + participant
      const timestamp = event.timestamp || new Date();
      const eventKey = `${event.eventType}_${event.meetingId}_${event.participant?.participant_uuid || 'no_participant'}_${timestamp.getTime()}`;
      
      if (this.processedEvents.has(eventKey)) {
        console.log('⚠️ Duplicate event detected, skipping processing');
        return { success: true, message: 'Duplicate event skipped', eventKey };
      }
      
      this.processedEvents.set(eventKey, true);
      
      // Clean up old processed events (keep last 1000)
      if (this.processedEvents.size > 1000) {
        const keys = Array.from(this.processedEvents.keys());
        for (let i = 0; i < 100; i++) {
          this.processedEvents.delete(keys[i]);
        }
      }

      // Process based on event type
      let result;
      const eventType = event.event || event.eventType;
      switch (eventType) {
        case 'meeting.started':
          result = await this.handleMeetingStarted(event);
          break;
          
        case 'meeting.participant_joined':
          result = await this.handleParticipantJoined(event);
          break;
          
        case 'meeting.participant_left':
          result = await this.handleParticipantLeft(event);
          break;
          
        case 'meeting.ended':
          result = await this.handleMeetingEnded(event);
          break;
          
        default:
          console.log(`ℹ️ Unhandled event type: ${event.eventType}`);
          result = { success: false, message: 'Unhandled event type' };
      }

      // Broadcast real-time update if Socket.IO available
      if (this.io && result.success) {
        this.broadcastAttendanceUpdate(event, result);
      }

      return result;

    } catch (error) {
      console.error(`❌ Error processing webhook event:`, error);
      return {
        success: false,
        error: error.message,
        eventType: event.eventType,
        meetingId: event.meetingId
      };
    }
  }

  /**
   * Handle participant joined event
   * @param {Object} event - Webhook event data
   * @returns {Object} - Processing result
   */
  async handleParticipantJoined(event) {
    try {
      const participant = event.participant;
      console.log(`👋 Participant joined: ${participant.user_name} (${participant.email || 'no email'})`);

      // Create or update attendance record
      const attendanceData = {
        meetingId: event.meetingId,
        meetingUuid: event.meetingUuid,
        meetingTopic: event.meetingTopic,
        participantUuid: participant.participant_uuid,
        participantId: participant.id,
        participantName: participant.user_name,
        participantEmail: participant.email || null,
        zoomUserId: participant.user_id || null,
        joinTime: new Date(participant.join_time || Date.now()),
        connectionStatus: 'joined',
        attendanceStatus: 'In Progress',
        source: 'webhook',
        metadata: {
          userAgent: participant.user_agent || null,
          clientType: participant.client_type || null,
          version: participant.version || null,
        }
      };

      // Find existing attendance record or create new one
      let attendance = await ZoomAttendance.findOne({
        meetingUuid: event.meetingUuid,
        participantUuid: participant.participant_uuid
      });

      if (attendance) {
        // Update existing record
        Object.assign(attendance, attendanceData);
        console.log(`📝 Updated existing attendance record`);
      } else {
        // Create new attendance record
        attendance = new ZoomAttendance(attendanceData);
        console.log(`📝 Created new attendance record`);
      }

      // Add webhook event to history
      await attendance.addWebhookEvent(event.eventType, event.payload);

      // Try to match with student
      await attendance.matchWithStudent();

      // Update meeting record
      await this.updateMeetingRecord(event, 'participant_joined', participant);

      console.log(`✅ Successfully processed participant joined event`);

      return {
        success: true,
        action: 'participant_joined',
        attendanceId: attendance._id,
        participantName: participant.user_name,
        isMatched: attendance.isMatched,
        studentId: attendance.studentId
      };

    } catch (error) {
      console.error('❌ Error handling participant joined:', error);
      return {
        success: false,
        error: error.message,
        action: 'participant_joined'
      };
    }
  }

  /**
   * Handle participant left event
   * @param {Object} event - Webhook event data
   * @returns {Object} - Processing result
   */
  async handleParticipantLeft(event) {
    try {
      const participant = event.participant;
      console.log(`👋 Participant left: ${participant.user_name} (${participant.email || 'no email'})`);

      // Find existing attendance record
      let attendance = await ZoomAttendance.findOne({
        meetingUuid: event.meetingUuid,
        participantUuid: participant.participant_uuid
      });

      if (!attendance) {
        // Create record if it doesn't exist (missed join event)
        console.log('⚠️ Creating attendance record from leave event (missed join event)');
        attendance = new ZoomAttendance({
          meetingId: event.meetingId,
          meetingUuid: event.meetingUuid,
          meetingTopic: event.meetingTopic,
          participantUuid: participant.participant_uuid,
          participantId: participant.id,
          participantName: participant.user_name,
          participantEmail: participant.email || null,
          zoomUserId: participant.user_id || null,
          joinTime: new Date(participant.join_time || Date.now()),
          source: 'webhook',
        });
      }

      // Update with leave information
      attendance.leaveTime = new Date(participant.leave_time || Date.now());
      attendance.connectionStatus = 'left';
      
      // Calculate duration and status
      if (attendance.joinTime && attendance.leaveTime) {
        attendance.duration = Math.round((attendance.leaveTime - attendance.joinTime) / 1000);
        // Status will be calculated during reconciliation with meeting duration
      }

      // Add webhook event to history
      await attendance.addWebhookEvent(event.eventType, event.payload);

      // Try to match with student if not already matched
      if (!attendance.isMatched) {
        await attendance.matchWithStudent();
      }

      // Update meeting record
      await this.updateMeetingRecord(event, 'participant_left', participant);

      console.log(`✅ Successfully processed participant left event (duration: ${attendance.duration}s)`);

      return {
        success: true,
        action: 'participant_left',
        attendanceId: attendance._id,
        participantName: participant.user_name,
        duration: attendance.duration,
        isMatched: attendance.isMatched,
        studentId: attendance.studentId
      };

    } catch (error) {
      console.error('❌ Error handling participant left:', error);
      return {
        success: false,
        error: error.message,
        action: 'participant_left'
      };
    }
  }

  /**
   * Handle meeting started event
   * @param {Object} event - Webhook event data
   * @returns {Object} - Processing result
   */
  async handleMeetingStarted(event) {
    try {
      console.log(`🚀 Meeting started: ${event.meetingTopic} (ID: ${event.meetingId})`);
      
      const startTime = new Date(event.payload.object?.start_time || Date.now());
      
      // Store meeting start time for duration calculations
      this.meetingStartTimes.set(event.meetingUuid, startTime);
      
      // Update meeting record with start time
      await this.updateMeetingRecord(event, 'meeting_started', null, null, startTime);
      
      console.log(`✅ Successfully processed meeting started event`);
      
      return {
        success: true,
        action: 'meeting_started',
        meetingId: event.meetingId,
        startTime: startTime
      };
      
    } catch (error) {
      console.error('❌ Error handling meeting started:', error);
      return {
        success: false,
        error: error.message,
        action: 'meeting_started'
      };
    }
  }

  /**
   * Handle meeting ended event with enhanced attendance calculation
   * @param {Object} event - Webhook event data
   * @returns {Object} - Processing result
   */
  async handleMeetingEnded(event) {
    try {
      console.log(`🔚 Meeting ended: ${event.meetingTopic} (ID: ${event.meetingId})`);

      // Update all participants still marked as in-meeting
      const activeAttendances = await ZoomAttendance.find({
        meetingUuid: event.meetingUuid,
        connectionStatus: { $in: ['joined', 'in_meeting'] },
        leaveTime: { $exists: false }
      });

      let updatedCount = 0;
      const endTime = new Date(event.payload.object?.end_time || Date.now());

      for (const attendance of activeAttendances) {
        attendance.leaveTime = endTime;
        attendance.connectionStatus = 'left';
        
        if (attendance.joinTime) {
          attendance.duration = Math.round((attendance.leaveTime - attendance.joinTime) / 1000);
        }

        // Add webhook event to history
        await attendance.addWebhookEvent(event.eventType, event.payload);
        await attendance.save();
        updatedCount++;
      }

      // Update meeting record with end time
      await this.updateMeetingRecord(event, 'meeting_ended', null, endTime);

      // Trigger enhanced attendance calculation
      console.log(`🧮 Starting enhanced attendance calculation for meeting: ${event.meetingId}`);
      const calculationResult = await this.attendanceCalculator.processMeetingEnd(event.payload);
      
      if (calculationResult.success) {
        console.log(`✅ Enhanced attendance calculation completed:`);
        console.log(`   - Total Participants: ${calculationResult.summary.totalParticipants}`);
        console.log(`   - Present: ${calculationResult.summary.present}`);
        console.log(`   - Absent: ${calculationResult.summary.absent}`);
        console.log(`   - Attendance Rate: ${calculationResult.summary.attendanceRate}%`);
        
        // Broadcast enhanced attendance results
        if (this.io) {
          this.broadcastEnhancedAttendanceResults(event, calculationResult);
        }
      } else {
        console.error(`❌ Enhanced attendance calculation failed: ${calculationResult.error}`);
        // Fallback to basic reconciliation queue
        this.queueMeetingForReconciliation(event.meetingId, event.meetingUuid);
      }

      // Clean up meeting start time cache
      this.meetingStartTimes.delete(event.meetingUuid);

      console.log(`✅ Successfully processed meeting ended event (updated ${updatedCount} participants)`);

      return {
        success: true,
        action: 'meeting_ended',
        meetingId: event.meetingId,
        participantsUpdated: updatedCount,
        attendanceCalculated: calculationResult.success,
        attendanceSummary: calculationResult.success ? calculationResult.summary : null,
        error: calculationResult.success ? null : calculationResult.error
      };

    } catch (error) {
      console.error('❌ Error handling meeting ended:', error);
      return {
        success: false,
        error: error.message,
        action: 'meeting_ended'
      };
    }
  }

  /**
   * Update or create meeting record
   * @param {Object} event - Webhook event
   * @param {String} action - Action type
   * @param {Object} participant - Participant data (optional)
   * @param {Date} endTime - Meeting end time (optional)
   * @param {Date} startTime - Meeting start time (optional)
   */
  async updateMeetingRecord(event, action, participant = null, endTime = null, startTime = null) {
    try {
      let meeting = await ZoomMeeting.findOne({ meetingId: event.meetingId });

      if (!meeting) {
        // Create meeting record if it doesn't exist
        meeting = new ZoomMeeting({
          meetingId: event.meetingId,
          meetingUuid: event.meetingUuid,
          topic: event.meetingTopic,
          hostId: event.payload.object?.host_id || 'unknown',
          hostEmail: event.payload.object?.host_email || 'unknown@example.com',
          type: event.payload.object?.type || 2,
          status: action === 'meeting_ended' ? 'ended' : 'started',
          startTime: new Date(event.payload.object?.start_time || Date.now()),
          endTime: endTime,
          duration: event.payload.object?.duration || 60,
          joinUrl: event.payload.object?.join_url || '',
          startUrl: event.payload.object?.start_url || '',
        });
      }

      // Update meeting status and times
      if (action === 'meeting_ended') {
        meeting.status = 'ended';
        meeting.actualEndTime = endTime || new Date();
        if (meeting.actualStartTime) {
          meeting.actualDuration = Math.round((meeting.actualEndTime - meeting.actualStartTime) / (1000 * 60));
        }
      } else if (action === 'meeting_started') {
        meeting.status = 'started';
        meeting.actualStartTime = startTime || new Date();
      } else if (!meeting.actualStartTime && action === 'participant_joined') {
        meeting.status = 'started';
        meeting.actualStartTime = new Date();
      }

      // Add webhook event to history
      meeting.webhookEvents.push({
        eventType: event.eventType,
        eventData: event.payload,
        timestamp: event.timestamp,
        processed: true,
        source: 'webhook'
      });

      await meeting.save();

    } catch (error) {
      console.error('❌ Error updating meeting record:', error);
    }
  }

  /**
   * Queue meeting for reconciliation
   * @param {String} meetingId - Meeting ID
   * @param {String} meetingUuid - Meeting UUID
   */
  queueMeetingForReconciliation(meetingId, meetingUuid) {
    const reconciliationItem = {
      meetingId,
      meetingUuid,
      queuedAt: new Date(),
      priority: 'high', // Meeting ended events have high priority
      attempts: 0
    };

    // Add to queue if not already queued
    if (!this.reconciliationQueue.find(item => item.meetingId === meetingId)) {
      this.reconciliationQueue.push(reconciliationItem);
      console.log(`📋 Queued meeting ${meetingId} for reconciliation`);
    }
  }

  /**
   * Get queued meetings for reconciliation
   * @returns {Array} - Queued meetings
   */
  getReconciliationQueue() {
    return [...this.reconciliationQueue];
  }

  /**
   * Remove meeting from reconciliation queue
   * @param {String} meetingId - Meeting ID
   */
  removeFromReconciliationQueue(meetingId) {
    const index = this.reconciliationQueue.findIndex(item => item.meetingId === meetingId);
    if (index !== -1) {
      this.reconciliationQueue.splice(index, 1);
      console.log(`🗑️ Removed meeting ${meetingId} from reconciliation queue`);
    }
  }

  /**
   * Broadcast real-time attendance update via Socket.IO
   * @param {Object} event - Webhook event
   * @param {Object} result - Processing result
   */
  broadcastAttendanceUpdate(event, result) {
    if (!this.io) return;

    try {
      const updateData = {
        eventType: event.eventType,
        meetingId: event.meetingId,
        meetingTopic: event.meetingTopic,
        participantName: event.participant?.user_name,
        participantEmail: event.participant?.email,
        action: result.action,
        success: result.success,
        isMatched: result.isMatched,
        studentId: result.studentId,
        timestamp: new Date().toISOString()
      };

      // Broadcast to all clients
      this.io.emit('attendanceUpdate', updateData);

      // Broadcast to specific meeting room
      this.io.to(`meeting_${event.meetingId}`).emit('meetingAttendanceUpdate', updateData);

      console.log(`📡 Broadcasted attendance update for meeting ${event.meetingId}`);

    } catch (error) {
      console.error('❌ Error broadcasting attendance update:', error);
    }
  }

  /**
   * Broadcast enhanced attendance calculation results
   * @param {Object} event - Webhook event
   * @param {Object} calculationResult - Enhanced attendance calculation result
   */
  broadcastEnhancedAttendanceResults(event, calculationResult) {
    if (!this.io) return;

    try {
      const enhancedUpdateData = {
        eventType: 'meeting.attendance_calculated',
        meetingId: event.meetingId,
        meetingTopic: event.meetingTopic,
        action: 'attendance_calculated',
        success: calculationResult.success,
        summary: calculationResult.summary,
        attendanceThreshold: 85,
        timestamp: new Date().toISOString()
      };

      // Broadcast to all admin clients
      this.io.emit('enhancedAttendanceResults', enhancedUpdateData);

      // Broadcast to specific meeting room with detailed results
      this.io.to(`meeting_${event.meetingId}`).emit('meetingAttendanceCompleted', {
        ...enhancedUpdateData,
        detailedResults: calculationResult.summary.results
      });

      // Broadcast to admin dashboard specifically
      this.io.to('admin-dashboard').emit('attendanceCalculationCompleted', {
        meetingId: event.meetingId,
        summary: calculationResult.summary,
        timestamp: new Date().toISOString()
      });

      console.log(`📈 Broadcasted enhanced attendance results for meeting ${event.meetingId}`);

    } catch (error) {
      console.error('❌ Error broadcasting enhanced attendance results:', error);
    }
  }

  /**
   * Get processing statistics
   * @returns {Object} - Processing stats
   */
  getProcessingStats() {
    return {
      processedEventsCount: this.processedEvents.size,
      reconciliationQueueLength: this.reconciliationQueue.length,
      queuedMeetings: this.reconciliationQueue.map(item => ({
        meetingId: item.meetingId,
        queuedAt: item.queuedAt,
        attempts: item.attempts
      })),
      timestamp: new Date().toISOString()
    };
  }

  /**
   * Clear processed events cache (for memory management)
   */
  clearProcessedEventsCache() {
    this.processedEvents.clear();
    console.log('🧹 Cleared processed events cache');
  }
}

module.exports = WebhookEventHandler;
