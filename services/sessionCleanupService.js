const Participant = require('../models/Participant');
const ZoomMeeting = require('../models/ZoomMeeting');

/**
 * Session Cleanup Service
 * Handles automatic cleanup of stuck participant sessions
 */
class SessionCleanupService {
  constructor(io = null) {
    this.io = io;
    this.cleanupInterval = null;
    this.isRunning = false;
    this.stats = {
      totalCleanups: 0,
      lastCleanup: null,
      sessionsCleanedUp: 0
    };
    
    console.log('🧹 Session Cleanup Service initialized');
  }

  /**
   * Start automatic cleanup service
   * @param {number} intervalMinutes - How often to run cleanup (default: 30 minutes)
   * @param {number} stuckThresholdHours - Hours after which a session is considered stuck (default: 3 hours)
   */
  start(intervalMinutes = 30, stuckThresholdHours = 3) {
    if (this.isRunning) {
      console.log('⚠️ Session cleanup service is already running');
      return;
    }

    this.intervalMinutes = intervalMinutes;
    this.stuckThresholdHours = stuckThresholdHours;
    this.isRunning = true;

    console.log(`🚀 Starting session cleanup service:`);
    console.log(`   - Cleanup interval: ${intervalMinutes} minutes`);
    console.log(`   - Stuck threshold: ${stuckThresholdHours} hours`);

    // Run initial cleanup
    this.runCleanup();

    // Set up recurring cleanup
    this.cleanupInterval = setInterval(() => {
      this.runCleanup();
    }, intervalMinutes * 60 * 1000);
  }

  /**
   * Stop automatic cleanup service
   */
  stop() {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }
    this.isRunning = false;
    console.log('🛑 Session cleanup service stopped');
  }

  /**
   * Run cleanup process
   */
  async runCleanup() {
    try {
      console.log('🧹 Running session cleanup...');
      const result = await this.cleanupStuckSessions();
      
      this.stats.totalCleanups++;
      this.stats.lastCleanup = new Date();
      this.stats.sessionsCleanedUp += result.cleanedCount;

      if (result.cleanedCount > 0) {
        console.log(`✅ Cleanup completed: ${result.cleanedCount} stuck sessions cleaned up`);
        
        // Emit real-time notification if Socket.IO is available
        if (this.io) {
          this.io.emit('sessionCleanupNotification', {
            type: 'cleanup_completed',
            cleanedCount: result.cleanedCount,
            details: result.details,
            timestamp: new Date().toISOString()
          });
        }
      } else {
        console.log('✅ Cleanup completed: No stuck sessions found');
      }
    } catch (error) {
      console.error('❌ Error during session cleanup:', error.message);
      
      if (this.io) {
        this.io.emit('sessionCleanupNotification', {
          type: 'cleanup_error',
          error: error.message,
          timestamp: new Date().toISOString()
        });
      }
    }
  }

  /**
   * Clean up stuck participant sessions
   * @returns {Object} - Cleanup results
   */
  async cleanupStuckSessions() {
    const now = new Date();
    const stuckThreshold = new Date(now - this.stuckThresholdHours * 60 * 60 * 1000);

    // Find stuck participants
    const stuckParticipants = await Participant.find({
      isActive: true,
      joinTime: { $lt: stuckThreshold }
    }).select('participantName meetingId joinTime lastActivity connectionStatus');

    const details = [];
    let cleanedCount = 0;

    for (const participant of stuckParticipants) {
      const joinTime = new Date(participant.joinTime);
      const estimatedDuration = Math.round((now - joinTime) / (1000 * 60)); // minutes
      const hoursStuck = Math.round(estimatedDuration / 60 * 10) / 10;

      // Update participant status
      await Participant.findByIdAndUpdate(participant._id, {
        $set: {
          isActive: false,
          leaveTime: now,
          duration: estimatedDuration,
          connectionStatus: 'auto_cleanup',
          lastActivity: now,
          attendanceStatus: this.determineAttendanceStatus(estimatedDuration)
        }
      });

      details.push({
        participantName: participant.participantName,
        meetingId: participant.meetingId,
        hoursStuck: hoursStuck,
        finalDuration: estimatedDuration,
        originalStatus: participant.connectionStatus
      });

      cleanedCount++;

      // Also update meeting participant count if applicable
      try {
        await ZoomMeeting.findOneAndUpdate(
          { meetingId: participant.meetingId.toString() },
          { 
            $inc: { activeParticipants: -1 },
            $set: { lastActivity: now }
          }
        );
      } catch (meetingError) {
        console.warn(`⚠️ Could not update meeting count for ${participant.meetingId}:`, meetingError.message);
      }
    }

    return {
      cleanedCount,
      details,
      threshold: stuckThreshold,
      timestamp: now
    };
  }

  /**
   * Determine appropriate attendance status based on duration
   * @param {number} durationMinutes - Duration in minutes
   * @returns {string} - Attendance status
   */
  determineAttendanceStatus(durationMinutes) {
    if (durationMinutes >= 60) return 'Present'; // 1+ hour
    if (durationMinutes >= 30) return 'Partial'; // 30+ minutes
    if (durationMinutes >= 5) return 'Left Early'; // 5+ minutes
    return 'Absent'; // Less than 5 minutes
  }

  /**
   * Force cleanup of all active sessions older than specified time
   * @param {number} hoursThreshold - Hours threshold (default: 1)
   * @returns {Object} - Cleanup results
   */
  async forceCleanupOldSessions(hoursThreshold = 1) {
    console.log(`🚨 Force cleaning up all sessions older than ${hoursThreshold} hours...`);
    
    const originalThreshold = this.stuckThresholdHours;
    this.stuckThresholdHours = hoursThreshold;
    
    const result = await this.cleanupStuckSessions();
    
    this.stuckThresholdHours = originalThreshold;
    
    console.log(`🚨 Force cleanup completed: ${result.cleanedCount} sessions cleaned`);
    return result;
  }

  /**
   * Get cleanup service statistics
   * @returns {Object} - Service statistics
   */
  getStats() {
    return {
      ...this.stats,
      isRunning: this.isRunning,
      intervalMinutes: this.intervalMinutes,
      stuckThresholdHours: this.stuckThresholdHours,
      nextCleanup: this.isRunning && this.stats.lastCleanup ? 
        new Date(this.stats.lastCleanup.getTime() + this.intervalMinutes * 60 * 1000).toISOString() : 
        null
    };
  }

  /**
   * Check for sessions that might be stuck (without cleaning them)
   * @returns {Array} - List of potentially stuck sessions
   */
  async checkForStuckSessions() {
    const now = new Date();
    const stuckThreshold = new Date(now - this.stuckThresholdHours * 60 * 60 * 1000);

    const stuckParticipants = await Participant.find({
      isActive: true,
      joinTime: { $lt: stuckThreshold }
    }).select('participantName meetingId joinTime lastActivity connectionStatus');

    return stuckParticipants.map(p => {
      const joinTime = new Date(p.joinTime);
      const hoursActive = Math.round((now - joinTime) / (1000 * 60 * 60) * 10) / 10;
      
      return {
        id: p._id,
        participantName: p.participantName,
        meetingId: p.meetingId,
        hoursActive,
        connectionStatus: p.connectionStatus,
        lastActivity: p.lastActivity
      };
    });
  }

  /**
   * Manual cleanup for specific meeting
   * @param {string} meetingId - Meeting ID to clean up
   * @returns {Object} - Cleanup results
   */
  async cleanupMeeting(meetingId) {
    console.log(`🧹 Cleaning up all active participants for meeting: ${meetingId}`);
    
    const now = new Date();
    const activeParticipants = await Participant.find({
      meetingId: meetingId.toString(),
      isActive: true
    });

    let cleanedCount = 0;
    const details = [];

    for (const participant of activeParticipants) {
      const joinTime = new Date(participant.joinTime);
      const duration = Math.round((now - joinTime) / (1000 * 60));

      await Participant.findByIdAndUpdate(participant._id, {
        $set: {
          isActive: false,
          leaveTime: now,
          duration: duration,
          connectionStatus: 'meeting_cleanup',
          lastActivity: now,
          attendanceStatus: this.determineAttendanceStatus(duration)
        }
      });

      details.push({
        participantName: participant.participantName,
        duration: duration,
        finalStatus: this.determineAttendanceStatus(duration)
      });

      cleanedCount++;
    }

    console.log(`✅ Meeting cleanup completed: ${cleanedCount} participants cleaned`);
    
    return {
      meetingId,
      cleanedCount,
      details,
      timestamp: now
    };
  }
}

module.exports = SessionCleanupService;
