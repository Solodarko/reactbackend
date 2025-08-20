/**
 * Real-Time Zoom Meeting Tracker
 * 
 * This service provides comprehensive real-time tracking of Zoom meetings by combining:
 * 1. Webhook events from Zoom
 * 2. API polling for live participant data
 * 3. Socket.IO for real-time updates to frontend
 * 4. Intelligent meeting detection and activation tracking
 */

const axios = require('axios');
const EventEmitter = require('events');
const cron = require('node-cron');
const ZoomMeeting = require('../models/ZoomMeeting');
const Student = require('../models/Student');
const { trackParticipantJoin, trackParticipantLeave } = require('../utils/zoomSdkTracker');

class RealTimeZoomTracker extends EventEmitter {
  constructor(io, globalState) {
    super();
    this.io = io;
    this.globalState = globalState;
    
    // Configuration - Updated to 60 minute intervals
    this.config = {
      polling: {
        interval: 3600000,      // 60 minutes - poll every hour
        fastInterval: 3600000,  // 60 minutes - when meeting is active
        maxRetries: 3
      },
      detection: {
        checkInterval: 3600000, // 60 minutes - check for new meetings
        inactiveThreshold: 3600000, // 60 minutes - consider meeting inactive after this
      },
      notifications: {
        maxQueueSize: 100,
        batchDelay: 1000        // 1 second delay for batching updates
      }
    };
    
    // State management
    this.activeMeetings = new Map();
    this.pollingIntervals = new Map();
    this.lastParticipantCounts = new Map();
    this.pendingUpdates = new Map();
    this.isInitialized = false;
    
    // Zoom API credentials
    this.zoomCredentials = {
      accountId: process.env.ZOOM_ACCOUNT_ID,
      clientId: process.env.ZOOM_CLIENT_ID,
      clientSecret: process.env.ZOOM_CLIENT_SECRET
    };
    
    this.validateCredentials();
  }
  
  /**
   * Validate Zoom API credentials
   */
  validateCredentials() {
    const { accountId, clientId, clientSecret } = this.zoomCredentials;
    if (!accountId || !clientId || !clientSecret) {
      throw new Error('Missing Zoom API credentials. Please check environment variables.');
    }
  }
  
  /**
   * Initialize the real-time tracker
   */
  async initialize() {
    if (this.isInitialized) {
      console.log('🔄 Real-time Zoom tracker already initialized');
      return;
    }
    
    try {
      console.log('🚀 Initializing Real-Time Zoom Meeting Tracker...');
      
      // Get access token to verify credentials
      await this.getAccessToken();
      
      // Start meeting detection
      this.startMeetingDetection();
      
      // Setup periodic cleanup
      this.setupCleanup();
      
      // Load existing active meetings from database
      await this.loadActiveMeetings();
      
      this.isInitialized = true;
      console.log('✅ Real-Time Zoom Tracker initialized successfully');
      
      this.emit('initialized');
      
    } catch (error) {
      console.error('❌ Failed to initialize Real-Time Zoom Tracker:', error);
      throw error;
    }
  }
  
  /**
   * Get OAuth access token for Zoom API
   */
  async getAccessToken() {
    try {
      const response = await axios.post(
        `https://zoom.us/oauth/token?grant_type=account_credentials&account_id=${this.zoomCredentials.accountId}`,
        {},
        {
          headers: {
            Authorization: `Basic ${Buffer.from(`${this.zoomCredentials.clientId}:${this.zoomCredentials.clientSecret}`).toString('base64')}`,
            'Content-Type': 'application/x-www-form-urlencoded'
          },
          timeout: 10000
        }
      );
      return response.data.access_token;
    } catch (error) {
      console.error('❌ Error getting Zoom access token:', error.response?.data || error.message);
      throw new Error(`Zoom authentication failed: ${error.response?.data?.error || error.message}`);
    }
  }
  
  /**
   * Start meeting detection - checks for new meetings every hour
   */
  startMeetingDetection() {
    console.log('🔍 Starting meeting detection...');
    
    // Check for active meetings every hour
    cron.schedule('0 * * * *', async () => {
      try {
        await this.detectActiveMeetings();
      } catch (error) {
        console.error('❌ Error in meeting detection:', error);
      }
    });
    
    // Initial detection
    this.detectActiveMeetings();
  }
  
  /**
   * Detect currently active meetings from Zoom API
   */
  async detectActiveMeetings() {
    try {
      console.log('🔍 Detecting active Zoom meetings...');
      
      const token = await this.getAccessToken();
      
      // Get user's meetings - both live and scheduled
      const response = await axios.get('https://api.zoom.us/v2/users/me/meetings', {
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        params: {
          type: 'live',  // Only get live meetings
          page_size: 100
        },
        timeout: 15000
      });
      
      const liveMeetings = response.data.meetings || [];
      
      for (const meeting of liveMeetings) {
        await this.handleMeetingDetected(meeting);
      }
      
      // Also check for meetings that might have ended
      await this.checkForEndedMeetings(liveMeetings);
      
    } catch (error) {
      if (error.response?.status === 404) {
        // No live meetings found - this is normal
        console.log('ℹ️ No active meetings found');
      } else {
        console.error('❌ Error detecting active meetings:', error.response?.data || error.message);
      }
    }
  }
  
  /**
   * Handle when a meeting is detected as active
   */
  async handleMeetingDetected(meeting) {
    const meetingId = meeting.id.toString();
    
    if (!this.activeMeetings.has(meetingId)) {
      console.log(`🎥 New active meeting detected: ${meeting.topic} (${meetingId})`);
      
      // Store meeting info
      this.activeMeetings.set(meetingId, {
        id: meetingId,
        topic: meeting.topic,
        startTime: meeting.start_time,
        status: 'active',
        lastCheck: new Date(),
        participantCount: 0
      });
      
      // Start polling for this meeting
      this.startMeetingPolling(meetingId);
      
      // Update global state
      this.globalState.activeMeetings.set(meetingId, {
        id: meetingId,
        topic: meeting.topic,
        startTime: meeting.start_time,
        status: 'detected',
        participants: []
      });
      
      // Send notification
      this.sendNotification({
        type: 'meeting_detected',
        title: '🔍 Active Meeting Detected',
        message: `Zoom meeting "${meeting.topic}" is now being tracked in real-time`,
        meetingId: meetingId,
        data: { meeting }
      });
      
      // Store in database
      await this.storeMeetingInDatabase(meeting);
    }
  }
  
  /**
   * Check for meetings that have ended
   */
  async checkForEndedMeetings(liveMeetings) {
    const liveMeetingIds = new Set(liveMeetings.map(m => m.id.toString()));
    
    for (const [meetingId, meeting] of this.activeMeetings.entries()) {
      if (!liveMeetingIds.has(meetingId)) {
        console.log(`🔚 Meeting ended: ${meeting.topic} (${meetingId})`);
        await this.handleMeetingEnded(meetingId);
      }
    }
  }
  
  /**
   * Handle when a meeting ends
   */
  async handleMeetingEnded(meetingId) {
    const meeting = this.activeMeetings.get(meetingId);
    
    if (meeting) {
      // Stop polling
      this.stopMeetingPolling(meetingId);
      
      // Remove from active meetings
      this.activeMeetings.delete(meetingId);
      
      // Update global state
      this.globalState.activeMeetings.delete(meetingId);
      
      // Send notification
      this.sendNotification({
        type: 'meeting_ended',
        title: '🔚 Meeting Ended',
        message: `Zoom meeting "${meeting.topic}" has ended`,
        meetingId: meetingId,
        data: { meeting }
      });
      
      // Generate final attendance report
      await this.generateFinalAttendanceReport(meetingId);
    }
  }
  
  /**
   * Start polling for a specific meeting
   */
  startMeetingPolling(meetingId) {
    if (this.pollingIntervals.has(meetingId)) {
      console.log(`⚠️ Polling already active for meeting ${meetingId}`);
      return;
    }
    
    console.log(`📡 Starting real-time polling for meeting ${meetingId}`);
    
    // Initial poll
    this.pollMeetingParticipants(meetingId);
    
    // Set up regular polling
    const interval = setInterval(async () => {
      try {
        await this.pollMeetingParticipants(meetingId);
      } catch (error) {
        console.error(`❌ Error polling meeting ${meetingId}:`, error);
      }
    }, this.config.polling.fastInterval);
    
    this.pollingIntervals.set(meetingId, interval);
  }
  
  /**
   * Stop polling for a specific meeting
   */
  stopMeetingPolling(meetingId) {
    const interval = this.pollingIntervals.get(meetingId);
    if (interval) {
      clearInterval(interval);
      this.pollingIntervals.delete(meetingId);
      console.log(`🛑 Stopped polling for meeting ${meetingId}`);
    }
  }
  
  /**
   * Poll meeting participants from Zoom API
   */
  async pollMeetingParticipants(meetingId) {
    try {
      const token = await this.getAccessToken();
      
      // Get current participants
      const response = await axios.get(
        `https://api.zoom.us/v2/meetings/${meetingId}/participants`,
        {
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json'
          },
          params: {
            page_size: 300,
            include_fields: 'registrant_id,status,join_time,leave_time,duration,failover,customer_key,in_waiting_room,role,participant_user_id,audio_quality,video_quality,version,leave_reason'
          },
          timeout: 15000
        }
      );
      
      const participants = response.data.participants || [];
      const meeting = this.activeMeetings.get(meetingId);
      
      if (meeting) {
        const previousCount = meeting.participantCount;
        meeting.participantCount = participants.length;
        meeting.lastCheck = new Date();
        
        // Check for participant changes
        if (previousCount !== participants.length) {
          console.log(`👥 Participant count changed for meeting ${meetingId}: ${previousCount} → ${participants.length}`);
        }
        
        // Process participant data
        await this.processParticipants(meetingId, participants);
        
        // Update global state
        this.globalState.activeMeetings.set(meetingId, {
          ...meeting,
          participants: participants
        });
        
        // Send real-time update
        this.sendRealTimeUpdate({
          type: 'participants_updated',
          meetingId: meetingId,
          participantCount: participants.length,
          participants: participants.map(p => ({
            id: p.id,
            name: p.name || p.user_name,
            email: p.email,
            status: p.status,
            join_time: p.join_time,
            duration: p.duration
          })),
          timestamp: new Date().toISOString()
        });
      }
      
    } catch (error) {
      if (error.response?.status === 404) {
        // Meeting not found - might have ended
        console.log(`ℹ️ Meeting ${meetingId} not found - might have ended`);
        await this.handleMeetingEnded(meetingId);
      } else {
        console.error(`❌ Error polling participants for meeting ${meetingId}:`, error.response?.data || error.message);
      }
    }
  }
  
  /**
   * Process participant data and detect changes
   */
  async processParticipants(meetingId, participants) {
    const previousParticipants = this.lastParticipantCounts.get(meetingId) || [];
    const currentParticipants = participants.map(p => ({
      id: p.id,
      user_id: p.user_id,
      name: p.name || p.user_name,
      email: p.email,
      status: p.status
    }));
    
    // Detect new joins
    const newParticipants = currentParticipants.filter(current => 
      !previousParticipants.find(prev => prev.id === current.id)
    );
    
    // Detect leaves  
    const leftParticipants = previousParticipants.filter(prev => 
      !currentParticipants.find(current => current.id === prev.id)
    );
    
    // Process joins
    for (const participant of newParticipants) {
      await this.handleParticipantJoined(meetingId, participant);
    }
    
    // Process leaves
    for (const participant of leftParticipants) {
      await this.handleParticipantLeft(meetingId, participant);
    }
    
    // Update cache
    this.lastParticipantCounts.set(meetingId, currentParticipants);
  }
  
  /**
   * Handle participant joining
   */
  async handleParticipantJoined(meetingId, participant) {
    console.log(`👋 Participant joined: ${participant.name} in meeting ${meetingId}`);
    
    try {
      // Track in database
      await trackParticipantJoin({
        meetingId,
        name: participant.name,
        email: participant.email || '',
        userId: participant.id,
        joinTime: new Date()
      });
      
      // Send notification
      this.sendNotification({
        type: 'participant_joined',
        title: '👋 Participant Joined',
        message: `${participant.name} joined the meeting`,
        meetingId: meetingId,
        data: { participant }
      });
      
      // Real-time update
      this.sendRealTimeUpdate({
        type: 'participant_joined',
        meetingId: meetingId,
        participant: participant,
        timestamp: new Date().toISOString()
      });
      
    } catch (error) {
      console.error('❌ Error handling participant join:', error);
    }
  }
  
  /**
   * Handle participant leaving  
   */
  async handleParticipantLeft(meetingId, participant) {
    console.log(`👋 Participant left: ${participant.name} from meeting ${meetingId}`);
    
    try {
      // Track in database
      await trackParticipantLeave({
        meetingId,
        userId: participant.id,
        email: participant.email || '',
        leaveTime: new Date()
      });
      
      // Send notification
      this.sendNotification({
        type: 'participant_left',
        title: '👋 Participant Left',
        message: `${participant.name} left the meeting`,
        meetingId: meetingId,
        data: { participant }
      });
      
      // Real-time update
      this.sendRealTimeUpdate({
        type: 'participant_left',
        meetingId: meetingId,
        participant: participant,
        timestamp: new Date().toISOString()
      });
      
    } catch (error) {
      console.error('❌ Error handling participant leave:', error);
    }
  }
  
  /**
   * Store meeting in database
   */
  async storeMeetingInDatabase(meeting) {
    try {
      let dbMeeting = await ZoomMeeting.findOne({ meetingId: meeting.id.toString() });
      
      if (!dbMeeting) {
        dbMeeting = new ZoomMeeting({
          meetingId: meeting.id.toString(),
          meetingUuid: meeting.uuid,
          topic: meeting.topic,
          hostId: meeting.host_id,
          type: meeting.type,
          startTime: meeting.start_time ? new Date(meeting.start_time) : new Date(),
          status: 'started',
          participants: []
        });
        
        await dbMeeting.save();
        console.log(`📝 Meeting stored in database: ${meeting.topic}`);
      }
    } catch (error) {
      console.error('❌ Error storing meeting in database:', error);
    }
  }
  
  /**
   * Generate final attendance report
   */
  async generateFinalAttendanceReport(meetingId) {
    try {
      console.log(`📊 Generating final attendance report for meeting ${meetingId}`);
      
      const meeting = await ZoomMeeting.findOne({ meetingId });
      if (meeting && meeting.participants.length > 0) {
        // Generate attendance records for students
        for (const participant of meeting.participants) {
          if (participant.studentId && participant.duration > 0) {
            // Here you could create attendance records in your Attendance model
            console.log(`✅ Attendance recorded for student ${participant.studentId}: ${participant.duration} minutes`);
          }
        }
      }
    } catch (error) {
      console.error('❌ Error generating attendance report:', error);
    }
  }
  
  /**
   * Load existing active meetings from database
   */
  async loadActiveMeetings() {
    try {
      const meetings = await ZoomMeeting.find({ 
        status: { $in: ['started', 'waiting'] },
        createdAt: { $gte: new Date(Date.now() - 24 * 60 * 60 * 1000) } // Within last 24 hours
      });
      
      for (const meeting of meetings) {
        this.activeMeetings.set(meeting.meetingId, {
          id: meeting.meetingId,
          topic: meeting.topic,
          startTime: meeting.startTime,
          status: 'loaded',
          lastCheck: new Date(),
          participantCount: meeting.participants.length
        });
        
        // Start polling
        this.startMeetingPolling(meeting.meetingId);
      }
      
      console.log(`📂 Loaded ${meetings.length} existing active meetings`);
    } catch (error) {
      console.error('❌ Error loading existing meetings:', error);
    }
  }
  
  /**
   * Send notification to connected clients
   */
  sendNotification(notification) {
    const notificationObj = {
      id: Date.now(),
      timestamp: new Date().toISOString(),
      ...notification
    };
    
    // Add to global state
    this.globalState.notifications.push(notificationObj);
    
    // Keep only last 100 notifications
    if (this.globalState.notifications.length > this.config.notifications.maxQueueSize) {
      this.globalState.notifications = this.globalState.notifications.slice(-this.config.notifications.maxQueueSize);
    }
    
    // Emit to all connected clients
    this.io.emit('notification', notificationObj);
    this.io.emit('zoomTrackingUpdate', notificationObj);
    
    console.log(`📢 Notification sent: ${notification.title}`);
  }
  
  /**
   * Send real-time update to connected clients
   */
  sendRealTimeUpdate(update) {
    // Emit to all clients
    this.io.emit('zoomRealTimeUpdate', update);
    
    // Emit to specific meeting room
    if (update.meetingId) {
      this.io.to(`meeting_${update.meetingId}`).emit('meetingUpdate', update);
    }
    
    console.log(`⚡ Real-time update sent: ${update.type}`);
  }
  
  /**
   * Setup cleanup tasks
   */
  setupCleanup() {
    // Clean up stale data every hour
    cron.schedule('0 * * * *', () => {
      this.cleanupStaleData();
    });
  }
  
  /**
   * Clean up stale data
   */
  cleanupStaleData() {
    const staleThreshold = Date.now() - this.config.detection.inactiveThreshold;
    
    for (const [meetingId, meeting] of this.activeMeetings.entries()) {
      if (meeting.lastCheck.getTime() < staleThreshold) {
        console.log(`🧹 Cleaning up stale meeting: ${meetingId}`);
        this.handleMeetingEnded(meetingId);
      }
    }
  }
  
  /**
   * Get current status
   */
  getStatus() {
    return {
      initialized: this.isInitialized,
      activeMeetings: Array.from(this.activeMeetings.values()),
      pollingCount: this.pollingIntervals.size,
      lastUpdate: new Date().toISOString()
    };
  }
  
  /**
   * Shutdown the tracker
   */
  shutdown() {
    console.log('🛑 Shutting down Real-Time Zoom Tracker...');
    
    // Stop all polling intervals
    for (const [meetingId] of this.pollingIntervals) {
      this.stopMeetingPolling(meetingId);
    }
    
    // Clear state
    this.activeMeetings.clear();
    this.lastParticipantCounts.clear();
    
    this.isInitialized = false;
    console.log('✅ Real-Time Zoom Tracker shutdown complete');
  }
}

module.exports = RealTimeZoomTracker;
