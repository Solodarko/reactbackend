const jwt = require('jsonwebtoken');
const mongoose = require('mongoose');
const Participant = require('../models/Participant');
const Student = require('../models/Student');
const ZoomMeeting = require('../models/ZoomMeeting');
const { safeCreateDate, safeDateFormat, safeDateDuration, getCurrentTimestamp, sanitizeDateFields } = require('../utils/dateUtils');

class TokenBasedParticipantTracker {
  constructor(io) {
    this.io = io;
    this.activeSessions = new Map(); // token -> participant data
    console.log('🎯 Token-Based Participant Tracker initialized');
  }

  /**
   * Extract user information from JWT token
   */
  extractUserFromToken(token) {
    try {
      // Remove 'Bearer ' prefix if present
      const cleanToken = token.replace(/^Bearer\s+/i, '');
      
      // Decode JWT token without verification (for development)
      // In production, verify with your secret
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
        studentId: decoded.studentId || decoded.student_id,
        tokenData: decoded
      };
    } catch (error) {
      console.error('❌ Error extracting user from token:', error.message);
      throw new Error(`Token extraction failed: ${error.message}`);
    }
  }

  /**
   * Handle participant joining meeting with token-based identification
   */
  async handleTokenBasedJoin(meetingId, token, additionalData = {}) {
    try {
      console.log('👋 Processing token-based participant join for meeting:', meetingId);
      
      // Extract user information from token
      const userInfo = this.extractUserFromToken(token);
      console.log('👤 Extracted user info:', { name: userInfo.name, email: userInfo.email });

      // Create participant data using token information
      const participantData = {
        meetingId: meetingId.toString(),
        participantId: userInfo.userId || `token_${Date.now()}`,
        participantName: userInfo.name || 'Anonymous User',
        email: userInfo.email || '',
        joinTime: new Date(),
        leaveTime: null,
        duration: null,
        isActive: true,
        connectionStatus: 'in_meeting',
        userType: userInfo.role || 'student',
        createdAt: new Date(),
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

      // Try to match with student database using email or studentId
      if (userInfo.email || userInfo.studentId) {
        try {
          let student = null;
          
          if (userInfo.studentId) {
            student = await Student.findOne({ StudentID: userInfo.studentId });
          } else if (userInfo.email) {
            student = await Student.findOne({
              $or: [
                { Email: { $regex: new RegExp(userInfo.email, 'i') } },
                { Email: userInfo.email }
              ]
            });
          }
          
          if (student) {
            participantData.studentInfo = {
              studentId: student.StudentID,
              firstName: student.FirstName,
              lastName: student.LastName,
              department: student.Department,
              email: student.Email,
              matchedBy: userInfo.studentId ? 'studentId' : 'email'
            };
            participantData.isStudent = true;
            console.log('📚 Matched participant to student:', student.StudentID);
          }
        } catch (studentError) {
          console.warn('⚠️ Error matching student:', studentError.message);
        }
      }

      // Save to database
      let savedParticipant;
      try {
        // Check if participant already exists (rejoin case)
        const existingParticipant = await Participant.findOne({
          meetingId: meetingId.toString(),
          $or: [
            { participantId: participantData.participantId },
            { email: participantData.email }
          ]
        });

        if (existingParticipant) {
          // Update existing participant (rejoin case)
          savedParticipant = await Participant.findOneAndUpdate(
            { _id: existingParticipant._id },
            {
              $set: {
                isActive: true,
                connectionStatus: 'in_meeting',
                joinTime: new Date(),
                leaveTime: null,
                lastActivity: new Date(),
                tokenBased: true,
                userInfo: participantData.userInfo
              }
            },
            { new: true, upsert: false }
          );
          console.log('🔄 Updated existing token-based participant:', participantData.participantName);
        } else {
          // Create new participant
          const participant = new Participant(participantData);
          savedParticipant = await participant.save();
          console.log('➕ Created new token-based participant:', participantData.participantName);
        }
      } catch (dbError) {
        console.error('❌ Error saving participant:', dbError);
        throw new Error(`Database save failed: ${dbError.message}`);
      }

      // Store in active sessions
      this.activeSessions.set(userInfo.userId, {
        meetingId: meetingId.toString(),
        joinTime: new Date(),
        participantData: savedParticipant,
        userInfo
      });

      // Update meeting participant count
      try {
        await ZoomMeeting.findOneAndUpdate(
          { meetingId: meetingId.toString() },
          {
            $inc: { activeParticipants: 1 },
            $set: { lastActivity: new Date() }
          }
        );
      } catch (meetingError) {
        console.warn('⚠️ Error updating meeting participant count:', meetingError.message);
      }

      // Calculate current attendance data for real-time display
      const attendanceData = await this.calculateAttendanceData(savedParticipant, meetingId);

      // Emit real-time update to frontend
      if (this.io) {
        const updateData = {
          type: 'participant_joined',
          method: 'token_based',
          meetingId: meetingId.toString(),
          participant: {
            ...savedParticipant.toObject(),
            ...attendanceData,
            // Ensure name and email from token are prominently displayed
            displayName: userInfo.name,
            displayEmail: userInfo.email,
            tokenInfo: {
              authenticated: true,
              source: 'jwt_token',
              role: userInfo.role
            }
          },
          timestamp: new Date().toISOString()
        };

        // Emit to meeting-specific room
        this.io.to(`meeting_${meetingId}`).emit('participantJoined', updateData);
        
        // Emit to attendance tracker room
        this.io.to(`attendance_tracker_${meetingId}`).emit('attendance85Update', {
          meetingId: meetingId.toString(),
          participant: updateData.participant,
          action: 'joined',
          method: 'token_based'
        });

        console.log('📡 Emitted real-time token-based participant join update');
      }

      return {
        success: true,
        participant: savedParticipant,
        userInfo,
        attendanceData,
        message: `Token-based participant ${userInfo.name} joined meeting ${meetingId}`
      };

    } catch (error) {
      console.error('❌ Error handling token-based participant join:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Handle participant leaving with token-based identification (Enhanced)
   * This function is the key to finalizing attendance status.
   */
  async handleTokenBasedLeave(meetingId, token) {
    try {
      const userInfo = this.extractUserFromToken(token);
      console.log(`👋 [LEAVE EVENT] Processing token-based participant leave for: ${userInfo.name}`);

      const leaveDateTime = getCurrentTimestamp();
      const sessionData = this.activeSessions.get(userInfo.userId);
      
      const participantRecord = await Participant.findOne({
        meetingId: meetingId.toString(),
        $or: [{ participantId: userInfo.userId }, { email: userInfo.email }]
      });

      if (!participantRecord) {
        console.warn(`⚠️ [LEAVE EVENT] Participant not found in database: ${userInfo.name}`);
        return { success: false, error: 'Participant not found in database for this meeting' };
      }

      // Ensure we don't process the same leave event twice
      if (!participantRecord.isActive) {
        console.log(`ℹ️ [LEAVE EVENT] Participant ${userInfo.name} has already been marked as left.`);
        return { success: true, message: 'Participant already marked as left.', participant: participantRecord };
      }

      // Calculate duration based on stored join time
      const joinTime = safeCreateDate(participantRecord.joinTime);
      let duration = 0;
      if (joinTime) {
        duration = safeDateDuration(joinTime, leaveDateTime);
        console.log(`   [LEAVE EVENT] Calculated duration for ${userInfo.name}: ${duration} minutes`);
      } else {
        console.warn(`   [LEAVE EVENT] Could not find valid join time for ${userInfo.name}. Duration set to 0.`);
      }

      // Update participant in database with final attendance data
      const finalAttendance = await this.calculateAttendanceData(participantRecord, meetingId, { overrideDuration: duration });
      
      participantRecord.leaveTime = leaveDateTime;
      participantRecord.duration = finalAttendance.duration;
      participantRecord.isActive = false;
      participantRecord.connectionStatus = 'left';
      participantRecord.lastActivity = getCurrentTimestamp();
      participantRecord.attendancePercentage = finalAttendance.attendancePercentage;
      participantRecord.attendanceStatus = finalAttendance.attendanceStatus;

      const updatedParticipant = await participantRecord.save();
      console.log(`   [LEAVE EVENT] Final status for ${userInfo.name}: ${updatedParticipant.attendanceStatus}`);

      // Remove from active sessions
      this.activeSessions.delete(userInfo.userId);

      // Update meeting participant count
      try {
        await ZoomMeeting.findOneAndUpdate(
          { meetingId: meetingId.toString() },
          { $inc: { activeParticipants: -1 }, $set: { lastActivity: getCurrentTimestamp() } }
        );
      } catch (meetingError) {
        console.warn(`⚠️ Error updating meeting participant count: ${meetingError.message}`);
      }

      // Emit real-time update to all clients
      if (this.io) {
        const updateData = {
          type: 'participant_left',
          method: 'token_based',
          meetingId: meetingId.toString(),
          participant: {
            ...updatedParticipant.toObject(),
            ...finalAttendance,
            displayName: userInfo.name,
            displayEmail: userInfo.email
          },
          timestamp: new Date().toISOString()
        };

        this.io.to(`meeting_${meetingId}`).emit('participantLeft', updateData);
        this.io.to(`attendance_tracker_${meetingId}`).emit('attendance85Update', updateData);

        console.log('📡 [LEAVE EVENT] Emitted real-time participant leave update');
      }

      return {
        success: true,
        participant: updatedParticipant,
        message: `Participant ${userInfo.name} left. Final status: ${finalAttendance.attendanceStatus}`
      };

    } catch (error) {
      console.error('❌ [LEAVE EVENT] Error handling token-based participant leave:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Calculate attendance data for a participant with safe date handling
   */
  async calculateAttendanceData(participant, meetingId) {
    try {
      const meetingInfo = await ZoomMeeting.findOne({ meetingId: meetingId.toString() });
      const meetingDuration = meetingInfo ? meetingInfo.duration || 60 : 60;

      let duration = participant.duration || 0;
      
      // Calculate real-time duration for active participants using safe date handling
      if (participant.isActive && participant.joinTime) {
        const joinTime = safeCreateDate(participant.joinTime);
        if (joinTime) {
          duration = safeDateDuration(joinTime, getCurrentTimestamp());
        } else {
          console.warn('⚠️ Invalid joinTime for active participant:', participant.joinTime);
          duration = 0;
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
   * Get current participants for a meeting with token-based data
   */
  async getCurrentTokenBasedParticipants(meetingId, threshold = 85) {
    try {
      const participants = await Participant.find({ 
        meetingId: meetingId.toString(),
        tokenBased: true 
      })
        .sort({ joinTime: 1 });

      const processedParticipants = await Promise.all(
        participants.map(async (participant) => {
          const attendanceData = await this.calculateAttendanceData(participant, meetingId);
          
          return {
            ...participant.toObject(),
            ...attendanceData,
            // Use display names from token if available
            displayName: participant.userInfo?.firstName && participant.userInfo?.lastName 
              ? `${participant.userInfo.firstName} ${participant.userInfo.lastName}`
              : participant.participantName,
            displayEmail: participant.email,
            isTokenBased: true,
            authenticationStatus: 'authenticated'
          };
        })
      );

      // Calculate comprehensive statistics
      const meetingDuration = processedParticipants[0]?.meetingDuration || 60;
      const thresholdDuration = Math.round(meetingDuration * (threshold / 100));
      
      const presentCount = processedParticipants.filter(p => p.attendanceStatus === 'Present').length;
      const absentCount = processedParticipants.filter(p => p.attendanceStatus === 'Absent').length;
      const inProgressCount = processedParticipants.filter(p => p.attendanceStatus === 'In Progress').length;
      
      const durations = processedParticipants.map(p => p.duration).filter(d => d > 0);
      const averageDuration = durations.length > 0 ? 
        Math.round(durations.reduce((sum, d) => sum + d, 0) / durations.length) : 0;
      
      const longestSession = durations.length > 0 ? Math.max(...durations) : 0;
      const shortestSession = durations.length > 0 ? Math.min(...durations) : 0;
      const totalActiveDuration = durations.reduce((sum, d) => sum + d, 0);
      
      const averageAttendance = processedParticipants.length > 0 ? 
        Math.round(processedParticipants.reduce((sum, p) => sum + p.attendancePercentage, 0) / processedParticipants.length) : 0;
      
      const attendanceRate = processedParticipants.length > 0 ?
        Math.round((presentCount / processedParticipants.length) * 100) : 0;

      const statistics = {
        totalParticipants: processedParticipants.length,
        presentCount,
        absentCount,
        inProgressCount,
        averageAttendance,
        meetingDuration,
        attendanceRate,
        thresholdDuration,
        threshold,
        // Additional comprehensive statistics
        averageDuration,
        longestSession,
        shortestSession,
        totalActiveDuration,
        authenticatedCount: processedParticipants.length, // All token-based participants are authenticated
        tokenBasedCount: processedParticipants.length,
        // Meeting efficiency metrics
        participationEfficiency: averageAttendance,
        meetingUtilization: Math.round((totalActiveDuration / (meetingDuration * processedParticipants.length)) * 100)
      };

      return {
        success: true,
        participants: processedParticipants,
        statistics,
        method: 'token_based',
        timestamp: new Date().toISOString()
      };

    } catch (error) {
      console.error('❌ Error getting token-based participants:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Update participant status periodically for active sessions
   */
  async updateActiveParticipants() {
    for (const [userId, sessionData] of this.activeSessions.entries()) {
      try {
        const participant = await Participant.findById(sessionData.participantData._id);
        if (participant && participant.isActive) {
          const attendanceData = await this.calculateAttendanceData(participant, sessionData.meetingId);
          
          // Emit real-time update
          if (this.io) {
            this.io.to(`attendance_tracker_${sessionData.meetingId}`).emit('attendance85Update', {
              meetingId: sessionData.meetingId,
              participant: {
                ...participant.toObject(),
                ...attendanceData,
                displayName: sessionData.userInfo.name,
                displayEmail: sessionData.userInfo.email,
                isTokenBased: true
              },
              action: 'update',
              method: 'token_based'
            });
          }
        }
      } catch (error) {
        console.error(`❌ Error updating active participant ${userId}:`, error);
      }
    }
  }
}

module.exports = TokenBasedParticipantTracker;
