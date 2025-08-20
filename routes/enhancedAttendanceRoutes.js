const express = require('express');
const EnhancedAttendanceCalculator = require('../services/enhancedAttendanceCalculator');
const ZoomAttendance = require('../models/ZoomAttendance');
const ZoomMeeting = require('../models/ZoomMeeting');

const router = express.Router();
const attendanceCalculator = new EnhancedAttendanceCalculator();

/**
 * GET /api/enhanced-attendance/report/:meetingId
 * Get detailed attendance report for a specific meeting
 */
router.get('/report/:meetingId', async (req, res) => {
  try {
    const { meetingId } = req.params;
    const { format = 'json' } = req.query;

    console.log(`📊 Generating attendance report for meeting: ${meetingId}`);

    const report = await attendanceCalculator.getDetailedAttendanceReport(meetingId);

    if (format === 'csv') {
      const csvData = await attendanceCalculator.exportAttendanceReportCSV(meetingId);
      const filename = `attendance-${meetingId}-${new Date().toISOString().split('T')[0]}.csv`;
      
      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      res.send(csvData);
    } else {
      res.json({
        success: true,
        data: report,
        timestamp: new Date().toISOString()
      });
    }

  } catch (error) {
    console.error('❌ Error generating attendance report:', error);
    res.status(500).json({
      success: false,
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

/**
 * GET /api/enhanced-attendance/statistics
 * Get attendance statistics across multiple meetings
 */
router.get('/statistics', async (req, res) => {
  try {
    const { startDate, endDate } = req.query;
    
    let dateRange = null;
    if (startDate && endDate) {
      dateRange = {
        start: new Date(startDate),
        end: new Date(endDate)
      };
    }

    console.log('📈 Generating attendance statistics', dateRange ? `from ${dateRange.start} to ${dateRange.end}` : 'for all meetings');

    const statistics = await attendanceCalculator.getAttendanceStatistics(dateRange);

    res.json({
      success: true,
      data: statistics,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('❌ Error generating attendance statistics:', error);
    res.status(500).json({
      success: false,
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

/**
 * GET /api/enhanced-attendance/meetings
 * Get list of meetings with attendance summaries
 */
router.get('/meetings', async (req, res) => {
  try {
    const { limit = 50, offset = 0, status = 'all' } = req.query;

    let query = {};
    if (status !== 'all') {
      query.status = status;
    }

    console.log(`📋 Fetching meetings list (limit: ${limit}, offset: ${offset}, status: ${status})`);

    const meetings = await ZoomMeeting.find(query)
      .sort({ createdAt: -1 })
      .limit(parseInt(limit))
      .skip(parseInt(offset))
      .populate('attendanceSummary')
      .lean();

    // Enhance with attendance data
    const enhancedMeetings = await Promise.all(
      meetings.map(async (meeting) => {
        try {
          const attendanceCount = await ZoomAttendance.countDocuments({ meetingUuid: meeting.meetingUuid });
          const presentCount = await ZoomAttendance.countDocuments({ 
            meetingUuid: meeting.meetingUuid, 
            attendanceStatus: 'Present' 
          });
          const absentCount = await ZoomAttendance.countDocuments({ 
            meetingUuid: meeting.meetingUuid, 
            attendanceStatus: 'Absent' 
          });

          return {
            ...meeting,
            attendanceStats: {
              total: attendanceCount,
              present: presentCount,
              absent: absentCount,
              attendanceRate: attendanceCount > 0 ? Math.round((presentCount / attendanceCount) * 100) : 0,
              threshold: 85
            }
          };
        } catch (error) {
          console.error(`Error enhancing meeting ${meeting.meetingId}:`, error);
          return meeting;
        }
      })
    );

    res.json({
      success: true,
      data: enhancedMeetings,
      pagination: {
        limit: parseInt(limit),
        offset: parseInt(offset),
        total: enhancedMeetings.length
      },
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('❌ Error fetching meetings list:', error);
    res.status(500).json({
      success: false,
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

/**
 * GET /api/enhanced-attendance/participant/:participantIdentifier
 * Get attendance history for a specific participant
 */
router.get('/participant/:participantIdentifier', async (req, res) => {
  try {
    const { participantIdentifier } = req.params;
    const { identifierType = 'email', limit = 20 } = req.query;

    console.log(`👤 Fetching attendance history for participant: ${participantIdentifier} (type: ${identifierType})`);

    let query = {};
    switch (identifierType) {
      case 'email':
        query.participantEmail = { $regex: new RegExp(`^${participantIdentifier}$`, 'i') };
        break;
      case 'name':
        query.participantName = { $regex: new RegExp(participantIdentifier, 'i') };
        break;
      case 'studentId':
        query.studentId = participantIdentifier;
        break;
      default:
        query.participantEmail = { $regex: new RegExp(`^${participantIdentifier}$`, 'i') };
    }

    const attendanceRecords = await ZoomAttendance.find(query)
      .populate({
        path: 'meetingId',
        select: 'topic startTime endTime duration'
      })
      .sort({ joinTime: -1 })
      .limit(parseInt(limit))
      .lean();

    // Group by meeting and calculate total attendance per meeting
    const meetingAttendance = {};
    
    for (const record of attendanceRecords) {
      const meetingKey = record.meetingUuid;
      
      if (!meetingAttendance[meetingKey]) {
        meetingAttendance[meetingKey] = {
          meetingId: record.meetingId,
          meetingTopic: record.meetingTopic,
          sessions: [],
          totalAttendanceTime: 0,
          attendancePercentage: 0,
          status: 'Absent'
        };
      }
      
      meetingAttendance[meetingKey].sessions.push({
        joinTime: record.joinTime,
        leaveTime: record.leaveTime,
        duration: record.duration,
        attendanceStatus: record.attendanceStatus
      });
      
      if (record.duration) {
        meetingAttendance[meetingKey].totalAttendanceTime += record.duration;
      }
      
      // Use the latest calculated status and percentage
      if (record.attendancePercentage) {
        meetingAttendance[meetingKey].attendancePercentage = record.attendancePercentage;
      }
      if (record.attendanceStatus && record.attendanceStatus !== 'In Progress') {
        meetingAttendance[meetingKey].status = record.attendanceStatus;
      }
    }

    const participantSummary = {
      participant: {
        identifier: participantIdentifier,
        identifierType: identifierType,
        name: attendanceRecords.length > 0 ? attendanceRecords[0].participantName : null,
        email: attendanceRecords.length > 0 ? attendanceRecords[0].participantEmail : null,
        studentId: attendanceRecords.length > 0 ? attendanceRecords[0].studentId : null,
        isMatched: attendanceRecords.length > 0 ? attendanceRecords[0].isMatched : false
      },
      meetings: Object.values(meetingAttendance),
      summary: {
        totalMeetings: Object.keys(meetingAttendance).length,
        present: Object.values(meetingAttendance).filter(m => m.status === 'Present').length,
        absent: Object.values(meetingAttendance).filter(m => m.status === 'Absent').length,
        overallAttendanceRate: Object.keys(meetingAttendance).length > 0 ? 
          Math.round((Object.values(meetingAttendance).filter(m => m.status === 'Present').length / Object.keys(meetingAttendance).length) * 100) : 0,
        threshold: 85
      }
    };

    res.json({
      success: true,
      data: participantSummary,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('❌ Error fetching participant attendance:', error);
    res.status(500).json({
      success: false,
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

/**
 * POST /api/enhanced-attendance/calculate/:meetingId
 * Manually trigger enhanced attendance calculation for a meeting
 */
router.post('/calculate/:meetingId', async (req, res) => {
  try {
    const { meetingId } = req.params;
    const { force = false } = req.body;

    console.log(`🧮 Manually triggering attendance calculation for meeting: ${meetingId}`);

    // Get meeting record
    const meeting = await ZoomMeeting.findOne({
      $or: [{ meetingId }, { meetingUuid: meetingId }]
    });

    if (!meeting) {
      return res.status(404).json({
        success: false,
        error: 'Meeting not found',
        timestamp: new Date().toISOString()
      });
    }

    if (meeting.attendanceCalculated && !force) {
      return res.status(409).json({
        success: false,
        error: 'Attendance already calculated. Use force=true to recalculate.',
        timestamp: new Date().toISOString()
      });
    }

    // Create mock meeting end event data for calculation
    const mockMeetingEndData = {
      object: {
        uuid: meeting.meetingUuid,
        id: meeting.meetingId,
        topic: meeting.topic,
        host_id: meeting.hostId,
        host_email: meeting.hostEmail,
        start_time: meeting.actualStartTime || meeting.startTime,
        end_time: meeting.actualEndTime || meeting.endTime || new Date(),
        duration: meeting.actualDuration || meeting.duration
      }
    };

    const calculationResult = await attendanceCalculator.processMeetingEnd(mockMeetingEndData);

    res.json({
      success: calculationResult.success,
      data: calculationResult,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('❌ Error manually calculating attendance:', error);
    res.status(500).json({
      success: false,
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

/**
 * GET /api/enhanced-attendance/dashboard-summary
 * Get summary data for the enhanced attendance dashboard
 */
router.get('/dashboard-summary', async (req, res) => {
  try {
    const { days = 30 } = req.query;
    const dateThreshold = new Date();
    dateThreshold.setDate(dateThreshold.getDate() - parseInt(days));

    console.log(`📊 Generating dashboard summary for last ${days} days`);

    // Get recent meeting statistics
    const recentMeetings = await ZoomMeeting.find({
      createdAt: { $gte: dateThreshold }
    }).sort({ createdAt: -1 });

    // Get attendance statistics
    const attendanceStats = await ZoomAttendance.aggregate([
      {
        $match: {
          createdAt: { $gte: dateThreshold },
          attendanceStatus: { $in: ['Present', 'Absent'] }
        }
      },
      {
        $group: {
          _id: '$attendanceStatus',
          count: { $sum: 1 }
        }
      }
    ]);

    // Get threshold compliance stats
    const thresholdStats = await ZoomAttendance.aggregate([
      {
        $match: {
          createdAt: { $gte: dateThreshold },
          attendancePercentage: { $exists: true }
        }
      },
      {
        $group: {
          _id: null,
          totalParticipants: { $sum: 1 },
          aboveThreshold: {
            $sum: {
              $cond: [{ $gte: ['$attendancePercentage', 85] }, 1, 0]
            }
          },
          belowThreshold: {
            $sum: {
              $cond: [{ $lt: ['$attendancePercentage', 85] }, 1, 0]
            }
          },
          averageAttendance: { $avg: '$attendancePercentage' }
        }
      }
    ]);

    // Get student matching stats
    const matchingStats = await ZoomAttendance.aggregate([
      {
        $match: {
          createdAt: { $gte: dateThreshold }
        }
      },
      {
        $group: {
          _id: null,
          totalRecords: { $sum: 1 },
          matchedStudents: {
            $sum: {
              $cond: ['$isMatched', 1, 0]
            }
          },
          unmatchedParticipants: {
            $sum: {
              $cond: ['$isMatched', 0, 1]
            }
          }
        }
      }
    ]);

    const presentCount = attendanceStats.find(s => s._id === 'Present')?.count || 0;
    const absentCount = attendanceStats.find(s => s._id === 'Absent')?.count || 0;
    const totalAttendance = presentCount + absentCount;

    const thresholdData = thresholdStats[0] || {
      totalParticipants: 0,
      aboveThreshold: 0,
      belowThreshold: 0,
      averageAttendance: 0
    };

    const matchingData = matchingStats[0] || {
      totalRecords: 0,
      matchedStudents: 0,
      unmatchedParticipants: 0
    };

    const summary = {
      period: {
        days: parseInt(days),
        startDate: dateThreshold,
        endDate: new Date()
      },
      meetings: {
        total: recentMeetings.length,
        completed: recentMeetings.filter(m => m.status === 'ended').length,
        withAttendance: recentMeetings.filter(m => m.attendanceCalculated).length
      },
      attendance: {
        totalRecords: totalAttendance,
        present: presentCount,
        absent: absentCount,
        attendanceRate: totalAttendance > 0 ? Math.round((presentCount / totalAttendance) * 100) : 0
      },
      threshold: {
        value: 85,
        totalEvaluated: thresholdData.totalParticipants,
        aboveThreshold: thresholdData.aboveThreshold,
        belowThreshold: thresholdData.belowThreshold,
        complianceRate: thresholdData.totalParticipants > 0 ? 
          Math.round((thresholdData.aboveThreshold / thresholdData.totalParticipants) * 100) : 0,
        averageAttendance: Math.round(thresholdData.averageAttendance || 0)
      },
      studentMatching: {
        totalRecords: matchingData.totalRecords,
        matched: matchingData.matchedStudents,
        unmatched: matchingData.unmatchedParticipants,
        matchingRate: matchingData.totalRecords > 0 ? 
          Math.round((matchingData.matchedStudents / matchingData.totalRecords) * 100) : 0
      },
      recentMeetings: recentMeetings.slice(0, 10).map(meeting => ({
        meetingId: meeting.meetingId,
        topic: meeting.topic,
        date: meeting.actualStartTime || meeting.startTime,
        duration: meeting.actualDuration || meeting.duration,
        status: meeting.status,
        attendanceCalculated: meeting.attendanceCalculated,
        attendanceSummary: meeting.attendanceSummary
      }))
    };

    res.json({
      success: true,
      data: summary,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('❌ Error generating dashboard summary:', error);
    res.status(500).json({
      success: false,
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

/**
 * GET /api/enhanced-attendance/user-sessions/:meetingId
 * Get detailed user session data for a meeting
 */
router.get('/user-sessions/:meetingId', async (req, res) => {
  try {
    const { meetingId } = req.params;

    console.log(`🔍 Fetching user session data for meeting: ${meetingId}`);

    const meeting = await ZoomMeeting.findOne({
      $or: [{ meetingId }, { meetingUuid: meetingId }]
    });

    if (!meeting) {
      return res.status(404).json({
        success: false,
        error: 'Meeting not found',
        timestamp: new Date().toISOString()
      });
    }

    // Get all participants with their session data
    const participants = await attendanceCalculator.getUniqueParticipants(meeting.meetingUuid);
    
    const sessionData = [];
    for (const participant of participants) {
      const attendanceData = await ZoomAttendance.calculateUserAttendanceTime(
        meeting.meetingUuid,
        participant.email,
        'email'
      );

      const { attendancePercentage, status } = ZoomAttendance.calculateAttendanceStatus(
        attendanceData.totalAttendanceTime,
        meeting.actualDuration || meeting.duration
      );

      sessionData.push({
        participant: participant,
        sessions: attendanceData.sessions,
        sessionCount: attendanceData.sessionCount,
        totalAttendanceTime: attendanceData.totalAttendanceTime,
        totalAttendanceMinutes: Math.round(attendanceData.totalAttendanceTime / 60),
        attendancePercentage: attendancePercentage,
        status: status,
        thresholdMet: attendancePercentage >= 85
      });
    }

    res.json({
      success: true,
      data: {
        meeting: {
          meetingId: meeting.meetingId,
          topic: meeting.topic,
          startTime: meeting.actualStartTime || meeting.startTime,
          endTime: meeting.actualEndTime || meeting.endTime,
          duration: meeting.actualDuration || meeting.duration
        },
        participants: sessionData,
        summary: {
          totalParticipants: sessionData.length,
          present: sessionData.filter(p => p.status === 'Present').length,
          absent: sessionData.filter(p => p.status === 'Absent').length,
          averageAttendance: sessionData.length > 0 ? 
            Math.round(sessionData.reduce((sum, p) => sum + p.attendancePercentage, 0) / sessionData.length) : 0,
          threshold: 85
        }
      },
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('❌ Error fetching user session data:', error);
    res.status(500).json({
      success: false,
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

module.exports = router;
