const ZoomMeeting = require('../models/ZoomMeeting');
const Student = require('../models/Student');
const logger = require('../utils/logger');

class EnhancedZoomUserTracker {
  constructor() {
    this.activeMeetings = new Map(); // meetingId -> meeting data
    this.userSessions = new Map(); // sessionId -> user data
    this.trackingIntervals = new Map(); // meetingId -> interval
    this.eventCallbacks = new Map(); // event -> callbacks[]
  }

  /**
   * Initialize tracking for a meeting
   */
  async initializeMeetingTracking(meetingData) {
    try {
      const meetingId = meetingData.id || meetingData.meetingId;
      console.log(`🎯 Initializing tracking for meeting: ${meetingId}`);

      const trackingSession = {
        meetingId,
        topic: meetingData.topic,
        startTime: new Date(),
        participants: new Map(),
        stats: {
          totalJoins: 0,
          totalLeaves: 0,
          peakParticipants: 0,
          averageParticipants: 0,
          totalDuration: 0
        },
        events: [],
        metadata: {
          hostId: meetingData.host_id,
          hostEmail: meetingData.host_email,
          type: meetingData.type,
          duration: meetingData.duration
        }
      };

      this.activeMeetings.set(meetingId, trackingSession);

      // Start periodic statistics collection
      this.startPeriodicTracking(meetingId);

      // Initialize database record
      await this.createOrUpdateMeetingRecord(meetingData, trackingSession);

      this.emit('meetingTrackingStarted', { meetingId, session: trackingSession });
      
      return trackingSession;
    } catch (error) {
      logger.error('Error initializing meeting tracking:', error);
      throw error;
    }
  }

  /**
   * Track user joining the meeting
   */
  async trackUserJoin(meetingId, userData) {
    try {
      const session = this.activeMeetings.get(meetingId);
      if (!session) {
        throw new Error(`No tracking session found for meeting: ${meetingId}`);
      }

      const joinTime = new Date();
      const participantId = userData.userId || userData.participantId || `${meetingId}_${Date.now()}`;
      
      const participantData = {
        id: participantId,
        zoomUserId: userData.userId,
        displayName: userData.displayName || userData.name,
        email: userData.email,
        joinTime,
        leaveTime: null,
        duration: 0,
        isActive: true,
        isHost: userData.isHost || false,
        isExternal: false, // Will be determined by student lookup
        deviceInfo: {
          userAgent: userData.userAgent,
          ipAddress: userData.ipAddress || 'Hidden',
          platform: userData.platform
        },
        mediaStats: {
          audioEnabled: userData.audioEnabled || false,
          videoEnabled: userData.videoEnabled || false,
          screenSharing: false,
          connectionQuality: 'unknown',
          latency: 0,
          packetLoss: 0
        },
        activityLog: [
          { timestamp: joinTime, action: 'joined', details: userData }
        ]
      };

      // Try to match with existing student record
      await this.matchParticipantWithStudent(participantData);

      // Add to session
      session.participants.set(participantId, participantData);
      session.stats.totalJoins++;
      session.stats.peakParticipants = Math.max(
        session.stats.peakParticipants,
        session.participants.size
      );

      // Log event
      const event = {
        timestamp: joinTime,
        type: 'user_joined',
        userId: participantId,
        data: participantData
      };
      session.events.push(event);

      // Update database
      await this.updateMeetingParticipant(meetingId, participantData, 'joined');

      console.log(`🎯 User joined tracked: ${participantData.displayName} (${participantId})`);
      
      this.emit('userJoined', { meetingId, participant: participantData, event });
      
      return participantData;
    } catch (error) {
      logger.error('Error tracking user join:', error);
      throw error;
    }
  }

  /**
   * Track user leaving the meeting
   */
  async trackUserLeave(meetingId, userData) {
    try {
      const session = this.activeMeetings.get(meetingId);
      if (!session) {
        throw new Error(`No tracking session found for meeting: ${meetingId}`);
      }

      const participantId = userData.userId || userData.participantId;
      const participant = session.participants.get(participantId);
      
      if (!participant) {
        console.warn(`🎯 Participant not found for leave event: ${participantId}`);
        return null;
      }

      const leaveTime = new Date();
      const duration = Math.floor((leaveTime - participant.joinTime) / 60000); // minutes

      // Update participant data
      participant.leaveTime = leaveTime;
      participant.duration = duration;
      participant.isActive = false;
      participant.activityLog.push({
        timestamp: leaveTime,
        action: 'left',
        details: { duration }
      });

      // Update session stats
      session.stats.totalLeaves++;
      session.stats.totalDuration += duration;

      // Log event
      const event = {
        timestamp: leaveTime,
        type: 'user_left',
        userId: participantId,
        data: { duration, participant }
      };
      session.events.push(event);

      // Update database
      await this.updateMeetingParticipant(meetingId, participant, 'left');

      console.log(`🎯 User leave tracked: ${participant.displayName} (${duration}min)`);
      
      this.emit('userLeft', { meetingId, participant, event });
      
      return participant;
    } catch (error) {
      logger.error('Error tracking user leave:', error);
      throw error;
    }
  }

  /**
   * Update user media/connection status
   */
  async updateUserStatus(meetingId, userData) {
    try {
      const session = this.activeMeetings.get(meetingId);
      if (!session) return;

      const participantId = userData.userId || userData.participantId;
      const participant = session.participants.get(participantId);
      
      if (!participant) return;

      // Update media stats
      if (userData.audioEnabled !== undefined) {
        participant.mediaStats.audioEnabled = userData.audioEnabled;
      }
      if (userData.videoEnabled !== undefined) {
        participant.mediaStats.videoEnabled = userData.videoEnabled;
      }
      if (userData.screenSharing !== undefined) {
        participant.mediaStats.screenSharing = userData.screenSharing;
      }
      if (userData.connectionQuality) {
        participant.mediaStats.connectionQuality = userData.connectionQuality;
      }
      if (userData.latency) {
        participant.mediaStats.latency = userData.latency;
      }

      // Log activity
      participant.activityLog.push({
        timestamp: new Date(),
        action: 'status_update',
        details: userData
      });

      // Log event
      const event = {
        timestamp: new Date(),
        type: 'user_updated',
        userId: participantId,
        data: userData
      };
      session.events.push(event);

      this.emit('userUpdated', { meetingId, participant, event });
      
      return participant;
    } catch (error) {
      logger.error('Error updating user status:', error);
      throw error;
    }
  }

  /**
   * Get current meeting statistics
   */
  getMeetingStats(meetingId) {
    const session = this.activeMeetings.get(meetingId);
    if (!session) return null;

    const activeParticipants = Array.from(session.participants.values())
      .filter(p => p.isActive);
    
    const totalParticipants = session.participants.size;
    const averageDuration = totalParticipants > 0 ? 
      session.stats.totalDuration / totalParticipants : 0;

    return {
      meetingId,
      topic: session.topic,
      startTime: session.startTime,
      currentTime: new Date(),
      totalParticipants,
      activeParticipants: activeParticipants.length,
      peakParticipants: session.stats.peakParticipants,
      totalJoins: session.stats.totalJoins,
      totalLeaves: session.stats.totalLeaves,
      averageDuration: Math.round(averageDuration),
      participants: Array.from(session.participants.values()),
      recentEvents: session.events.slice(-10)
    };
  }

  /**
   * Get participant details
   */
  getParticipantDetails(meetingId, participantId) {
    const session = this.activeMeetings.get(meetingId);
    if (!session) return null;

    const participant = session.participants.get(participantId);
    if (!participant) return null;

    return {
      ...participant,
      currentDuration: participant.isActive ? 
        Math.floor((new Date() - participant.joinTime) / 60000) : 
        participant.duration,
      sessionStats: this.getMeetingStats(meetingId)
    };
  }

  /**
   * End meeting tracking
   */
  async endMeetingTracking(meetingId) {
    try {
      const session = this.activeMeetings.get(meetingId);
      if (!session) return null;

      const endTime = new Date();
      const meetingDuration = Math.floor((endTime - session.startTime) / 60000);

      // Update all active participants as left
      for (const [participantId, participant] of session.participants) {
        if (participant.isActive) {
          participant.leaveTime = endTime;
          participant.duration = Math.floor((endTime - participant.joinTime) / 60000);
          participant.isActive = false;
        }
      }

      // Final statistics
      const finalStats = {
        ...session.stats,
        meetingDuration,
        endTime,
        averageParticipants: Math.round(session.stats.totalJoins / Math.max(meetingDuration, 1))
      };

      // Save final data to database
      await this.finalizeMeetingRecord(meetingId, finalStats);

      // Clean up
      const trackingInterval = this.trackingIntervals.get(meetingId);
      if (trackingInterval) {
        clearInterval(trackingInterval);
        this.trackingIntervals.delete(meetingId);
      }

      const finalSession = { ...session, stats: finalStats, endTime };
      this.activeMeetings.delete(meetingId);

      console.log(`🎯 Meeting tracking ended: ${meetingId} (${meetingDuration}min)`);
      
      this.emit('meetingTrackingEnded', { meetingId, session: finalSession });
      
      return finalSession;
    } catch (error) {
      logger.error('Error ending meeting tracking:', error);
      throw error;
    }
  }

  /**
   * Export meeting data
   */
  async exportMeetingData(meetingId, format = 'json') {
    try {
      const stats = this.getMeetingStats(meetingId);
      if (!stats) {
        throw new Error(`No data found for meeting: ${meetingId}`);
      }

      const exportData = {
        meetingInfo: {
          id: meetingId,
          topic: stats.topic,
          startTime: stats.startTime,
          endTime: stats.currentTime,
          duration: Math.floor((stats.currentTime - stats.startTime) / 60000)
        },
        statistics: {
          totalParticipants: stats.totalParticipants,
          peakParticipants: stats.peakParticipants,
          averageDuration: stats.averageDuration,
          totalJoins: stats.totalJoins,
          totalLeaves: stats.totalLeaves
        },
        participants: stats.participants.map(p => ({
          name: p.displayName,
          email: p.email,
          zoomUserId: p.zoomUserId,
          joinTime: p.joinTime,
          leaveTime: p.leaveTime,
          duration: p.duration,
          isExternal: p.isExternal,
          mediaStats: p.mediaStats,
          activitySummary: {
            totalActions: p.activityLog.length,
            firstAction: p.activityLog[0],
            lastAction: p.activityLog[p.activityLog.length - 1]
          }
        }))
      };

      if (format === 'csv') {
        return this.convertToCSV(exportData);
      }
      
      return exportData;
    } catch (error) {
      logger.error('Error exporting meeting data:', error);
      throw error;
    }
  }

  /**
   * Private helper methods
   */

  async matchParticipantWithStudent(participantData) {
    try {
      if (!participantData.displayName && !participantData.email) {
        participantData.isExternal = true;
        return;
      }

      // Try to find matching student record
      let student = null;
      
      if (participantData.email) {
        student = await Student.findOne({ Email: participantData.email });
      }
      
      if (!student && participantData.displayName) {
        // Try name matching
        const nameParts = participantData.displayName.trim().split(' ');
        const firstName = nameParts[0];
        const lastName = nameParts.slice(1).join(' ');
        
        if (firstName && lastName) {
          student = await Student.findOne({
            FirstName: { $regex: new RegExp(firstName, 'i') },
            LastName: { $regex: new RegExp(lastName, 'i') }
          });
        }
      }

      if (student) {
        participantData.studentInfo = {
          StudentID: student.StudentID,
          FirstName: student.FirstName,
          LastName: student.LastName,
          Email: student.Email,
          Department: student.Department,
          ClassName: student.ClassName
        };
        participantData.isExternal = false;
        console.log(`🎯 Matched participant with student: ${student.FirstName} ${student.LastName}`);
      } else {
        participantData.isExternal = true;
        console.log(`🎯 No student match found for: ${participantData.displayName}`);
      }
    } catch (error) {
      logger.error('Error matching participant with student:', error);
      participantData.isExternal = true;
    }
  }

  async createOrUpdateMeetingRecord(meetingData, session) {
    try {
      const meetingId = meetingData.id || meetingData.meetingId;
      
      let meeting = await ZoomMeeting.findOne({ meetingId: meetingId.toString() });
      
      if (!meeting) {
        meeting = new ZoomMeeting({
          meetingId: meetingId.toString(),
          meetingUuid: meetingData.uuid,
          topic: meetingData.topic,
          hostId: meetingData.host_id,
          hostEmail: meetingData.host_email,
          type: meetingData.type,
          startTime: session.startTime,
          status: 'in-progress',
          participants: [],
          trackingEnabled: true,
          trackingStats: {
            totalJoins: 0,
            totalLeaves: 0,
            peakParticipants: 0
          }
        });
      } else {
        meeting.status = 'in-progress';
        meeting.trackingEnabled = true;
        meeting.actualStartTime = session.startTime;
      }

      await meeting.save();
      return meeting;
    } catch (error) {
      logger.error('Error creating/updating meeting record:', error);
      throw error;
    }
  }

  async updateMeetingParticipant(meetingId, participantData, action) {
    try {
      const meeting = await ZoomMeeting.findOne({ meetingId: meetingId.toString() });
      if (!meeting) return;

      // Find or create participant in meeting record
      let participantIndex = meeting.participants.findIndex(
        p => p.participantId === participantData.id || p.zoomUserId === participantData.zoomUserId
      );

      const participantRecord = {
        participantId: participantData.id,
        zoomUserId: participantData.zoomUserId,
        name: participantData.displayName,
        email: participantData.email,
        joinTime: participantData.joinTime,
        leaveTime: participantData.leaveTime,
        duration: participantData.duration,
        isActive: participantData.isActive,
        isExternal: participantData.isExternal,
        studentInfo: participantData.studentInfo,
        deviceInfo: participantData.deviceInfo,
        mediaStats: participantData.mediaStats,
        lastActivity: new Date()
      };

      if (participantIndex >= 0) {
        meeting.participants[participantIndex] = participantRecord;
      } else {
        meeting.participants.push(participantRecord);
      }

      // Update tracking stats
      if (action === 'joined') {
        meeting.trackingStats.totalJoins++;
        meeting.trackingStats.peakParticipants = Math.max(
          meeting.trackingStats.peakParticipants,
          meeting.participants.filter(p => p.isActive).length
        );
      } else if (action === 'left') {
        meeting.trackingStats.totalLeaves++;
      }

      await meeting.save();
    } catch (error) {
      logger.error('Error updating meeting participant:', error);
      throw error;
    }
  }

  async finalizeMeetingRecord(meetingId, finalStats) {
    try {
      const meeting = await ZoomMeeting.findOne({ meetingId: meetingId.toString() });
      if (!meeting) return;

      meeting.status = 'ended';
      meeting.endTime = finalStats.endTime;
      meeting.actualDuration = finalStats.meetingDuration;
      meeting.trackingStats = {
        ...meeting.trackingStats,
        ...finalStats,
        finalizedAt: new Date()
      };

      await meeting.save();
      console.log(`🎯 Meeting record finalized: ${meetingId}`);
    } catch (error) {
      logger.error('Error finalizing meeting record:', error);
      throw error;
    }
  }

  startPeriodicTracking(meetingId) {
    const interval = setInterval(() => {
      const session = this.activeMeetings.get(meetingId);
      if (!session) {
        clearInterval(interval);
        this.trackingIntervals.delete(meetingId);
        return;
      }

      // Update average participants
      const activeCount = Array.from(session.participants.values())
        .filter(p => p.isActive).length;
      
      session.stats.averageParticipants = Math.round(
        (session.stats.averageParticipants + activeCount) / 2
      );

      // Emit periodic update
      this.emit('periodicUpdate', {
        meetingId,
        stats: this.getMeetingStats(meetingId)
      });
    }, 30000); // Every 30 seconds

    this.trackingIntervals.set(meetingId, interval);
  }

  convertToCSV(data) {
    const participants = data.participants;
    const headers = [
      'Name', 'Email', 'Zoom User ID', 'Join Time', 'Leave Time', 
      'Duration (min)', 'Is External', 'Audio Enabled', 'Video Enabled',
      'Connection Quality', 'Total Actions'
    ];

    const rows = participants.map(p => [
      p.name || '',
      p.email || '',
      p.zoomUserId || '',
      p.joinTime ? new Date(p.joinTime).toLocaleString() : '',
      p.leaveTime ? new Date(p.leaveTime).toLocaleString() : 'Still Active',
      p.duration || 0,
      p.isExternal ? 'Yes' : 'No',
      p.mediaStats.audioEnabled ? 'Yes' : 'No',
      p.mediaStats.videoEnabled ? 'Yes' : 'No',
      p.mediaStats.connectionQuality || 'Unknown',
      p.activitySummary.totalActions || 0
    ]);

    return [headers, ...rows].map(row => row.join(',')).join('\n');
  }

  // Event system
  on(event, callback) {
    if (!this.eventCallbacks.has(event)) {
      this.eventCallbacks.set(event, []);
    }
    this.eventCallbacks.get(event).push(callback);
  }

  emit(event, data) {
    const callbacks = this.eventCallbacks.get(event) || [];
    callbacks.forEach(callback => {
      try {
        callback(data);
      } catch (error) {
        logger.error(`Error in event callback for ${event}:`, error);
      }
    });
  }

  // Cleanup
  destroy() {
    // Clear all intervals
    for (const [meetingId, interval] of this.trackingIntervals) {
      clearInterval(interval);
    }
    
    // Clear all data
    this.activeMeetings.clear();
    this.userSessions.clear();
    this.trackingIntervals.clear();
    this.eventCallbacks.clear();
    
    console.log('🎯 Enhanced Zoom User Tracker destroyed');
  }
}

module.exports = EnhancedZoomUserTracker;
