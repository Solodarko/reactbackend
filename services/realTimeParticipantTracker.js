const mongoose = require('mongoose');
const Participant = require('../models/Participant');
const Student = require('../models/Student');
const ZoomMeeting = require('../models/ZoomMeeting');

class RealTimeParticipantTracker {
  constructor(io) {
    this.io = io;
    this.activeMeetings = new Map(); // meetingId -> meeting data
    this.participantSessions = new Map(); // participantId -> session data
    console.log('🎯 Real-Time Participant Tracker initialized');
  }

  /**
   * Handle participant joining a meeting
   */
  async handleParticipantJoin(webhookData) {
    try {
      console.log('👋 Participant joining:', webhookData);
      
      const {
        meeting_id: meetingId,
        participant_user_id: participantId,
        participant_user_name: participantName,
        participant_join_time: joinTime,
        participant_email: email
      } = webhookData;

      // Create participant record
      const participantData = {
        meetingId: meetingId.toString(),
        participantId: participantId.toString(),
        participantName: participantName || 'Anonymous User',
        email: email || '',
        joinTime: new Date(joinTime || Date.now()),
        leaveTime: null,
        duration: null,
        isActive: true,
        connectionStatus: 'in_meeting',
        userType: 'participant',
        createdAt: new Date()
      };

      // Try to match with student database
      if (email) {
        try {
          const student = await Student.findOne({
            $or: [
              { Email: { $regex: new RegExp(email, 'i') } },
              { Email: email }
            ]
          });
          
          if (student) {
            participantData.studentInfo = {
              studentId: student.StudentID,
              firstName: student.FirstName,
              lastName: student.LastName,
              department: student.Department,
              email: student.Email
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
        // Check if participant already exists (in case of reconnection)
        const existingParticipant = await Participant.findOne({
          meetingId: meetingId.toString(),
          participantId: participantId.toString()
        });

        if (existingParticipant) {
          // Update existing participant (rejoin case)
          savedParticipant = await Participant.findOneAndUpdate(
            { meetingId: meetingId.toString(), participantId: participantId.toString() },
            {
              $set: {
                isActive: true,
                connectionStatus: 'in_meeting',
                joinTime: new Date(joinTime || Date.now()),
                leaveTime: null,
                lastActivity: new Date()
              }
            },
            { new: true, upsert: false }
          );
          console.log('🔄 Updated existing participant:', participantName);
        } else {
          // Create new participant
          const participant = new Participant(participantData);
          savedParticipant = await participant.save();
          console.log('➕ Created new participant:', participantName);
        }
      } catch (dbError) {
        console.error('❌ Error saving participant:', dbError);
        return { success: false, error: dbError.message };
      }

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

      // Store in memory for quick access
      this.participantSessions.set(participantId.toString(), {
        meetingId: meetingId.toString(),
        joinTime: new Date(joinTime || Date.now()),
        participantData: savedParticipant
      });

      // Emit real-time update to frontend
      if (this.io) {
        const updateData = {
          type: 'participant_joined',
          meetingId: meetingId.toString(),
          participant: {
            ...savedParticipant.toObject(),
            // Calculate real-time data
            duration: 0, // Just joined
            attendancePercentage: 0,
            attendanceStatus: 'In Progress'
          },
          timestamp: new Date().toISOString()
        };

        // Emit to meeting-specific room
        this.io.to(`meeting_${meetingId}`).emit('participantJoined', updateData);
        
        // Emit to attendance tracker room
        this.io.to(`attendance_tracker_${meetingId}`).emit('attendance85Update', {
          meetingId: meetingId.toString(),
          participant: updateData.participant,
          action: 'joined'
        });

        console.log('📡 Emitted real-time participant join update');
      }

      return {
        success: true,
        participant: savedParticipant,
        message: `Participant ${participantName} joined meeting ${meetingId}`
      };

    } catch (error) {
      console.error('❌ Error handling participant join:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Handle participant leaving a meeting
   */
  async handleParticipantLeave(webhookData) {
    try {
      console.log('👋 Participant leaving:', webhookData);
      
      const {
        meeting_id: meetingId,
        participant_user_id: participantId,
        participant_user_name: participantName,
        participant_leave_time: leaveTime
      } = webhookData;

      const leaveDateTime = new Date(leaveTime || Date.now());

      // Get session data
      const sessionData = this.participantSessions.get(participantId.toString());
      
      // Calculate duration
      let duration = 0;
      if (sessionData && sessionData.joinTime) {
        duration = Math.round((leaveDateTime.getTime() - sessionData.joinTime.getTime()) / (1000 * 60));
      }

      // Update participant in database
      const updatedParticipant = await Participant.findOneAndUpdate(
        { meetingId: meetingId.toString(), participantId: participantId.toString() },
        {
          $set: {
            leaveTime: leaveDateTime,
            duration: duration,
            isActive: false,
            connectionStatus: 'left',
            lastActivity: new Date()
          }
        },
        { new: true }
      );

      if (updatedParticipant) {
        // Update meeting participant count
        try {
          await ZoomMeeting.findOneAndUpdate(
            { meetingId: meetingId.toString() },
            {
              $inc: { activeParticipants: -1 },
              $set: { lastActivity: new Date() }
            }
          );
        } catch (meetingError) {
          console.warn('⚠️ Error updating meeting participant count:', meetingError.message);
        }

        // Calculate attendance data
        const meetingInfo = await ZoomMeeting.findOne({ meetingId: meetingId.toString() });
        const meetingDuration = meetingInfo ? meetingInfo.duration || 60 : 60;
        const attendancePercentage = Math.round((duration / meetingDuration) * 100);
        const attendanceStatus = attendancePercentage >= 85 ? 'Present' : 'Absent';

        // Remove from active sessions
        this.participantSessions.delete(participantId.toString());

        // Emit real-time update to frontend
        if (this.io) {
          const updateData = {
            type: 'participant_left',
            meetingId: meetingId.toString(),
            participant: {
              ...updatedParticipant.toObject(),
              duration,
              attendancePercentage,
              attendanceStatus,
              meetsThreshold: attendancePercentage >= 85
            },
            timestamp: new Date().toISOString()
          };

          // Emit to meeting-specific room
          this.io.to(`meeting_${meetingId}`).emit('participantLeft', updateData);
          
          // Emit to attendance tracker room
          this.io.to(`attendance_tracker_${meetingId}`).emit('attendance85Update', {
            meetingId: meetingId.toString(),
            participant: updateData.participant,
            action: 'left'
          });

          console.log('📡 Emitted real-time participant leave update');
        }

        console.log(`✅ Participant ${participantName} left meeting ${meetingId} after ${duration} minutes`);

        return {
          success: true,
          participant: updatedParticipant,
          duration,
          attendancePercentage,
          attendanceStatus,
          message: `Participant ${participantName} left after ${duration} minutes`
        };
      } else {
        console.warn('⚠️ Participant not found in database');
        return { success: false, error: 'Participant not found' };
      }

    } catch (error) {
      console.error('❌ Error handling participant leave:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Get current participants for a meeting (for real-time display)
   */
  async getCurrentParticipants(meetingId, threshold = 85) {
    try {
      const participants = await Participant.find({ meetingId: meetingId.toString() })
        .populate('userId', 'username email role')
        .sort({ joinTime: 1 });

      const meetingInfo = await ZoomMeeting.findOne({ meetingId: meetingId.toString() });
      const meetingDuration = meetingInfo ? meetingInfo.duration || 60 : 60;

      const processedParticipants = participants.map(participant => {
        let duration = participant.duration || 0;
        
        // Calculate real-time duration for active participants
        if (participant.isActive && participant.joinTime) {
          duration = Math.round((Date.now() - participant.joinTime.getTime()) / (1000 * 60));
        }

        const attendancePercentage = Math.round((duration / meetingDuration) * 100);
        const meetsThreshold = attendancePercentage >= threshold;
        
        let attendanceStatus = 'Absent';
        if (participant.isActive) {
          attendanceStatus = 'In Progress';
        } else if (meetsThreshold) {
          attendanceStatus = 'Present';
        }

        return {
          ...participant.toObject(),
          duration,
          attendancePercentage,
          attendanceStatus,
          meetsThreshold,
          thresholdDuration: Math.round(meetingDuration * (threshold / 100))
        };
      });

      const statistics = {
        totalParticipants: processedParticipants.length,
        presentCount: processedParticipants.filter(p => p.meetsThreshold || p.attendanceStatus === 'In Progress').length,
        absentCount: processedParticipants.filter(p => !p.meetsThreshold && p.attendanceStatus !== 'In Progress').length,
        inProgressCount: processedParticipants.filter(p => p.attendanceStatus === 'In Progress').length,
        averageAttendance: processedParticipants.length > 0 ? 
          Math.round(processedParticipants.reduce((sum, p) => sum + p.attendancePercentage, 0) / processedParticipants.length) : 0,
        meetingDuration,
        threshold,
        thresholdDuration: Math.round(meetingDuration * (threshold / 100))
      };

      return {
        success: true,
        participants: processedParticipants,
        statistics
      };

    } catch (error) {
      console.error('❌ Error getting current participants:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Start periodic updates for active meetings
   */
  startPeriodicUpdates() {
    setInterval(async () => {
      // Get all active meetings
      const activeMeetings = await ZoomMeeting.find({ 
        status: { $in: ['started', 'in_progress'] },
        activeParticipants: { $gt: 0 }
      });

      for (const meeting of activeMeetings) {
        try {
          const participantData = await this.getCurrentParticipants(meeting.meetingId);
          
          if (participantData.success && this.io) {
            // Emit periodic update
            this.io.to(`attendance_tracker_${meeting.meetingId}`).emit('attendance85Update', {
              meetingId: meeting.meetingId,
              data: participantData,
              timestamp: new Date().toISOString(),
              type: 'periodic_update'
            });
          }
        } catch (error) {
          console.error('❌ Error in periodic update for meeting', meeting.meetingId, ':', error.message);
        }
      }
    }, 30000); // Update every 30 seconds

    console.log('🔄 Started periodic participant updates (every 30 seconds)');
  }
}

module.exports = RealTimeParticipantTracker;
