const axios = require('axios');
const cron = require('node-cron');
const ZoomMeeting = require('../models/ZoomMeeting');
const zoomRequestQueue = require('../utils/zoomRequestQueue');

class MeetingTerminationService {
  constructor() {
    this.scheduledTerminations = new Map();
    this.terminatedMeetings = new Set();
    this.initializeService();
  }

  initializeService() {
    console.log('🕒 Meeting Termination Service initialized');
    
    // Check for meetings that should be terminated every minute
    cron.schedule('*/1 * * * *', () => {
      this.checkExpiredMeetings();
    });

    // Clean up old terminated meetings data every hour
    cron.schedule('0 * * * *', () => {
      this.cleanupOldData();
    });
  }

  // Schedule automatic termination for a meeting
  scheduleMeetingTermination(meetingId, duration) {
    const terminationTime = Date.now() + (duration * 60 * 1000); // Convert minutes to milliseconds
    
    console.log(`⏰ Scheduling termination for meeting ${meetingId} in ${duration} minutes`);
    
    // Store the termination schedule
    this.scheduledTerminations.set(meetingId, {
      terminationTime,
      duration,
      scheduled: true,
      terminated: false
    });

    // Schedule immediate termination using setTimeout as backup
    const timeoutId = setTimeout(async () => {
      await this.terminateMeeting(meetingId, 'timeout');
    }, duration * 60 * 1000);

    // Store timeout ID for potential cancellation
    const scheduleData = this.scheduledTerminations.get(meetingId);
    scheduleData.timeoutId = timeoutId;
    this.scheduledTerminations.set(meetingId, scheduleData);

    return terminationTime;
  }

  // Check for expired meetings and terminate them
  async checkExpiredMeetings() {
    const now = Date.now();
    
    for (const [meetingId, schedule] of this.scheduledTerminations) {
      if (!schedule.terminated && now >= schedule.terminationTime) {
        console.log(`⏰ Meeting ${meetingId} has expired, terminating...`);
        await this.terminateMeeting(meetingId, 'scheduled_expiration');
      }
    }
  }

  // Terminate a specific meeting
  async terminateMeeting(meetingId, reason = 'manual') {
    try {
      console.log(`🔚 Terminating meeting ${meetingId} (reason: ${reason})`);

      // Get access token
      const accessToken = await this.getZoomAccessToken();
      
      // End the meeting via Zoom API
      try {
        await zoomRequestQueue.enqueue(
          async () => {
            return await axios.patch(
              `https://api.zoom.us/v2/meetings/${meetingId}/status`,
              { action: 'end' },
              {
                headers: {
                  Authorization: `Bearer ${accessToken}`,
                  'Content-Type': 'application/json',
                },
                timeout: 15000
              }
            );
          },
          {
            category: 'meeting',
            priority: 1,
            identifier: `terminate-meeting-${meetingId}`,
            retryCount: 2
          }
        );
        console.log(`✅ Successfully ended meeting ${meetingId} via Zoom API`);
      } catch (apiError) {
        console.warn(`⚠️ Failed to end meeting via API (meeting may already be ended): ${apiError.message}`);
      }

      // Update database status
      await this.updateMeetingStatus(meetingId, 'terminated', reason);

      // Mark as terminated in our tracking
      this.terminatedMeetings.add(meetingId);
      
      // Update scheduled termination status
      if (this.scheduledTerminations.has(meetingId)) {
        const schedule = this.scheduledTerminations.get(meetingId);
        schedule.terminated = true;
        schedule.terminationReason = reason;
        schedule.actualTerminationTime = Date.now();
        
        // Clear the timeout if it exists
        if (schedule.timeoutId) {
          clearTimeout(schedule.timeoutId);
        }
        
        this.scheduledTerminations.set(meetingId, schedule);
      }

      // Send real-time notification
      await this.notifyMeetingTermination(meetingId, reason);

      console.log(`🔚 Meeting ${meetingId} terminated successfully`);
      return true;

    } catch (error) {
      console.error(`❌ Error terminating meeting ${meetingId}:`, error);
      return false;
    }
  }

  // Update meeting status in database
  async updateMeetingStatus(meetingId, status, reason) {
    try {
      const updateData = {
        status,
        terminationReason: reason,
        actualEndTime: new Date(),
        accessBlocked: true
      };

      await ZoomMeeting.findOneAndUpdate(
        { meetingId: meetingId.toString() },
        { $set: updateData },
        { new: true }
      );

      console.log(`📝 Updated meeting ${meetingId} status to ${status}`);
    } catch (error) {
      console.error(`❌ Error updating meeting status:`, error);
    }
  }

  // Check if a meeting is terminated or expired
  isMeetingTerminated(meetingId) {
    // Check if explicitly terminated
    if (this.terminatedMeetings.has(meetingId)) {
      return true;
    }

    // Check if expired based on schedule
    const schedule = this.scheduledTerminations.get(meetingId);
    if (schedule) {
      const now = Date.now();
      return schedule.terminated || now >= schedule.terminationTime;
    }

    return false;
  }

  // Check if user can join a meeting
  async canUserJoinMeeting(meetingId) {
    // Check our in-memory tracking first
    if (this.isMeetingTerminated(meetingId)) {
      return {
        canJoin: false,
        reason: 'meeting_terminated',
        message: 'This meeting has been automatically terminated after its scheduled duration.'
      };
    }

    // Check database for meeting status
    try {
      const meeting = await ZoomMeeting.findOne({ meetingId: meetingId.toString() });
      
      if (!meeting) {
        return {
          canJoin: false,
          reason: 'meeting_not_found',
          message: 'Meeting not found.'
        };
      }

      if (meeting.accessBlocked || meeting.status === 'terminated') {
        return {
          canJoin: false,
          reason: 'access_blocked',
          message: 'Access to this meeting has been blocked.'
        };
      }

      // Check if meeting has exceeded its duration
      if (meeting.createdAt && meeting.duration) {
        const createdTime = new Date(meeting.createdAt).getTime();
        const expirationTime = createdTime + (meeting.duration * 60 * 1000);
        
        if (Date.now() > expirationTime) {
          // Auto-terminate if not already terminated
          await this.terminateMeeting(meetingId, 'duration_exceeded');
          return {
            canJoin: false,
            reason: 'duration_exceeded',
            message: `This meeting has exceeded its ${meeting.duration} minute duration limit.`
          };
        }
      }

      return {
        canJoin: true,
        reason: 'allowed',
        message: 'Access granted'
      };

    } catch (error) {
      console.error('Error checking meeting access:', error);
      return {
        canJoin: false,
        reason: 'error',
        message: 'Error checking meeting access'
      };
    }
  }

  // Get Zoom access token
  async getZoomAccessToken() {
    try {
      const response = await axios.post(
        `https://zoom.us/oauth/token?grant_type=account_credentials&account_id=${process.env.ZOOM_ACCOUNT_ID}`,
        {},
        {
          headers: {
            Authorization: `Basic ${Buffer.from(
              `${process.env.ZOOM_CLIENT_ID}:${process.env.ZOOM_CLIENT_SECRET}`
            ).toString('base64')}`,
            'Content-Type': 'application/x-www-form-urlencoded'
          },
          timeout: 10000
        }
      );
      return response.data.access_token;
    } catch (error) {
      console.error('❌ Error getting Zoom access token:', error);
      throw error;
    }
  }

  // Send real-time notification about meeting termination
  async notifyMeetingTermination(meetingId, reason) {
    try {
      // Get server instance and global state
      const { globalState } = require('../server');
      const io = require('../server').io;

      if (io && globalState) {
        const notification = {
          id: Date.now(),
          type: 'meeting_terminated',
          title: '🔚 Meeting Automatically Ended',
          message: `Meeting ${meetingId} has been automatically terminated after its scheduled duration.`,
          timestamp: new Date().toISOString(),
          meetingId: meetingId,
          reason: reason
        };

        globalState.notifications.push(notification);
        io.emit('notification', notification);
        io.emit('meetingTerminated', {
          meetingId,
          reason,
          timestamp: new Date().toISOString()
        });

        console.log(`📢 Sent termination notification for meeting ${meetingId}`);
      }
    } catch (error) {
      console.warn('⚠️ Error sending termination notification:', error.message);
    }
  }

  // Get meeting time remaining
  getMeetingTimeRemaining(meetingId) {
    const schedule = this.scheduledTerminations.get(meetingId);
    if (!schedule) return null;

    const now = Date.now();
    const remaining = schedule.terminationTime - now;

    if (remaining <= 0) return 0;

    return Math.ceil(remaining / (60 * 1000)); // Return minutes remaining
  }

  // Cancel scheduled termination (if needed)
  cancelMeetingTermination(meetingId) {
    if (this.scheduledTerminations.has(meetingId)) {
      const schedule = this.scheduledTerminations.get(meetingId);
      
      if (schedule.timeoutId) {
        clearTimeout(schedule.timeoutId);
      }
      
      this.scheduledTerminations.delete(meetingId);
      console.log(`🚫 Cancelled termination for meeting ${meetingId}`);
      return true;
    }
    return false;
  }

  // Clean up old data
  cleanupOldData() {
    const now = Date.now();
    const oneHourAgo = now - (60 * 60 * 1000);

    // Clean up old scheduled terminations
    for (const [meetingId, schedule] of this.scheduledTerminations) {
      if (schedule.terminated && schedule.actualTerminationTime < oneHourAgo) {
        this.scheduledTerminations.delete(meetingId);
        this.terminatedMeetings.delete(meetingId);
      }
    }

    console.log('🧹 Cleaned up old meeting termination data');
  }

  // Get service status
  getServiceStatus() {
    return {
      scheduledTerminations: this.scheduledTerminations.size,
      terminatedMeetings: this.terminatedMeetings.size,
      activeSchedules: Array.from(this.scheduledTerminations.entries()).map(([meetingId, schedule]) => ({
        meetingId,
        terminationTime: new Date(schedule.terminationTime).toISOString(),
        terminated: schedule.terminated,
        minutesRemaining: this.getMeetingTimeRemaining(meetingId)
      }))
    };
  }
}

// Create singleton instance
const meetingTerminationService = new MeetingTerminationService();

module.exports = meetingTerminationService;
