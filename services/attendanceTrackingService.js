const jwt = require('jsonwebtoken');
const ZoomMeeting = require('../models/ZoomMeeting');
const ZoomAttendance = require('../models/ZoomAttendance');
const AttendanceSession = require('../models/AttendanceSession');

class AttendanceTrackingService {
  constructor() {
    this.activeSessions = new Map(); // sessionId -> session data
    this.userSessions = new Map(); // userId -> Set of sessionIds
  }

  // Validate user token and extract user information
  async validateUserToken(token) {
    try {
      if (!token) {
        throw new Error('No authentication token provided');
      }

      // Remove 'Bearer ' prefix if present
      const cleanToken = token.replace(/^Bearer\s+/, '');
      
      // Verify JWT token
      const decoded = jwt.verify(cleanToken, process.env.JWT_SECRET);
      
      if (!decoded.userId) {
        throw new Error('Invalid token: missing user ID');
      }

      return {
        userId: decoded.userId,
        username: decoded.username || 'Unknown User',
        email: decoded.email || '',
        studentId: decoded.studentId || '',
        department: decoded.department || '',
        role: decoded.role || 'user',
        token: cleanToken
      };
    } catch (error) {
      console.error('❌ Token validation failed:', error.message);
      throw new Error('Invalid authentication token');
    }
  }

  // Create or update meeting record
  async ensureMeetingExists(meetingId, meetingData = {}) {
    try {
      let meeting = await ZoomMeeting.findOne({ id: meetingId });
      
      if (!meeting) {
        // Check global state for webhook data
        const globalMeeting = global.activeMeetings?.[meetingId];
        
        if (globalMeeting) {
          meeting = new ZoomMeeting({
            id: meetingId,
            topic: globalMeeting.topic || meetingData.topic || 'Unknown Meeting',
            status: globalMeeting.status || 'started',
            host_id: globalMeeting.host_id,
            join_url: globalMeeting.join_url || meetingData.join_url || `https://zoom.us/j/${meetingId}`,
            password: meetingData.password || globalMeeting.password,
            start_time: globalMeeting.start_time || new Date(),
            created_at: new Date()
          });
        } else {
          // Create basic meeting record
          meeting = new ZoomMeeting({
            id: meetingId,
            topic: meetingData.topic || 'User Joined Meeting',
            status: meetingData.status || 'started',
            join_url: meetingData.join_url || `https://zoom.us/j/${meetingId}`,
            password: meetingData.password,
            start_time: new Date(),
            created_at: new Date()
          });
        }
        
        await meeting.save();
        console.log('✅ Created meeting record:', meetingId);
      }

      return meeting;
    } catch (error) {
      console.error('❌ Error ensuring meeting exists:', error);
      throw error;
    }
  }

  // Start attendance tracking for a user
  async startTracking(token, meetingId, userInfo = {}, trackingData = {}) {
    try {
      console.log('🎯 Starting attendance tracking:', { meetingId, userInfo: userInfo.name });

      // Validate user token
      const user = await this.validateUserToken(token);

      // Ensure meeting exists
      const meeting = await this.ensureMeetingExists(meetingId, trackingData.meetingData);

      // Check for existing active session
      let existingSession = await AttendanceSession.findOne({
        meetingId: meetingId,
        userId: user.userId,
        status: 'active'
      });

      if (existingSession) {
        console.log('⚠️ User already has active session:', existingSession._id);
        return {
          success: true,
          alreadyActive: true,
          meeting: meeting,
          attendanceSession: existingSession,
          message: 'Already tracking attendance for this meeting'
        };
      }

      // Create new attendance session
      const attendanceSession = new AttendanceSession({
        meetingId: meetingId,
        userId: user.userId,
        userName: userInfo.name || user.username,
        userEmail: userInfo.email || user.email,
        studentId: userInfo.studentId || user.studentId,
        department: userInfo.department || user.department,
        joinTime: new Date(),
        status: 'active',
        attendanceData: {
          joinMethod: 'token-auth',
          userAgent: trackingData.userAgent,
          ipAddress: trackingData.ipAddress,
          tokenUsed: user.token.substring(0, 20) + '...', // Store partial token for audit
          trackingStarted: new Date()
        }
      });

      await attendanceSession.save();

      // Create or update attendance record
      let attendance = await ZoomAttendance.findOne({
        meetingId: meetingId,
        userId: user.userId
      });

      if (attendance) {
        // Update existing attendance
        attendance.joinTime = new Date();
        attendance.status = 'present';
        attendance.lastUpdated = new Date();
        attendance.participantName = userInfo.name || user.username;
        attendance.participantEmail = userInfo.email || user.email;
      } else {
        // Create new attendance record
        attendance = new ZoomAttendance({
          meetingId: meetingId,
          meetingTopic: meeting.topic,
          userId: user.userId,
          participantName: userInfo.name || user.username,
          participantEmail: userInfo.email || user.email,
          studentInfo: {
            studentId: userInfo.studentId || user.studentId,
            department: userInfo.department || user.department
          },
          joinTime: new Date(),
          status: 'present',
          attendancePercentage: 0,
          lastUpdated: new Date()
        });
      }

      await attendance.save();

      // Store in memory for quick access
      this.activeSessions.set(attendanceSession._id.toString(), {
        sessionId: attendanceSession._id.toString(),
        userId: user.userId,
        meetingId: meetingId,
        userName: userInfo.name || user.username,
        joinTime: attendanceSession.joinTime,
        lastHeartbeat: new Date()
      });

      // Track user sessions
      if (!this.userSessions.has(user.userId)) {
        this.userSessions.set(user.userId, new Set());
      }
      this.userSessions.get(user.userId).add(attendanceSession._id.toString());

      console.log('✅ Started attendance tracking successfully');

      return {
        success: true,
        meeting: meeting,
        attendanceSession: attendanceSession,
        attendance: attendance,
        user: user,
        message: 'Attendance tracking started successfully'
      };

    } catch (error) {
      console.error('❌ Error starting attendance tracking:', error);
      throw error;
    }
  }

  // Stop attendance tracking for a user
  async stopTracking(token, meetingId, sessionId, trackingData = {}) {
    try {
      console.log('🛑 Stopping attendance tracking:', { meetingId, sessionId });

      // Validate user token
      const user = await this.validateUserToken(token);

      // Find attendance session
      const attendanceSession = await AttendanceSession.findById(sessionId);
      if (!attendanceSession) {
        throw new Error('Attendance session not found');
      }

      // Verify ownership
      if (attendanceSession.userId !== user.userId) {
        throw new Error('Unauthorized: Session belongs to different user');
      }

      // Calculate duration
      const joinTime = new Date(attendanceSession.joinTime);
      const leaveTime = new Date();
      const duration = Math.round((leaveTime - joinTime) / 1000 / 60); // Minutes

      // Update attendance session
      attendanceSession.leaveTime = leaveTime;
      attendanceSession.duration = duration;
      attendanceSession.status = 'completed';
      attendanceSession.attendanceData = {
        ...attendanceSession.attendanceData,
        trackingEnded: leaveTime,
        endMethod: 'manual'
      };

      await attendanceSession.save();

      // Update attendance record
      const attendance = await ZoomAttendance.findOne({
        meetingId: meetingId,
        userId: user.userId
      });

      if (attendance) {
        attendance.leaveTime = leaveTime;
        attendance.duration = duration;
        attendance.lastUpdated = leaveTime;
        
        // Calculate attendance percentage based on duration
        attendance.attendancePercentage = this.calculateAttendancePercentage(duration);
        
        await attendance.save();
      }

      // Remove from active sessions
      this.activeSessions.delete(sessionId);
      
      // Remove from user sessions
      if (this.userSessions.has(user.userId)) {
        this.userSessions.get(user.userId).delete(sessionId);
        if (this.userSessions.get(user.userId).size === 0) {
          this.userSessions.delete(user.userId);
        }
      }

      console.log('✅ Stopped attendance tracking:', { duration: `${duration} minutes` });

      return {
        success: true,
        duration: duration,
        attendanceSession: attendanceSession,
        attendance: attendance,
        message: `Attendance tracking stopped. Duration: ${duration} minutes`
      };

    } catch (error) {
      console.error('❌ Error stopping attendance tracking:', error);
      throw error;
    }
  }

  // Calculate attendance percentage based on duration
  calculateAttendancePercentage(duration) {
    // Basic calculation - can be enhanced with meeting-specific rules
    if (duration >= 45) return 100;
    if (duration >= 30) return 85;
    if (duration >= 20) return 75;
    if (duration >= 15) return 60;
    if (duration >= 10) return 50;
    if (duration >= 5) return 25;
    return 10; // Minimal participation
  }

  // Get user's current attendance status
  async getUserAttendanceStatus(token) {
    try {
      const user = await this.validateUserToken(token);

      // Find active sessions
      const activeSessions = await AttendanceSession.find({
        userId: user.userId,
        status: 'active'
      }).sort({ joinTime: -1 });

      if (activeSessions.length === 0) {
        return {
          success: true,
          inMeeting: false,
          activeSessions: [],
          message: 'No active meeting sessions'
        };
      }

      // Get meeting details for active sessions
      const sessionsWithMeetings = await Promise.all(
        activeSessions.map(async (session) => {
          const meeting = await ZoomMeeting.findOne({ id: session.meetingId });
          return {
            session: session,
            meeting: meeting,
            duration: Math.round((new Date() - new Date(session.joinTime)) / 1000 / 60)
          };
        })
      );

      return {
        success: true,
        inMeeting: true,
        activeSessions: sessionsWithMeetings,
        currentSession: sessionsWithMeetings[0], // Most recent
        message: `Currently in ${activeSessions.length} meeting(s)`
      };

    } catch (error) {
      console.error('❌ Error getting attendance status:', error);
      throw error;
    }
  }

  // Get user's attendance history
  async getUserAttendanceHistory(token, options = {}) {
    try {
      const user = await this.validateUserToken(token);
      const { limit = 20, skip = 0, dateFrom, dateTo } = options;

      let query = { userId: user.userId };
      
      // Add date filter if provided
      if (dateFrom || dateTo) {
        query.joinTime = {};
        if (dateFrom) query.joinTime.$gte = new Date(dateFrom);
        if (dateTo) query.joinTime.$lte = new Date(dateTo);
      }

      const attendanceHistory = await ZoomAttendance.find(query)
        .sort({ joinTime: -1 })
        .limit(parseInt(limit))
        .skip(parseInt(skip));

      const sessions = await AttendanceSession.find(query)
        .sort({ joinTime: -1 })
        .limit(parseInt(limit))
        .skip(parseInt(skip));

      return {
        success: true,
        attendance: attendanceHistory,
        sessions: sessions,
        count: attendanceHistory.length,
        user: {
          userId: user.userId,
          username: user.username
        }
      };

    } catch (error) {
      console.error('❌ Error getting attendance history:', error);
      throw error;
    }
  }

  // Update heartbeat for active session
  async updateHeartbeat(token, sessionId) {
    try {
      const user = await this.validateUserToken(token);

      // Update in memory
      if (this.activeSessions.has(sessionId)) {
        this.activeSessions.get(sessionId).lastHeartbeat = new Date();
      }

      // Update in database
      await AttendanceSession.findByIdAndUpdate(sessionId, {
        'attendanceData.lastHeartbeat': new Date()
      });

      return { success: true, message: 'Heartbeat updated' };

    } catch (error) {
      console.error('❌ Error updating heartbeat:', error);
      throw error;
    }
  }

  // Clean up stale sessions
  async cleanupStaleSessions() {
    try {
      const staleThreshold = new Date(Date.now() - 15 * 60 * 1000); // 15 minutes ago
      let cleanedCount = 0;

      // Clean up in-memory sessions
      for (const [sessionId, session] of this.activeSessions.entries()) {
        if (session.lastHeartbeat < staleThreshold) {
          console.log('🧹 Cleaning up stale session:', sessionId);
          
          const duration = Math.round((new Date() - new Date(session.joinTime)) / 1000 / 60);
          
          // Update database
          await AttendanceSession.findByIdAndUpdate(sessionId, {
            leaveTime: new Date(),
            duration: duration,
            status: 'completed',
            'attendanceData.endMethod': 'auto_cleanup',
            'attendanceData.trackingEnded': new Date()
          });

          // Update attendance record
          await ZoomAttendance.findOneAndUpdate(
            { meetingId: session.meetingId, userId: session.userId },
            {
              leaveTime: new Date(),
              duration: duration,
              attendancePercentage: this.calculateAttendancePercentage(duration),
              lastUpdated: new Date()
            }
          );

          // Remove from memory
          this.activeSessions.delete(sessionId);
          
          // Remove from user sessions
          if (this.userSessions.has(session.userId)) {
            this.userSessions.get(session.userId).delete(sessionId);
            if (this.userSessions.get(session.userId).size === 0) {
              this.userSessions.delete(session.userId);
            }
          }

          cleanedCount++;
        }
      }

      if (cleanedCount > 0) {
        console.log(`✅ Cleaned up ${cleanedCount} stale sessions`);
      }

      return { success: true, cleanedCount };

    } catch (error) {
      console.error('❌ Error cleaning up stale sessions:', error);
      throw error;
    }
  }

  // Get statistics about active tracking
  getTrackingStatistics() {
    return {
      activeSessions: this.activeSessions.size,
      activeUsers: this.userSessions.size,
      sessionsPerUser: Array.from(this.userSessions.entries()).map(([userId, sessions]) => ({
        userId,
        sessionCount: sessions.size
      }))
    };
  }

  // Get all active sessions for a meeting
  getActiveSessionsForMeeting(meetingId) {
    const sessions = [];
    for (const [sessionId, session] of this.activeSessions.entries()) {
      if (session.meetingId === meetingId) {
        sessions.push({
          sessionId,
          userId: session.userId,
          userName: session.userName,
          joinTime: session.joinTime,
          duration: Math.round((new Date() - new Date(session.joinTime)) / 1000 / 60)
        });
      }
    }
    return sessions;
  }

  // Initialize cleanup scheduler
  startCleanupScheduler() {
    // Run cleanup every 5 minutes
    setInterval(() => {
      this.cleanupStaleSessions().catch(error => {
        console.error('❌ Scheduled cleanup failed:', error);
      });
    }, 5 * 60 * 1000);

    console.log('✅ Attendance tracking cleanup scheduler started');
  }
}

// Create singleton instance
const attendanceTrackingService = new AttendanceTrackingService();

// Auto-start cleanup scheduler
attendanceTrackingService.startCleanupScheduler();

module.exports = attendanceTrackingService;
