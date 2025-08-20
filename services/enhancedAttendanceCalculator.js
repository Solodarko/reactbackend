const ZoomAttendance = require('../models/ZoomAttendance');
const ZoomMeeting = require('../models/ZoomMeeting');

/**
 * Enhanced Attendance Calculator Service
 * 
 * This service implements the comprehensive attendance tracking system:
 * 1. Get Meeting Duration from webhooks (meeting.started & meeting.ended)
 * 2. Track Each User's Join/Leave Sessions
 * 3. Accumulate Time per User across multiple sessions
 * 4. Compute Attendance Percentage against total meeting duration
 * 5. Check Against 85% Threshold for Present/Absent determination
 * 6. Save Attendance Status in the database
 */
class EnhancedAttendanceCalculator {
  constructor() {
    this.processingMeetings = new Set(); // Track meetings being processed
    this.attendanceThreshold = 85; // 85% threshold for Present status
  }

  /**
   * Process meeting end event and calculate final attendance for all participants
   * @param {Object} meetingEndData - Meeting end webhook data
   * @returns {Object} - Processing result with attendance calculations
   */
  async processMeetingEnd(meetingEndData) {
    try {
      const meetingUuid = meetingEndData.object?.uuid;
      const meetingId = meetingEndData.object?.id;
      
      if (!meetingUuid || !meetingId) {
        throw new Error('Missing meeting UUID or ID in meeting end data');
      }

      // Prevent duplicate processing
      if (this.processingMeetings.has(meetingUuid)) {
        console.log(`⚠️ Meeting ${meetingId} already being processed for attendance calculation`);
        return { success: false, message: 'Already processing' };
      }

      this.processingMeetings.add(meetingUuid);
      console.log(`🧮 Starting enhanced attendance calculation for meeting: ${meetingId}`);

      try {
        // Get meeting record and update with end time
        const meeting = await this.updateMeetingEndTime(meetingUuid, meetingId, meetingEndData);
        
        if (!meeting) {
          throw new Error('Meeting not found in database');
        }

        // Get meeting duration
        const meetingDuration = this.calculateMeetingDuration(meeting);
        
        if (meetingDuration <= 0) {
          throw new Error('Invalid meeting duration calculated');
        }

        console.log(`📊 Meeting duration: ${meetingDuration} minutes`);

        // Get all unique participants in this meeting
        const uniqueParticipants = await this.getUniqueParticipants(meetingUuid);
        
        console.log(`👥 Found ${uniqueParticipants.length} unique participants to process`);

        const attendanceResults = [];

        // Process each unique participant
        for (const participant of uniqueParticipants) {
          try {
            const result = await this.calculateParticipantAttendance(
              meetingUuid,
              participant,
              meetingDuration,
              meeting
            );
            
            attendanceResults.push(result);
          } catch (error) {
            console.error(`❌ Error calculating attendance for participant ${participant.name}:`, error);
            attendanceResults.push({
              participant: participant,
              error: error.message,
              attendancePercentage: 0,
              status: 'Absent'
            });
          }
        }

        // Update meeting with attendance summary
        await this.updateMeetingAttendanceSummary(meeting, attendanceResults);

        const summary = {
          meetingId: meeting.meetingId,
          meetingUuid: meeting.meetingUuid,
          meetingDuration: meetingDuration,
          totalParticipants: attendanceResults.length,
          present: attendanceResults.filter(r => r.status === 'Present').length,
          absent: attendanceResults.filter(r => r.status === 'Absent').length,
          attendanceRate: attendanceResults.length > 0 ? 
            Math.round((attendanceResults.filter(r => r.status === 'Present').length / attendanceResults.length) * 100) : 0,
          results: attendanceResults
        };

        console.log(`✅ Enhanced attendance calculation completed for meeting ${meetingId}`);
        console.log(`📈 Results: ${summary.present}/${summary.totalParticipants} present (${summary.attendanceRate}%)`);

        return {
          success: true,
          summary,
          timestamp: new Date()
        };

      } finally {
        this.processingMeetings.delete(meetingUuid);
      }

    } catch (error) {
      console.error('❌ Error in enhanced attendance calculation:', error);
      return {
        success: false,
        error: error.message,
        timestamp: new Date()
      };
    }
  }

  /**
   * Update meeting record with end time and duration
   */
  async updateMeetingEndTime(meetingUuid, meetingId, meetingEndData) {
    try {
      const meeting = await ZoomMeeting.findOne({
        $or: [{ meetingUuid }, { meetingId }]
      });

      if (meeting) {
        meeting.endTime = new Date(meetingEndData.object?.end_time || Date.now());
        meeting.status = 'ended';
        meeting.attendanceCalculated = true;
        meeting.attendanceCalculatedAt = new Date();
        
        await meeting.save();
        console.log(`📅 Updated meeting ${meetingId} with end time: ${meeting.endTime}`);
      }

      return meeting;
    } catch (error) {
      console.error('Error updating meeting end time:', error);
      throw error;
    }
  }

  /**
   * Calculate meeting duration in minutes
   */
  calculateMeetingDuration(meeting) {
    if (!meeting.startTime || !meeting.endTime) {
      // If no recorded start/end times, try to calculate from first/last participant events
      console.warn('⚠️ Missing meeting start/end times, will calculate from participant data');
      return null; // Will be calculated later from participant data
    }

    const durationMs = meeting.endTime - meeting.startTime;
    const durationMinutes = Math.round(durationMs / (1000 * 60));
    
    return Math.max(1, durationMinutes); // Ensure at least 1 minute
  }

  /**
   * Get all unique participants in a meeting
   */
  async getUniqueParticipants(meetingUuid) {
    try {
      const pipeline = [
        { $match: { meetingUuid } },
        {
          $group: {
            _id: {
              email: { $toLower: '$participantEmail' },
              name: { $toLower: '$participantName' }
            },
            participantEmail: { $first: '$participantEmail' },
            participantName: { $first: '$participantName' },
            studentId: { $first: '$studentId' },
            isMatched: { $first: '$isMatched' },
            sessionCount: { $sum: 1 }
          }
        },
        {
          $project: {
            email: '$participantEmail',
            name: '$participantName',
            studentId: '$studentId',
            isMatched: '$isMatched',
            sessionCount: '$sessionCount'
          }
        }
      ];

      const uniqueParticipants = await ZoomAttendance.aggregate(pipeline);
      return uniqueParticipants;
    } catch (error) {
      console.error('Error getting unique participants:', error);
      throw error;
    }
  }

  /**
   * Calculate attendance for a single participant across all their sessions
   */
  async calculateParticipantAttendance(meetingUuid, participant, meetingDuration, meeting) {
    try {
      console.log(`🧮 Calculating attendance for: ${participant.name} (${participant.email})`);

      // Get all sessions for this participant
      const attendanceData = await ZoomAttendance.calculateUserAttendanceTime(
        meetingUuid,
        participant.email,
        'email'
      );

      let totalAttendanceTimeSeconds = attendanceData.totalAttendanceTime;
      const sessions = attendanceData.sessions;

      // If meeting duration is not available, calculate from participant data
      let effectiveMeetingDuration = meetingDuration;
      if (!effectiveMeetingDuration && sessions.length > 0) {
        effectiveMeetingDuration = this.calculateMeetingDurationFromParticipants(meetingUuid);
      }

      if (!effectiveMeetingDuration || effectiveMeetingDuration <= 0) {
        console.warn(`⚠️ Could not determine meeting duration for ${participant.name}, defaulting to total session time`);
        effectiveMeetingDuration = Math.round(totalAttendanceTimeSeconds / 60); // Convert to minutes
      }

      // Calculate attendance percentage and status using 85% threshold
      const { attendancePercentage, status } = ZoomAttendance.calculateAttendanceStatus(
        totalAttendanceTimeSeconds,
        effectiveMeetingDuration
      );

      // Update all sessions for this participant with final calculations
      await this.updateParticipantSessions(
        meetingUuid,
        participant,
        attendancePercentage,
        status,
        totalAttendanceTimeSeconds,
        effectiveMeetingDuration
      );

      const result = {
        participant: {
          name: participant.name,
          email: participant.email,
          studentId: participant.studentId,
          isMatched: participant.isMatched
        },
        sessions: sessions,
        sessionCount: sessions.length,
        totalAttendanceTime: totalAttendanceTimeSeconds,
        totalAttendanceMinutes: Math.round(totalAttendanceTimeSeconds / 60),
        meetingDuration: effectiveMeetingDuration,
        attendancePercentage,
        status,
        thresholdMet: attendancePercentage >= this.attendanceThreshold
      };

      console.log(`📊 ${participant.name}: ${attendancePercentage}% attendance → ${status}`);
      return result;

    } catch (error) {
      console.error(`Error calculating attendance for participant ${participant.name}:`, error);
      throw error;
    }
  }

  /**
   * Calculate meeting duration from earliest join to latest leave across all participants
   */
  async calculateMeetingDurationFromParticipants(meetingUuid) {
    try {
      const pipeline = [
        { $match: { meetingUuid, joinTime: { $exists: true } } },
        {
          $group: {
            _id: null,
            earliestJoin: { $min: '$joinTime' },
            latestLeave: { $max: '$leaveTime' }
          }
        }
      ];

      const result = await ZoomAttendance.aggregate(pipeline);
      
      if (result.length === 0 || !result[0].earliestJoin) {
        return null;
      }

      const earliestJoin = result[0].earliestJoin;
      const latestLeave = result[0].latestLeave || new Date();
      
      const durationMs = latestLeave - earliestJoin;
      const durationMinutes = Math.round(durationMs / (1000 * 60));
      
      console.log(`📅 Calculated meeting duration from participant data: ${durationMinutes} minutes`);
      return Math.max(1, durationMinutes);
    } catch (error) {
      console.error('Error calculating meeting duration from participants:', error);
      return null;
    }
  }

  /**
   * Update all sessions for a participant with final attendance calculations
   */
  async updateParticipantSessions(meetingUuid, participant, attendancePercentage, status, totalTime, meetingDuration) {
    try {
      const updateResult = await ZoomAttendance.updateMany(
        {
          meetingUuid,
          $or: [
            { participantEmail: participant.email },
            { participantName: participant.name }
          ]
        },
        {
          $set: {
            attendancePercentage,
            attendanceStatus: status,
            isValidAttendance: true,
            finalAttendanceCalculated: true,
            finalAttendanceCalculatedAt: new Date(),
            totalMeetingAttendanceTime: totalTime,
            effectiveMeetingDuration: meetingDuration
          }
        }
      );

      console.log(`💾 Updated ${updateResult.modifiedCount} session records for ${participant.name}`);
    } catch (error) {
      console.error(`Error updating sessions for ${participant.name}:`, error);
      throw error;
    }
  }

  /**
   * Update meeting record with attendance summary
   */
  async updateMeetingAttendanceSummary(meeting, attendanceResults) {
    try {
      const summary = {
        totalParticipants: attendanceResults.length,
        present: attendanceResults.filter(r => r.status === 'Present').length,
        absent: attendanceResults.filter(r => r.status === 'Absent').length,
        attendanceRate: attendanceResults.length > 0 ? 
          Math.round((attendanceResults.filter(r => r.status === 'Present').length / attendanceResults.length) * 100) : 0,
        studentsPresent: attendanceResults.filter(r => r.status === 'Present' && r.participant.isMatched).length,
        studentsAbsent: attendanceResults.filter(r => r.status === 'Absent' && r.participant.isMatched).length
      };

      meeting.attendanceSummary = summary;
      meeting.attendanceCompletedAt = new Date();
      
      await meeting.save();
      
      console.log(`📊 Updated meeting ${meeting.meetingId} with attendance summary:`, summary);
    } catch (error) {
      console.error('Error updating meeting attendance summary:', error);
      throw error;
    }
  }

  /**
   * Get detailed attendance report for a meeting
   */
  async getDetailedAttendanceReport(meetingId, format = 'json') {
    try {
      const meeting = await ZoomMeeting.findOne({
        $or: [{ meetingId }, { meetingUuid: meetingId }]
      });

      if (!meeting) {
        throw new Error('Meeting not found');
      }

      // Get attendance summary with participant details
      const attendanceSummary = await ZoomAttendance.getAttendanceSummary(meeting.meetingId);
      
      // Get unique participants with their total attendance
      const uniqueParticipants = await this.getUniqueParticipants(meeting.meetingUuid);
      
      const detailedResults = [];
      for (const participant of uniqueParticipants) {
        const attendanceData = await ZoomAttendance.calculateUserAttendanceTime(
          meeting.meetingUuid,
          participant.email,
          'email'
        );

        detailedResults.push({
          meetingId: meeting.meetingId,
          meetingTopic: meeting.topic,
          meetingDate: meeting.startTime,
          meetingDuration: meeting.actualDuration || this.calculateMeetingDuration(meeting),
          participantName: participant.name,
          participantEmail: participant.email,
          studentId: participant.studentId,
          isStudentMatched: participant.isMatched,
          sessionCount: attendanceData.sessionCount,
          totalAttendanceTime: Math.round(attendanceData.totalAttendanceTime / 60), // in minutes
          attendancePercentage: attendanceData.attendancePercentage,
          attendanceStatus: attendanceData.status,
          thresholdMet: (attendanceData.attendancePercentage || 0) >= this.attendanceThreshold,
          sessions: attendanceData.sessions
        });
      }

      const report = {
        meeting: {
          id: meeting.meetingId,
          uuid: meeting.meetingUuid,
          topic: meeting.topic,
          startTime: meeting.startTime,
          endTime: meeting.endTime,
          duration: meeting.actualDuration || this.calculateMeetingDuration(meeting)
        },
        summary: {
          totalParticipants: detailedResults.length,
          studentsMatched: detailedResults.filter(r => r.isStudentMatched).length,
          present: detailedResults.filter(r => r.attendanceStatus === 'Present').length,
          absent: detailedResults.filter(r => r.attendanceStatus === 'Absent').length,
          attendanceRate: detailedResults.length > 0 ? 
            Math.round((detailedResults.filter(r => r.attendanceStatus === 'Present').length / detailedResults.length) * 100) : 0,
          threshold: this.attendanceThreshold
        },
        participants: detailedResults,
        generatedAt: new Date()
      };

      return report;
    } catch (error) {
      console.error('Error generating detailed attendance report:', error);
      throw error;
    }
  }

  /**
   * Export attendance report to CSV format
   */
  async exportAttendanceReportCSV(meetingId) {
    try {
      const report = await this.getDetailedAttendanceReport(meetingId);
      
      const csvHeaders = [
        'Meeting ID',
        'Meeting Topic', 
        'Meeting Date',
        'Meeting Duration (min)',
        'Participant Name',
        'Email',
        'Student ID',
        'Student Matched',
        'Session Count',
        'Total Attendance (min)',
        'Attendance %',
        'Status',
        'Threshold Met (85%)',
        'Join Times',
        'Leave Times'
      ].join(',') + '\n';

      const csvRows = report.participants.map(p => {
        const joinTimes = p.sessions.map(s => new Date(s.joinTime).toISOString()).join('; ');
        const leaveTimes = p.sessions.map(s => s.leaveTime ? new Date(s.leaveTime).toISOString() : 'In Progress').join('; ');
        
        return [
          p.meetingId,
          `"${p.meetingTopic}"`,
          new Date(p.meetingDate).toISOString(),
          p.meetingDuration,
          `"${p.participantName}"`,
          p.participantEmail || 'N/A',
          p.studentId || 'N/A',
          p.isStudentMatched ? 'Yes' : 'No',
          p.sessionCount,
          p.totalAttendanceTime,
          p.attendancePercentage || 0,
          p.attendanceStatus || 'Absent',
          p.thresholdMet ? 'Yes' : 'No',
          `"${joinTimes}"`,
          `"${leaveTimes}"`
        ].join(',');
      }).join('\n');

      return csvHeaders + csvRows;
    } catch (error) {
      console.error('Error exporting CSV report:', error);
      throw error;
    }
  }

  /**
   * Get attendance statistics across multiple meetings
   */
  async getAttendanceStatistics(dateRange = null) {
    try {
      let matchQuery = {};
      
      if (dateRange && dateRange.start && dateRange.end) {
        matchQuery.startTime = {
          $gte: new Date(dateRange.start),
          $lte: new Date(dateRange.end)
        };
      }

      const pipeline = [
        { $match: matchQuery },
        {
          $lookup: {
            from: 'zoomattendances',
            localField: 'meetingUuid',
            foreignField: 'meetingUuid',
            as: 'attendance'
          }
        },
        {
          $project: {
            meetingId: 1,
            topic: 1,
            startTime: 1,
            endTime: 1,
            totalParticipants: { $size: '$attendance' },
            present: {
              $size: {
                $filter: {
                  input: '$attendance',
                  as: 'att',
                  cond: { $eq: ['$$att.attendanceStatus', 'Present'] }
                }
              }
            },
            absent: {
              $size: {
                $filter: {
                  input: '$attendance',
                  as: 'att',
                  cond: { $eq: ['$$att.attendanceStatus', 'Absent'] }
                }
              }
            }
          }
        },
        {
          $addFields: {
            attendanceRate: {
              $cond: {
                if: { $gt: ['$totalParticipants', 0] },
                then: { $round: [{ $multiply: [{ $divide: ['$present', '$totalParticipants'] }, 100] }, 2] },
                else: 0
              }
            }
          }
        },
        { $sort: { startTime: -1 } }
      ];

      const meetings = await ZoomMeeting.aggregate(pipeline);
      
      const overallStats = {
        totalMeetings: meetings.length,
        totalParticipants: meetings.reduce((sum, m) => sum + m.totalParticipants, 0),
        totalPresent: meetings.reduce((sum, m) => sum + m.present, 0),
        totalAbsent: meetings.reduce((sum, m) => sum + m.absent, 0),
        averageAttendanceRate: meetings.length > 0 ? 
          Math.round(meetings.reduce((sum, m) => sum + m.attendanceRate, 0) / meetings.length) : 0
      };

      return {
        overallStatistics: overallStats,
        meetings: meetings,
        threshold: this.attendanceThreshold,
        dateRange: dateRange,
        generatedAt: new Date()
      };
    } catch (error) {
      console.error('Error getting attendance statistics:', error);
      throw error;
    }
  }
}

module.exports = EnhancedAttendanceCalculator;
