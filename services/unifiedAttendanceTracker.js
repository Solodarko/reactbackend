const jwt = require('jsonwebtoken');
const mongoose = require('mongoose');
const Participant = require('../models/Participant');
const Student = require('../models/Student');
const ZoomMeeting = require('../models/ZoomMeeting');
const { safeCreateDate, safeDateFormat, safeDateDuration, getCurrentTimestamp, sanitizeDateFields } = require('../utils/dateUtils');

/**
 * Unified Attendance Tracking Service
 * Handles both webhook-based and token-based attendance tracking
 */
class UnifiedAttendanceTracker {
  constructor(io) {
    this.io = io;
    this.activeSessions = new Map(); // Track active participants
    this.webhookSessions = new Map(); // Track webhook-based participants
    this.tokenSessions = new Map(); // Track token-based participants
    console.log('🎯 Unified Attendance Tracker initialized');
  }

  // ==================== WEBHOOK-BASED TRACKING ====================

  /**
   * Handle participant joining via Zoom webhook
   */
  async handleWebhookJoin(participantData, meetingId) {
    try {
      console.log(`👋 [WEBHOOK JOIN] Processing webhook participant: ${participantData.participant_name}`);

      const joinDateTime = getCurrentTimestamp();
      
      const participantRecord = {
        meetingId: meetingId.toString(),
        participantId: participantData.participant_id || `webhook_${Date.now()}`,
        participantName: participantData.participant_name || 'Unknown User',
        email: participantData.email || '',
        joinTime: joinDateTime,
        leaveTime: null,
        duration: null,
        isActive: true,
        connectionStatus: 'in_meeting',
        userType: 'participant',
        createdAt: joinDateTime,
        source: 'zoom_webhook',
        webhookBased: true
      };

      // Try to match with student database
      if (participantData.email) {
        const student = await this.findStudentByEmail(participantData.email);
        if (student) {
          participantRecord.studentInfo = {
            studentId: student.StudentID,
            firstName: student.FirstName,
            lastName: student.LastName,
            department: student.Department,
            email: student.Email,
            matchedBy: 'email'
          };
          participantRecord.isStudent = true;
        }
      }

      // Save to database
      const savedParticipant = await this.saveParticipant(participantRecord);

      // Store in active sessions
      this.activeSessions.set(participantRecord.participantId, {
        meetingId: meetingId.toString(),
        joinTime: joinDateTime,
        participantData: savedParticipant,
        source: 'webhook'
      });

      this.webhookSessions.set(participantRecord.participantId, savedParticipant);

      // Update meeting count
      await this.updateMeetingParticipantCount(meetingId, 1);

      // Emit real-time update
      await this.emitParticipantUpdate('joined', savedParticipant, meetingId, 'webhook');

      console.log(`✅ [WEBHOOK JOIN] ${participantData.participant_name} joined successfully`);
      return { success: true, participant: savedParticipant, source: 'webhook' };

    } catch (error) {
      console.error('❌ [WEBHOOK JOIN] Error:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Handle participant leaving via Zoom webhook
   */
  async handleWebhookLeave(participantData, meetingId) {
    try {
      console.log(`👋 [WEBHOOK LEAVE] Processing webhook participant leave: ${participantData.participant_name}`);

      const leaveDateTime = getCurrentTimestamp();
      const participantId = participantData.participant_id;

      const participantRecord = await Participant.findOne({
        meetingId: meetingId.toString(),
        participantId: participantId
      });

      if (!participantRecord) {
        console.warn(`⚠️ [WEBHOOK LEAVE] Participant not found: ${participantData.participant_name}`);
        return { success: false, error: 'Participant not found' };
      }

      // Calculate duration
      const joinTime = safeCreateDate(participantRecord.joinTime);
      const duration = joinTime ? safeDateDuration(joinTime, leaveDateTime) : 0;

      // Update participant record
      const finalAttendance = await this.calculateAttendanceData(participantRecord, meetingId, { overrideDuration: duration });
      
      participantRecord.leaveTime = leaveDateTime;
      participantRecord.duration = finalAttendance.duration;
      participantRecord.isActive = false;
      participantRecord.connectionStatus = 'left';
      participantRecord.attendancePercentage = finalAttendance.attendancePercentage;
      participantRecord.attendanceStatus = finalAttendance.attendanceStatus;

      const updatedParticipant = await participantRecord.save();

      // Remove from active sessions
      this.activeSessions.delete(participantId);
      this.webhookSessions.delete(participantId);

      // Update meeting count
      await this.updateMeetingParticipantCount(meetingId, -1);

      // Emit real-time update
      await this.emitParticipantUpdate('left', updatedParticipant, meetingId, 'webhook');

      console.log(`✅ [WEBHOOK LEAVE] ${participantData.participant_name} left. Status: ${finalAttendance.attendanceStatus}`);
      return { success: true, participant: updatedParticipant, source: 'webhook' };

    } catch (error) {
      console.error('❌ [WEBHOOK LEAVE] Error:', error);
      return { success: false, error: error.message };
    }
  }

  // ==================== TOKEN-BASED TRACKING ====================

  /**
   * Handle participant joining with JWT token
   */
  async handleTokenJoin(meetingId, token, additionalData = {}) {
    try {
      const userInfo = this.extractUserFromToken(token);
      console.log(`👋 [TOKEN JOIN] Processing token participant: ${userInfo.name}`);

      const joinDateTime = getCurrentTimestamp();
      
      const participantRecord = {
        meetingId: meetingId.toString(),
        participantId: userInfo.userId || `token_${Date.now()}`,
        participantName: userInfo.name || 'Anonymous User',
        email: userInfo.email || '',
        joinTime: joinDateTime,
        leaveTime: null,
        duration: null,
        isActive: true,
        connectionStatus: 'in_meeting',
        userType: userInfo.role || 'student',
        createdAt: joinDateTime,
        source: 'jwt_token',
        tokenBased: true,
        userInfo: {
          userId: userInfo.userId,
          firstName: userInfo.firstName,
          lastName: userInfo.lastName,
          department: userInfo.department,
          role: userInfo.role,
          studentId: userInfo.studentId
        }
      };

      // Try to match with student database
      if (userInfo.email || userInfo.studentId) {
        const student = await this.findStudentByEmailOrId(userInfo.email, userInfo.studentId);
        if (student) {
          participantRecord.studentInfo = {
            studentId: student.StudentID,
            firstName: student.FirstName,
            lastName: student.LastName,
            department: student.Department,
            email: student.Email,
            matchedBy: userInfo.studentId ? 'studentId' : 'email'
          };
          participantRecord.isStudent = true;
        }
      }

      // Check for existing participant (rejoin case)
      const existingParticipant = await Participant.findOne({
        meetingId: meetingId.toString(),
        $or: [
          { participantId: participantRecord.participantId },
          { email: participantRecord.email }
        ]
      });

      let savedParticipant;
      if (existingParticipant) {
        // Update existing participant (rejoin)
        Object.assign(existingParticipant, participantRecord);
        savedParticipant = await existingParticipant.save();
        console.log('🔄 Updated existing token participant');
      } else {
        // Create new participant
        savedParticipant = await this.saveParticipant(participantRecord);
        console.log('➕ Created new token participant');
      }

      // Store in active sessions
      this.activeSessions.set(userInfo.userId, {
        meetingId: meetingId.toString(),
        joinTime: joinDateTime,
        participantData: savedParticipant,
        userInfo,
        source: 'token'
      });

      this.tokenSessions.set(userInfo.userId, savedParticipant);

      // Update meeting count
      await this.updateMeetingParticipantCount(meetingId, 1);

      // Emit real-time update
      await this.emitParticipantUpdate('joined', savedParticipant, meetingId, 'token');

      console.log(`✅ [TOKEN JOIN] ${userInfo.name} joined successfully`);
      return { success: true, participant: savedParticipant, userInfo, source: 'token' };

    } catch (error) {
      console.error('❌ [TOKEN JOIN] Error:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Handle participant leaving with JWT token
   */
  async handleTokenLeave(meetingId, token) {
    try {
      const userInfo = this.extractUserFromToken(token);
      console.log(`👋 [TOKEN LEAVE] Processing token participant leave: ${userInfo.name}`);

      const leaveDateTime = getCurrentTimestamp();
      
      const participantRecord = await Participant.findOne({
        meetingId: meetingId.toString(),
        $or: [{ participantId: userInfo.userId }, { email: userInfo.email }]
      });

      if (!participantRecord) {
        console.warn(`⚠️ [TOKEN LEAVE] Participant not found: ${userInfo.name}`);
        return { success: false, error: 'Participant not found' };
      }

      if (!participantRecord.isActive) {
        console.log(`ℹ️ [TOKEN LEAVE] Participant already marked as left: ${userInfo.name}`);
        return { success: true, message: 'Already marked as left', participant: participantRecord };
      }

      // Calculate duration
      const joinTime = safeCreateDate(participantRecord.joinTime);
      const duration = joinTime ? safeDateDuration(joinTime, leaveDateTime) : 0;

      // Update participant record
      const finalAttendance = await this.calculateAttendanceData(participantRecord, meetingId, { overrideDuration: duration });
      
      participantRecord.leaveTime = leaveDateTime;
      participantRecord.duration = finalAttendance.duration;
      participantRecord.isActive = false;
      participantRecord.connectionStatus = 'left';
      participantRecord.attendancePercentage = finalAttendance.attendancePercentage;
      participantRecord.attendanceStatus = finalAttendance.attendanceStatus;

      const updatedParticipant = await participantRecord.save();

      // Remove from active sessions
      this.activeSessions.delete(userInfo.userId);
      this.tokenSessions.delete(userInfo.userId);

      // Update meeting count
      await this.updateMeetingParticipantCount(meetingId, -1);

      // Emit real-time update
      await this.emitParticipantUpdate('left', updatedParticipant, meetingId, 'token');

      console.log(`✅ [TOKEN LEAVE] ${userInfo.name} left. Status: ${finalAttendance.attendanceStatus}`);
      return { success: true, participant: updatedParticipant, source: 'token' };

    } catch (error) {
      console.error('❌ [TOKEN LEAVE] Error:', error);
      return { success: false, error: error.message };
    }
  }

  // ==================== UNIFIED DATA RETRIEVAL ====================

  /**
   * Get all participants for a meeting (both webhook and token-based)
   */
  async getUnifiedAttendanceData(meetingId, threshold = 85) {
    try {
      console.log(`📊 [UNIFIED] Getting attendance data for meeting: ${meetingId}`);

      const participants = await Participant.find({ 
        meetingId: meetingId.toString()
      }).sort({ joinTime: 1 });

      const processedParticipants = await Promise.all(
        participants.map(async (participant) => {
          const attendanceData = await this.calculateAttendanceData(participant, meetingId);
          
          return {
            ...participant.toObject(),
            ...attendanceData,
            displayName: this.getDisplayName(participant),
            displayEmail: participant.email,
            source: participant.source || (participant.tokenBased ? 'jwt_token' : 'zoom_webhook'),
            isAuthenticated: participant.tokenBased || participant.source === 'jwt_token',
            authenticationStatus: participant.tokenBased ? 'authenticated' : 'guest'
          };
        })
      );

      // Calculate comprehensive statistics
      const statistics = this.calculateComprehensiveStatistics(processedParticipants, threshold);

      console.log(`✅ [UNIFIED] Retrieved ${processedParticipants.length} participants`);
      return {
        success: true,
        participants: processedParticipants,
        statistics,
        method: 'unified',
        timestamp: new Date().toISOString()
      };

    } catch (error) {
      console.error('❌ [UNIFIED] Error getting attendance data:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Get individual participant attendance by token
   */
  async getMyAttendance(meetingId, token) {
    try {
      const userInfo = this.extractUserFromToken(token);
      
      const participant = await Participant.findOne({
        meetingId: meetingId.toString(),
        $or: [{ participantId: userInfo.userId }, { email: userInfo.email }]
      });

      if (!participant) {
        return { success: false, error: 'No attendance record found' };
      }

      const attendanceData = await this.calculateAttendanceData(participant, meetingId);

      return {
        success: true,
        participant: {
          ...participant.toObject(),
          ...attendanceData,
          displayName: this.getDisplayName(participant),
          source: participant.source || 'jwt_token'
        }
      };

    } catch (error) {
      console.error('❌ [MY ATTENDANCE] Error:', error);
      return { success: false, error: error.message };
    }
  }

  // ==================== UTILITY METHODS ====================

  /**
   * Extract user information from JWT token
   */
  extractUserFromToken(token) {
    try {
      const cleanToken = token.replace(/^Bearer\s+/i, '');
      const decoded = jwt.decode(cleanToken);
      
      if (!decoded) {
        throw new Error('Invalid token format');
      }

      return {
        userId: decoded.id || decoded.userId || decoded.sub,
        name: decoded.name || decoded.username || decoded.displayName,
        email: decoded.email || decoded.email_address,
        role: decoded.role || 'student',
        firstName: decoded.firstName || decoded.first_name,
        lastName: decoded.lastName || decoded.last_name,
        department: decoded.department,
        studentId: decoded.studentId || decoded.student_id
      };
    } catch (error) {
      throw new Error(`Token extraction failed: ${error.message}`);
    }
  }

  /**
   * Calculate attendance data for a participant
   */
  async calculateAttendanceData(participant, meetingId, options = {}) {
    try {
      const meetingInfo = await ZoomMeeting.findOne({ meetingId: meetingId.toString() });
      const meetingDuration = meetingInfo ? meetingInfo.duration || 60 : 60;

      let duration = options.overrideDuration || participant.duration || 0;
      
      // Calculate real-time duration for active participants
      if (participant.isActive && participant.joinTime) {
        const joinTime = safeCreateDate(participant.joinTime);
        if (joinTime) {
          duration = safeDateDuration(joinTime, getCurrentTimestamp());
        }
      }

      const attendancePercentage = meetingDuration > 0 ? Math.round((duration / meetingDuration) * 100) : 0;
      const meetsThreshold = attendancePercentage >= 85;
      
      let attendanceStatus = 'Absent';
      if (participant.isActive) {
        attendanceStatus = 'In Progress';
      } else if (meetsThreshold) {
        attendanceStatus = 'Present';
      }

      return {
        duration,
        attendancePercentage,
        attendanceStatus,
        meetsThreshold,
        meetingDuration,
        thresholdDuration: Math.round(meetingDuration * 0.85),
        joinTime: safeDateFormat(participant.joinTime, 'N/A', { format: 'datetime' }),
        leaveTime: participant.leaveTime ? safeDateFormat(participant.leaveTime, 'N/A', { format: 'datetime' }) : null
      };

    } catch (error) {
      console.error('❌ Error calculating attendance data:', error);
      return {
        duration: 0,
        attendancePercentage: 0,
        attendanceStatus: 'Unknown',
        meetsThreshold: false,
        meetingDuration: 60,
        thresholdDuration: 51,
        joinTime: 'N/A',
        leaveTime: null
      };
    }
  }

  /**
   * Calculate comprehensive statistics
   */
  calculateComprehensiveStatistics(participants, threshold = 85) {
    const totalParticipants = participants.length;
    const presentCount = participants.filter(p => p.attendanceStatus === 'Present').length;
    const absentCount = participants.filter(p => p.attendanceStatus === 'Absent').length;
    const inProgressCount = participants.filter(p => p.attendanceStatus === 'In Progress').length;
    
    const durations = participants.map(p => p.duration).filter(d => d > 0);
    const averageDuration = durations.length > 0 ? 
      Math.round(durations.reduce((sum, d) => sum + d, 0) / durations.length) : 0;
    
    const longestSession = durations.length > 0 ? Math.max(...durations) : 0;
    const shortestSession = durations.length > 0 ? Math.min(...durations) : 0;
    const totalActiveDuration = durations.reduce((sum, d) => sum + d, 0);
    
    const averageAttendance = totalParticipants > 0 ? 
      Math.round(participants.reduce((sum, p) => sum + p.attendancePercentage, 0) / totalParticipants) : 0;
    
    const attendanceRate = totalParticipants > 0 ?
      Math.round((presentCount / totalParticipants) * 100) : 0;

    const meetingDuration = participants[0]?.meetingDuration || 60;
    const authenticatedCount = participants.filter(p => p.isAuthenticated).length;
    const webhookCount = participants.filter(p => p.source === 'zoom_webhook').length;
    const tokenCount = participants.filter(p => p.source === 'jwt_token').length;

    return {
      totalParticipants,
      presentCount,
      absentCount,
      inProgressCount,
      averageAttendance,
      meetingDuration,
      attendanceRate,
      thresholdDuration: Math.round(meetingDuration * (threshold / 100)),
      threshold,
      averageDuration,
      longestSession,
      shortestSession,
      totalActiveDuration,
      authenticatedCount,
      webhookBasedCount: webhookCount,
      tokenBasedCount: tokenCount,
      participationEfficiency: averageAttendance,
      meetingUtilization: totalParticipants > 0 ? 
        Math.round((totalActiveDuration / (meetingDuration * totalParticipants)) * 100) : 0
    };
  }

  /**
   * Get display name for participant
   */
  getDisplayName(participant) {
    if (participant.userInfo?.firstName && participant.userInfo?.lastName) {
      return `${participant.userInfo.firstName} ${participant.userInfo.lastName}`;
    }
    if (participant.studentInfo?.firstName && participant.studentInfo?.lastName) {
      return `${participant.studentInfo.firstName} ${participant.studentInfo.lastName}`;
    }
    return participant.participantName;
  }

  /**
   * Find student by email
   */
  async findStudentByEmail(email) {
    try {
      return await Student.findOne({
        $or: [
          { Email: { $regex: new RegExp(email, 'i') } },
          { Email: email }
        ]
      });
    } catch (error) {
      console.warn('Warning: Error matching student by email:', error.message);
      return null;
    }
  }

  /**
   * Find student by email or student ID
   */
  async findStudentByEmailOrId(email, studentId) {
    try {
      if (studentId) {
        const student = await Student.findOne({ StudentID: studentId });
        if (student) return student;
      }
      if (email) {
        return await this.findStudentByEmail(email);
      }
      return null;
    } catch (error) {
      console.warn('Warning: Error matching student:', error.message);
      return null;
    }
  }

  /**
   * Save participant to database
   */
  async saveParticipant(participantData) {
    try {
      const participant = new Participant(participantData);
      return await participant.save();
    } catch (error) {
      console.error('Error saving participant:', error);
      throw new Error(`Database save failed: ${error.message}`);
    }
  }

  /**
   * Update meeting participant count
   */
  async updateMeetingParticipantCount(meetingId, increment) {
    try {
      await ZoomMeeting.findOneAndUpdate(
        { meetingId: meetingId.toString() },
        {
          $inc: { activeParticipants: increment },
          $set: { lastActivity: getCurrentTimestamp() }
        }
      );
    } catch (error) {
      console.warn('Warning: Error updating meeting participant count:', error.message);
    }
  }

  /**
   * Emit real-time participant updates
   */
  async emitParticipantUpdate(action, participant, meetingId, source) {
    if (!this.io) return;

    try {
      const attendanceData = await this.calculateAttendanceData(participant, meetingId);
      
      const updateData = {
        type: `participant_${action}`,
        method: 'unified',
        source: source,
        meetingId: meetingId.toString(),
        participant: {
          ...participant.toObject(),
          ...attendanceData,
          displayName: this.getDisplayName(participant),
          displayEmail: participant.email
        },
        timestamp: new Date().toISOString()
      };

      // Emit to meeting-specific room
      this.io.to(`meeting_${meetingId}`).emit(`participant${action.charAt(0).toUpperCase() + action.slice(1)}`, updateData);
      
      // Emit to attendance tracker room
      this.io.to(`attendance_tracker_${meetingId}`).emit('attendance85Update', {
        ...updateData,
        action
      });

      console.log(`📡 [UNIFIED] Emitted ${action} update for ${this.getDisplayName(participant)}`);
    } catch (error) {
      console.error('Error emitting participant update:', error);
    }
  }

  /**
   * Update active participants periodically
   */
  async updateActiveParticipants() {
    for (const [sessionId, sessionData] of this.activeSessions.entries()) {
      try {
        const participant = await Participant.findById(sessionData.participantData._id);
        if (participant && participant.isActive) {
          await this.emitParticipantUpdate('update', participant, sessionData.meetingId, sessionData.source);
        }
      } catch (error) {
        console.error(`Error updating active participant ${sessionId}:`, error);
      }
    }
  }
}

module.exports = UnifiedAttendanceTracker;
