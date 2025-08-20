const jwt = require('jsonwebtoken');
const ZoomMeeting = require('../models/ZoomMeeting');
const ZoomAttendance = require('../models/ZoomAttendance');
const AttendanceSession = require('../models/AttendanceSession');

class AttendanceSocketHandler {
  constructor(io) {
    this.io = io;
    this.authenticatedUsers = new Map(); // userId -> { socket, userInfo }
    this.activeSessions = new Map(); // sessionId -> { userId, meetingId, joinTime }
    this.setupSocketHandlers();
  }

  setupSocketHandlers() {
    this.io.on('connection', (socket) => {
      console.log('📡 New socket connection:', socket.id);

      // Handle user authentication
      socket.on('authenticate', async (data) => {
        await this.handleAuthentication(socket, data);
      });

      // Handle joining a meeting
      socket.on('joinMeeting', async (data) => {
        await this.handleJoinMeeting(socket, data);
      });

      // Handle leaving a meeting
      socket.on('leaveMeeting', async (data) => {
        await this.handleLeaveMeeting(socket, data);
      });

      // Handle attendance updates
      socket.on('updateAttendance', async (data) => {
        await this.handleAttendanceUpdate(socket, data);
      });

      // Handle heartbeat for active sessions
      socket.on('heartbeat', async (data) => {
        await this.handleHeartbeat(socket, data);
      });

      // Handle disconnect
      socket.on('disconnect', () => {
        this.handleDisconnect(socket);
      });

      // Auto-authenticate if token provided in initial connection
      if (socket.handshake.auth.token) {
        this.handleAuthentication(socket, { token: socket.handshake.auth.token });
      }
    });

    // Setup periodic cleanup and updates
    this.setupPeriodicTasks();
  }

  async handleAuthentication(socket, data) {
    try {
      const { token } = data;
      if (!token) {
        socket.emit('authError', { error: 'No token provided' });
        return;
      }

      // Verify JWT token
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      
      // Store authenticated user
      this.authenticatedUsers.set(socket.id, {
        socket: socket,
        userInfo: {
          userId: decoded.userId,
          username: decoded.username,
          email: decoded.email
        },
        authenticatedAt: new Date()
      });

      // Join user to their personal room for targeted updates
      socket.join(`user:${decoded.userId}`);

      console.log('✅ User authenticated via socket:', { 
        socketId: socket.id, 
        userId: decoded.userId, 
        username: decoded.username 
      });

      socket.emit('authenticated', { 
        success: true,
        userId: decoded.userId,
        username: decoded.username
      });

      // Send current attendance status
      await this.sendCurrentAttendanceStatus(socket, decoded.userId);

    } catch (error) {
      console.error('❌ Socket authentication failed:', error.message);
      socket.emit('authError', { error: 'Invalid token' });
    }
  }

  async handleJoinMeeting(socket, data) {
    try {
      const user = this.authenticatedUsers.get(socket.id);
      if (!user) {
        socket.emit('joinError', { error: 'Not authenticated' });
        return;
      }

      const { meetingId, meetingInfo, userInfo } = data;
      
      console.log('🎯 Socket: User joining meeting:', {
        userId: user.userInfo.userId,
        meetingId,
        meetingTopic: meetingInfo?.topic
      });

      // Create or update attendance session
      let attendanceSession = await AttendanceSession.findOne({
        meetingId: meetingId,
        userId: user.userInfo.userId,
        status: 'active'
      });

      if (!attendanceSession) {
        attendanceSession = new AttendanceSession({
          meetingId: meetingId,
          userId: user.userInfo.userId,
          userName: userInfo?.name || user.userInfo.username,
          userEmail: userInfo?.email || user.userInfo.email,
          studentId: userInfo?.studentId || '',
          department: userInfo?.department || '',
          joinTime: new Date(),
          status: 'active',
          attendanceData: {
            joinMethod: 'socket',
            socketId: socket.id,
            ipAddress: socket.handshake.address
          }
        });

        await attendanceSession.save();
      }

      // Store active session locally
      this.activeSessions.set(attendanceSession._id.toString(), {
        userId: user.userInfo.userId,
        meetingId: meetingId,
        joinTime: attendanceSession.joinTime,
        socket: socket,
        lastHeartbeat: new Date()
      });

      // Join meeting room for real-time updates
      socket.join(`meeting:${meetingId}`);

      // Emit to meeting participants
      this.io.to(`meeting:${meetingId}`).emit('participantJoined', {
        meetingId: meetingId,
        participant: {
          userId: user.userInfo.userId,
          name: userInfo?.name || user.userInfo.username,
          email: userInfo?.email || user.userInfo.email,
          joinTime: attendanceSession.joinTime
        },
        timestamp: new Date()
      });

      // Confirm join to user
      socket.emit('meetingJoined', {
        success: true,
        meetingId: meetingId,
        attendanceSession: attendanceSession,
        message: 'Successfully joined meeting'
      });

      console.log('✅ Socket: User joined meeting successfully');

    } catch (error) {
      console.error('❌ Socket: Error joining meeting:', error);
      socket.emit('joinError', { error: error.message });
    }
  }

  async handleLeaveMeeting(socket, data) {
    try {
      const user = this.authenticatedUsers.get(socket.id);
      if (!user) {
        socket.emit('leaveError', { error: 'Not authenticated' });
        return;
      }

      const { meetingId, attendanceSessionId } = data;

      console.log('👋 Socket: User leaving meeting:', {
        userId: user.userInfo.userId,
        meetingId,
        attendanceSessionId
      });

      // Find and update attendance session
      const attendanceSession = await AttendanceSession.findById(attendanceSessionId);
      if (attendanceSession) {
        const duration = Math.round((new Date() - new Date(attendanceSession.joinTime)) / 1000 / 60);
        
        attendanceSession.leaveTime = new Date();
        attendanceSession.duration = duration;
        attendanceSession.status = 'completed';
        await attendanceSession.save();

        // Remove from active sessions
        this.activeSessions.delete(attendanceSessionId);

        // Leave meeting room
        socket.leave(`meeting:${meetingId}`);

        // Emit to meeting participants
        this.io.to(`meeting:${meetingId}`).emit('participantLeft', {
          meetingId: meetingId,
          participant: {
            userId: user.userInfo.userId,
            name: attendanceSession.userName,
            email: attendanceSession.userEmail,
            duration: duration,
            leaveTime: new Date()
          },
          timestamp: new Date()
        });

        // Confirm leave to user
        socket.emit('meetingLeft', {
          success: true,
          duration: duration,
          message: `Left meeting after ${duration} minutes`
        });

        console.log('✅ Socket: User left meeting:', { duration: `${duration} minutes` });
      } else {
        socket.emit('leaveError', { error: 'Attendance session not found' });
      }

    } catch (error) {
      console.error('❌ Socket: Error leaving meeting:', error);
      socket.emit('leaveError', { error: error.message });
    }
  }

  async handleAttendanceUpdate(socket, data) {
    try {
      const user = this.authenticatedUsers.get(socket.id);
      if (!user) return;

      const { attendanceSessionId, updateData } = data;
      
      // Update attendance session with additional data
      const attendanceSession = await AttendanceSession.findById(attendanceSessionId);
      if (attendanceSession) {
        attendanceSession.attendanceData = {
          ...attendanceSession.attendanceData,
          ...updateData,
          lastUpdate: new Date()
        };
        
        await attendanceSession.save();

        // Emit update to admins and meeting participants
        this.io.to(`meeting:${attendanceSession.meetingId}`).emit('attendanceUpdated', {
          attendanceSession: attendanceSession,
          updateData: updateData,
          timestamp: new Date()
        });

        console.log('📊 Socket: Attendance updated for session:', attendanceSessionId);
      }

    } catch (error) {
      console.error('❌ Socket: Error updating attendance:', error);
    }
  }

  async handleHeartbeat(socket, data) {
    try {
      const user = this.authenticatedUsers.get(socket.id);
      if (!user) return;

      const { attendanceSessionId } = data;
      
      // Update last heartbeat
      const activeSession = this.activeSessions.get(attendanceSessionId);
      if (activeSession) {
        activeSession.lastHeartbeat = new Date();
        
        // Update database
        await AttendanceSession.findByIdAndUpdate(attendanceSessionId, {
          'attendanceData.lastHeartbeat': new Date()
        });
      }

    } catch (error) {
      console.error('❌ Socket: Error handling heartbeat:', error);
    }
  }

  handleDisconnect(socket) {
    console.log('🔌 Socket disconnected:', socket.id);

    // Find user
    const user = this.authenticatedUsers.get(socket.id);
    if (user) {
      // Find active sessions for this socket
      for (const [sessionId, session] of this.activeSessions.entries()) {
        if (session.socket.id === socket.id) {
          // Mark session as potentially disconnected
          this.handleSessionDisconnect(sessionId, session);
        }
      }

      // Remove from authenticated users
      this.authenticatedUsers.delete(socket.id);
      
      console.log('👋 User disconnected:', user.userInfo.username);
    }
  }

  async handleSessionDisconnect(sessionId, session) {
    try {
      // Wait a bit in case it's just a temporary disconnect
      setTimeout(async () => {
        const stillActive = this.activeSessions.has(sessionId);
        if (!stillActive) {
          // Session wasn't restored, mark as completed
          const duration = Math.round((new Date() - new Date(session.joinTime)) / 1000 / 60);
          
          await AttendanceSession.findByIdAndUpdate(sessionId, {
            leaveTime: new Date(),
            duration: duration,
            status: 'completed',
            'attendanceData.disconnectReason': 'socket_disconnect'
          });

          // Emit to meeting
          this.io.to(`meeting:${session.meetingId}`).emit('participantLeft', {
            meetingId: session.meetingId,
            participant: {
              userId: session.userId,
              duration: duration,
              leaveTime: new Date(),
              reason: 'disconnect'
            },
            timestamp: new Date()
          });

          console.log('⚠️ Session auto-completed due to disconnect:', { sessionId, duration });
        }
      }, 30000); // 30 second grace period

    } catch (error) {
      console.error('❌ Error handling session disconnect:', error);
    }
  }

  async sendCurrentAttendanceStatus(socket, userId) {
    try {
      // Find active attendance session
      const activeSession = await AttendanceSession.findOne({
        userId: userId,
        status: 'active'
      });

      if (activeSession) {
        const meeting = await ZoomMeeting.findOne({ id: activeSession.meetingId });
        
        socket.emit('currentAttendanceStatus', {
          inMeeting: true,
          activeSession: activeSession,
          meeting: meeting
        });

        // Rejoin meeting room
        socket.join(`meeting:${activeSession.meetingId}`);
        
        // Update active sessions map
        this.activeSessions.set(activeSession._id.toString(), {
          userId: userId,
          meetingId: activeSession.meetingId,
          joinTime: activeSession.joinTime,
          socket: socket,
          lastHeartbeat: new Date()
        });
      } else {
        socket.emit('currentAttendanceStatus', {
          inMeeting: false,
          activeSession: null,
          meeting: null
        });
      }

    } catch (error) {
      console.error('❌ Error sending attendance status:', error);
    }
  }

  setupPeriodicTasks() {
    // Clean up stale sessions every 5 minutes
    setInterval(async () => {
      await this.cleanupStaleSessions();
    }, 5 * 60 * 1000);

    // Send heartbeat reminders every 30 seconds
    setInterval(() => {
      this.sendHeartbeatReminders();
    }, 30 * 1000);
  }

  async cleanupStaleSessions() {
    try {
      const staleThreshold = new Date(Date.now() - 10 * 60 * 1000); // 10 minutes ago
      
      for (const [sessionId, session] of this.activeSessions.entries()) {
        if (session.lastHeartbeat < staleThreshold) {
          console.log('🧹 Cleaning up stale session:', sessionId);
          
          const duration = Math.round((new Date() - new Date(session.joinTime)) / 1000 / 60);
          
          await AttendanceSession.findByIdAndUpdate(sessionId, {
            leaveTime: new Date(),
            duration: duration,
            status: 'completed',
            'attendanceData.disconnectReason': 'stale_session'
          });

          this.activeSessions.delete(sessionId);
        }
      }

    } catch (error) {
      console.error('❌ Error cleaning up stale sessions:', error);
    }
  }

  sendHeartbeatReminders() {
    for (const [sessionId, session] of this.activeSessions.entries()) {
      if (session.socket && session.socket.connected) {
        session.socket.emit('heartbeatRequest', { sessionId });
      }
    }
  }

  // Public methods for external use
  emitToMeeting(meetingId, event, data) {
    this.io.to(`meeting:${meetingId}`).emit(event, data);
  }

  emitToUser(userId, event, data) {
    this.io.to(`user:${userId}`).emit(event, data);
  }

  emitToAll(event, data) {
    this.io.emit(event, data);
  }

  getActiveSessionsCount() {
    return this.activeSessions.size;
  }

  getAuthenticatedUsersCount() {
    return this.authenticatedUsers.size;
  }

  getActiveSessions() {
    return Array.from(this.activeSessions.entries()).map(([sessionId, session]) => ({
      sessionId,
      userId: session.userId,
      meetingId: session.meetingId,
      joinTime: session.joinTime,
      duration: Math.round((new Date() - new Date(session.joinTime)) / 1000 / 60)
    }));
  }
}

module.exports = AttendanceSocketHandler;
