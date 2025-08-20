const jwt = require('jsonwebtoken');
const User = require('../models/User');
const Student = require('../models/Student');
const Participant = require('../models/Participant');
const TokenDebugger = require('../utils/tokenDebugger');

class UserSessionManager {
  constructor() {
    this.activeSessions = new Map(); // Map of sessionId -> user session data
    this.meetingParticipants = new Map(); // Map of meetingId -> Set of sessionIds
    this.userTokens = new Map(); // Map of userId -> active tokens
    this.cleanupInterval = 5 * 60 * 1000; // 5 minutes
    this.init();
  }

  /**
   * Initialize the session manager with cleanup intervals
   */
  init() {
    console.log('🔐 Initializing User Session Manager...');
    
    // Clean up expired sessions every 5 minutes
    setInterval(() => {
      this.cleanupExpiredSessions();
    }, this.cleanupInterval);
    
    console.log('✅ User Session Manager initialized');
  }

  /**
   * Verify and decode JWT token
   * @param {string} token - JWT token to verify
   * @returns {Object|null} - Decoded token data or null if invalid
   */
  verifyToken(token) {
    try {
      if (!token) return null;
      
      // Remove Bearer prefix if present
      if (token.startsWith('Bearer ')) {
        token = token.substring(7);
      }
      
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      return decoded;
    } catch (error) {
      console.warn('🔒 Token verification failed:', error.message);
      return null;
    }
  }

  /**
   * Register user session when joining a meeting
   * @param {string} token - User's JWT token
   * @param {string} meetingId - Zoom meeting ID
   * @param {Object} participantData - Zoom participant data
   * @returns {Object} - Session registration result
   */
  async registerUserSession(token, meetingId, participantData = {}) {
    try {
      console.log('\n🔐 ===== USER SESSION REGISTRATION START =====');
      console.log('Meeting ID:', meetingId);
      console.log('Token provided:', !!token);
      console.log('Token type:', typeof token);
      console.log('Participant data keys:', Object.keys(participantData));
      
      // Input validation
      if (!token || typeof token !== 'string') {
        console.log('❌ Invalid token input');
        return {
          success: false,
          error: 'Token is required and must be a string',
          code: 'INVALID_INPUT'
        };
      }

      if (!meetingId || typeof meetingId !== 'string') {
        return {
          success: false,
          error: 'Meeting ID is required and must be a string',
          code: 'INVALID_INPUT'
        };
      }

      // Validate meeting ID format (basic validation)
      if (!/^[a-zA-Z0-9_-]+$/.test(meetingId)) {
        return {
          success: false,
          error: 'Meeting ID contains invalid characters',
          code: 'INVALID_MEETING_ID'
        };
      }

      console.log('🔍 Attempting token verification...');
      const decoded = this.verifyToken(token);
      
      if (!decoded) {
        console.log('❌ Token verification failed - running full debug...');
        const debugInfo = await TokenDebugger.debugToken(token);
        TokenDebugger.logDebugInfo(debugInfo);
        
        return {
          success: false,
          error: 'Invalid or expired token',
          code: 'INVALID_TOKEN'
        };
      }
      
      console.log('✅ Token verification successful');
      console.log('🔍 Decoded token data:', {
        userId: decoded.userId,
        username: decoded.username,
        email: decoded.email,
        role: decoded.role,
        iat: decoded.iat ? new Date(decoded.iat * 1000).toISOString() : 'missing',
        exp: decoded.exp ? new Date(decoded.exp * 1000).toISOString() : 'missing'
      });

      // Check for required token fields
      console.log('🔍 Checking required token fields...');
      const requiredFields = ['userId', 'username', 'email'];
      const missingFields = requiredFields.filter(field => !decoded[field]);
      
      if (missingFields.length > 0) {
        console.log('❌ Missing required token fields:', missingFields);
        console.log('Available fields:', Object.keys(decoded));
        return {
          success: false,
          error: `Token missing required user information: ${missingFields.join(', ')}`,
          code: 'INCOMPLETE_TOKEN'
        };
      }
      
      console.log('✅ All required token fields present');

      // Get user from database
      console.log('🔍 Looking up user in database with ID:', decoded.userId);
      const user = await User.findById(decoded.userId).select('-password');
      
      if (!user) {
        console.log('❌ User not found in database for ID:', decoded.userId);
        return {
          success: false,
          error: 'User not found',
          code: 'USER_NOT_FOUND'
        };
      }
      
      console.log('✅ User found in database:', {
        id: user._id,
        username: user.username,
        email: user.email,
        role: user.role
      });
      
      // Check role consistency
      if (user.role !== decoded.role) {
        console.log('❌ Role mismatch detected:', {
          tokenRole: decoded.role,
          userRole: user.role
        });
        return {
          success: false,
          error: `Role mismatch: token has '${decoded.role}', user has '${user.role}'`,
          code: 'ROLE_MISMATCH'
        };
      }
      
      console.log('✅ Role consistency check passed');

      // Try to find associated student record
      let studentInfo = null;
      try {
        studentInfo = await Student.findOne({ Email: user.email });
      } catch (studentError) {
        console.warn('Student lookup failed:', studentError.message);
      }

      // Create session data
      const sessionId = `${user._id}_${meetingId}_${Date.now()}`;
      const sessionData = {
        sessionId,
        userId: user._id,
        meetingId,
        user: {
          id: user._id,
          username: user.username,
          email: user.email,
          role: user.role
        },
        student: studentInfo ? {
          studentId: studentInfo.StudentID,
          firstName: studentInfo.FirstName,
          lastName: studentInfo.LastName,
          department: studentInfo.Department,
          email: studentInfo.Email
        } : null,
        participant: {
          participantId: participantData.participantId || null,
          participantName: participantData.participantName || user.username,
          zoomUserId: participantData.zoomUserId || null,
          email: participantData.email || user.email
        },
        joinTime: new Date(),
        leaveTime: null,
        isActive: true,
        lastActivity: new Date(),
        device: participantData.device || 'unknown',
        createdAt: new Date()
      };

      // Store session
      this.activeSessions.set(sessionId, sessionData);
      
      // Add to meeting participants
      if (!this.meetingParticipants.has(meetingId)) {
        this.meetingParticipants.set(meetingId, new Set());
      }
      this.meetingParticipants.get(meetingId).add(sessionId);
      
      // Track user token
      this.userTokens.set(user._id.toString(), token);

      console.log('✅ User session registered successfully:', {
        sessionId,
        username: user.username,
        meetingId,
        userRole: user.role,
        hasStudentInfo: !!studentInfo
      });
      console.log('🔐 ===== USER SESSION REGISTRATION END =====\n');

      return {
        success: true,
        sessionId,
        userData: sessionData,
        message: 'User session registered successfully'
      };

    } catch (error) {
      console.error('❌ Error registering user session:', error.message);
      return {
        success: false,
        error: error.message,
        code: 'REGISTRATION_ERROR'
      };
    }
  }

  /**
   * Update user activity in a session
   * @param {string} sessionId - Session ID
   * @param {Object} activityData - Activity update data
   */
  updateUserActivity(sessionId, activityData = {}) {
    const session = this.activeSessions.get(sessionId);
    if (!session) {
      console.warn(`⚠️ Session not found for activity update: ${sessionId}`);
      return false;
    }

    // Update activity
    session.lastActivity = new Date();
    if (activityData.audioStatus !== undefined) session.audioStatus = activityData.audioStatus;
    if (activityData.videoStatus !== undefined) session.videoStatus = activityData.videoStatus;
    if (activityData.sharingScreen !== undefined) session.sharingScreen = activityData.sharingScreen;
    if (activityData.handRaised !== undefined) session.handRaised = activityData.handRaised;

    this.activeSessions.set(sessionId, session);
    return true;
  }

  /**
   * End user session when leaving a meeting
   * @param {string} sessionId - Session ID to end
   */
  async endUserSession(sessionId) {
    try {
      const session = this.activeSessions.get(sessionId);
      if (!session) {
        console.warn(`⚠️ Session not found for ending: ${sessionId}`);
        return false;
      }

      // Update session end time
      session.leaveTime = new Date();
      session.isActive = false;
      session.duration = Math.round((session.leaveTime - session.joinTime) / (1000 * 60));

      // Remove from active sessions
      this.activeSessions.delete(sessionId);
      
      // Remove from meeting participants
      const meetingParticipants = this.meetingParticipants.get(session.meetingId);
      if (meetingParticipants) {
        meetingParticipants.delete(sessionId);
        if (meetingParticipants.size === 0) {
          this.meetingParticipants.delete(session.meetingId);
        }
      }

      console.log(`👋 User session ended: ${session.user.username} left meeting ${session.meetingId}`);
      
      return {
        success: true,
        sessionData: session,
        message: 'User session ended successfully'
      };

    } catch (error) {
      console.error('❌ Error ending user session:', error.message);
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Get user session by session ID
   * @param {string} sessionId - Session ID
   * @returns {Object|null} - Session data or null
   */
  getUserSession(sessionId) {
    return this.activeSessions.get(sessionId) || null;
  }

  /**
   * Get all active sessions for a meeting
   * @param {string} meetingId - Meeting ID
   * @returns {Array} - Array of session data
   */
  getActiveMeetingSessions(meetingId) {
    const sessionIds = this.meetingParticipants.get(meetingId);
    if (!sessionIds) return [];

    const sessions = [];
    for (const sessionId of sessionIds) {
      const session = this.activeSessions.get(sessionId);
      if (session && session.isActive) {
        sessions.push(session);
      }
    }

    return sessions;
  }

  /**
   * Get user sessions by user ID
   * @param {string} userId - User ID
   * @returns {Array} - Array of user sessions
   */
  getUserSessions(userId) {
    const sessions = [];
    for (const session of this.activeSessions.values()) {
      if (session.userId.toString() === userId.toString()) {
        sessions.push(session);
      }
    }
    return sessions;
  }

  /**
   * Link session with Zoom participant record
   * @param {string} sessionId - Session ID
   * @param {string} participantId - Zoom participant ID
   * @param {Object} zoomData - Additional Zoom participant data
   */
  async linkWithZoomParticipant(sessionId, participantId, zoomData = {}) {
    try {
      const session = this.activeSessions.get(sessionId);
      if (!session) {
        console.warn(`⚠️ Session not found for Zoom linking: ${sessionId}`);
        return false;
      }

      // Update session with Zoom participant data
      session.participant.participantId = participantId;
      if (zoomData.zoomUserId) session.participant.zoomUserId = zoomData.zoomUserId;
      if (zoomData.participantName) session.participant.participantName = zoomData.participantName;
      
      this.activeSessions.set(sessionId, session);

      // Create or update Participant record in database
      let participant = await Participant.findOne({
        meetingId: session.meetingId,
        $or: [
          { participantId: participantId },
          { userId: session.userId }
        ]
      });

      if (participant) {
        // Update existing participant with user data
        participant.userId = session.userId;
        participant.authenticatedUser = {
          username: session.user.username,
          email: session.user.email,
          role: session.user.role,
          joinedViaAuth: true,
          authTokenUsed: true
        };
        if (session.student) {
          participant.studentId = session.student.studentId;
          participant.studentFirstName = session.student.firstName;
          participant.studentLastName = session.student.lastName;
          participant.studentDepartment = session.student.department;
          participant.studentEmail = session.student.email;
          participant.userType = 'student';
        }
      } else {
        // Create new participant record
        participant = new Participant({
          participantName: session.participant.participantName,
          participantId: participantId,
          zoomUserId: zoomData.zoomUserId || null,
          userId: session.userId,
          authenticatedUser: {
            username: session.user.username,
            email: session.user.email,
            role: session.user.role,
            joinedViaAuth: true,
            authTokenUsed: true
          },
          meetingId: session.meetingId,
          joinTime: session.joinTime,
          email: session.user.email,
          userType: session.student ? 'student' : 'user',
          isActive: true,
          lastActivity: new Date()
        });

        if (session.student) {
          participant.studentId = session.student.studentId;
          participant.studentFirstName = session.student.firstName;
          participant.studentLastName = session.student.lastName;
          participant.studentDepartment = session.student.department;
          participant.studentEmail = session.student.email;
        }
      }

      await participant.save();
      
      console.log(`🔗 Linked user session with Zoom participant: ${session.user.username} -> ${participantId}`);
      
      return {
        success: true,
        participant,
        session
      };

    } catch (error) {
      console.error('❌ Error linking session with Zoom participant:', error.message);
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Clean up expired sessions
   */
  cleanupExpiredSessions() {
    const now = new Date();
    const maxAge = 4 * 60 * 60 * 1000; // 4 hours
    let cleanedUp = 0;

    for (const [sessionId, session] of this.activeSessions.entries()) {
      const age = now - session.lastActivity;
      
      if (age > maxAge || (!session.isActive && session.leaveTime && (now - session.leaveTime) > 30 * 60 * 1000)) {
        this.activeSessions.delete(sessionId);
        
        // Clean up from meeting participants
        const meetingParticipants = this.meetingParticipants.get(session.meetingId);
        if (meetingParticipants) {
          meetingParticipants.delete(sessionId);
          if (meetingParticipants.size === 0) {
            this.meetingParticipants.delete(session.meetingId);
          }
        }
        
        cleanedUp++;
      }
    }

    if (cleanedUp > 0) {
      console.log(`🧹 Cleaned up ${cleanedUp} expired user sessions`);
    }
  }

  /**
   * Get session statistics
   * @returns {Object} - Session statistics
   */
  getSessionStats() {
    const activeSessions = Array.from(this.activeSessions.values());
    const activeUsers = new Set(activeSessions.map(s => s.userId.toString()));
    const activeMeetings = this.meetingParticipants.size;
    
    const roleStats = activeSessions.reduce((stats, session) => {
      const role = session.user.role;
      stats[role] = (stats[role] || 0) + 1;
      return stats;
    }, {});

    return {
      totalActiveSessions: this.activeSessions.size,
      totalActiveUsers: activeUsers.size,
      totalActiveMeetings: activeMeetings,
      roleBreakdown: roleStats,
      studentsWithSessions: activeSessions.filter(s => s.student).length,
      lastCleanup: new Date().toISOString()
    };
  }

  /**
   * Force end all sessions for a meeting
   * @param {string} meetingId - Meeting ID
   */
  async endAllMeetingSessions(meetingId) {
    const sessionIds = this.meetingParticipants.get(meetingId);
    if (!sessionIds) return 0;

    let endedCount = 0;
    for (const sessionId of Array.from(sessionIds)) {
      const result = await this.endUserSession(sessionId);
      if (result && result.success) {
        endedCount++;
      }
    }

    console.log(`🏁 Ended ${endedCount} user sessions for meeting ${meetingId}`);
    return endedCount;
  }
}

module.exports = UserSessionManager;
