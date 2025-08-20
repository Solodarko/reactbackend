const express = require('express');
const moment = require('moment');
const Participant = require('../models/Participant');
const Student = require('../models/Student');
const ZoomMeeting = require('../models/ZoomMeeting');
const Attendance = require('../models/Attendance');
const ZoomAttendance = require('../models/ZoomAttendance');

const router = express.Router();

/**
 * GET /api/attendance-reports/meeting/:meetingId
 * Generate comprehensive attendance report for a specific meeting
 */
router.get('/meeting/:meetingId', async (req, res) => {
  try {
    const { meetingId } = req.params;
    const { format = 'json', includeDetails = 'true', source = 'webhook' } = req.query;

    // Get meeting details
    const meeting = await ZoomMeeting.findOne({
      $or: [{ meetingId }, { meetingUuid: meetingId }]
    });
    if (!meeting) {
      return res.status(404).json({ error: 'Meeting not found' });
    }

    let participants = [];
    let attendanceData = [];

    // Use webhook-based attendance data by default (more accurate)
    if (source === 'webhook' || source === 'both') {
      // Get webhook-based attendance data
      const webhookAttendance = await ZoomAttendance.find({
        $or: [
          { meetingId: meetingId },
          { meetingUuid: meeting.meetingUuid }
        ]
      })
      .populate('studentId', 'FirstName LastName Email StudentID Department')
      .sort({ joinTime: 1 });

      participants = webhookAttendance;
    }
    
    // Fallback to legacy participant data if no webhook data found
    if ((source === 'legacy' || participants.length === 0) && source !== 'webhook') {
      const legacyParticipants = await Participant.find({ meetingId })
        .populate('studentId', 'FirstName LastName Email StudentID Department')
        .sort({ joinTime: 1 });
      
      if (source === 'both') {
        participants = [...participants, ...legacyParticipants];
      } else {
        participants = legacyParticipants;
      }
    }

    // Calculate meeting statistics
    const meetingStartTime = meeting.startTime || new Date();
    const meetingEndTime = meeting.endTime || new Date();
    const totalMeetingDuration = Math.round((meetingEndTime - meetingStartTime) / (1000 * 60)); // minutes

    // Process attendance data
    attendanceData = participants.map(participant => {
      // Handle both webhook-based (ZoomAttendance) and legacy (Participant) data
      const isWebhookData = participant.constructor.modelName === 'ZoomAttendance';
      
      const joinTime = participant.joinTime;
      const leaveTime = participant.leaveTime || new Date();
      const duration = isWebhookData ? 
        (participant.duration ? Math.round(participant.duration / 60) : Math.round((leaveTime - joinTime) / (1000 * 60))) :
        Math.round((leaveTime - joinTime) / (1000 * 60));
        
      const attendancePercentage = isWebhookData && participant.attendancePercentage ? 
        participant.attendancePercentage :
        (totalMeetingDuration > 0 ? Math.round((duration / totalMeetingDuration) * 100) : 0);

      // Use webhook status if available, otherwise calculate
      let status = 'Absent';
      if (isWebhookData && participant.attendanceStatus) {
        status = participant.attendanceStatus;
      } else {
        if (attendancePercentage >= 75) {
          status = 'Present';
        } else if (attendancePercentage >= 30) {
          status = 'Late/Partial';
        } else if (attendancePercentage > 0) {
          status = 'Brief Attendance';
        }
      }

      // Handle student info for both data types
      let studentInfo = null;
      if (isWebhookData) {
        if (participant.studentId && participant.populate && participant.studentId.FirstName) {
          // Populated student data
          studentInfo = {
            studentId: participant.studentId.StudentID,
            name: `${participant.studentId.FirstName} ${participant.studentId.LastName}`,
            department: participant.studentId.Department,
            email: participant.studentId.Email
          };
        } else if (participant.studentId) {
          // Just student ID available
          studentInfo = {
            studentId: participant.studentId,
            name: participant.participantName,
            department: 'Unknown',
            email: participant.participantEmail
          };
        }
      } else {
        // Legacy participant data
        if (participant.studentId) {
          studentInfo = {
            studentId: participant.studentId.StudentID || participant.studentId,
            name: participant.studentId.FirstName ? 
              `${participant.studentId.FirstName} ${participant.studentId.LastName}` : 
              participant.participantName,
            department: participant.studentId.Department || 'Unknown',
            email: participant.studentId.Email || participant.email
          };
        }
      }

      return {
        participantId: participant.participantId,
        participantUuid: isWebhookData ? participant.participantUuid : null,
        participantName: participant.participantName,
        email: isWebhookData ? participant.participantEmail : participant.email,
        studentInfo: studentInfo,
        joinTime: joinTime,
        leaveTime: participant.leaveTime,
        duration: duration,
        attendancePercentage: attendancePercentage,
        status: status,
        isActive: participant.isActive,
        connectionStatus: participant.connectionStatus,
        sessions: participant.sessions || [],
        deviceInfo: participant.device || participant.metadata?.deviceType,
        userType: participant.userType,
        source: isWebhookData ? participant.source : 'legacy',
        isReconciled: isWebhookData ? participant.isReconciled : false,
        isMatched: participant.isMatched || false
      };
    });

    // Generate summary statistics
    const summary = {
      meetingInfo: {
        meetingId: meeting.meetingId,
        topic: meeting.topic,
        startTime: meetingStartTime,
        endTime: meetingEndTime,
        duration: totalMeetingDuration,
        hostEmail: meeting.hostEmail
      },
      attendance: {
        totalParticipants: participants.length,
        totalStudents: attendanceData.filter(p => p.studentInfo).length,
        present: attendanceData.filter(p => p.status === 'Present').length,
        late: attendanceData.filter(p => p.status === 'Late/Partial').length,
        brief: attendanceData.filter(p => p.status === 'Brief Attendance').length,
        absent: attendanceData.filter(p => p.status === 'Absent').length,
        averageAttendance: attendanceData.length > 0 ? 
          Math.round(attendanceData.reduce((sum, p) => sum + p.attendancePercentage, 0) / attendanceData.length) : 0
      },
      participation: {
        averageDuration: attendanceData.length > 0 ? 
          Math.round(attendanceData.reduce((sum, p) => sum + p.duration, 0) / attendanceData.length) : 0,
        peakParticipants: Math.max(participants.filter(p => p.isActive).length, 0),
        uniqueParticipants: new Set(participants.map(p => p.email || p.participantName)).size
      }
    };

    const report = {
      reportGenerated: new Date(),
      summary,
      participants: includeDetails === 'true' ? attendanceData : null,
      exportOptions: {
        csv: `/api/attendance-reports/meeting/${meetingId}?format=csv`,
        excel: `/api/attendance-reports/meeting/${meetingId}?format=excel`,
        pdf: `/api/attendance-reports/meeting/${meetingId}?format=pdf`
      }
    };

    // Handle different export formats
    if (format === 'csv') {
      return exportToCSV(res, attendanceData, meeting);
    } else if (format === 'excel') {
      return exportToExcel(res, attendanceData, meeting);
    }

    res.json(report);

  } catch (error) {
    console.error('Error generating attendance report:', error);
    res.status(500).json({ error: 'Failed to generate attendance report' });
  }
});

/**
 * GET /api/attendance-reports/student/:studentId
 * Get attendance history for a specific student
 */
router.get('/student/:studentId', async (req, res) => {
  try {
    const { studentId } = req.params;
    const { startDate, endDate, limit = 50 } = req.query;

    // Build date filter
    let dateFilter = {};
    if (startDate || endDate) {
      dateFilter.joinTime = {};
      if (startDate) dateFilter.joinTime.$gte = new Date(startDate);
      if (endDate) dateFilter.joinTime.$lte = new Date(endDate);
    }

    // Get student info
    const student = await Student.findOne({ StudentID: studentId });
    if (!student) {
      return res.status(404).json({ error: 'Student not found' });
    }

    // Get participation history
    const participations = await Participant.find({
      studentId: studentId,
      ...dateFilter
    })
      .populate('meetingId', 'topic startTime duration')
      .sort({ joinTime: -1 })
      .limit(parseInt(limit));

    // Process attendance history
    const attendanceHistory = participations.map(p => {
      const duration = p.duration || 0;
      const meetingDuration = p.meetingId?.duration || 60;
      const attendancePercentage = Math.round((duration / meetingDuration) * 100);

      return {
        meetingId: p.meetingId,
        meetingTopic: p.meetingTopic,
        joinTime: p.joinTime,
        leaveTime: p.leaveTime,
        duration: duration,
        attendancePercentage: attendancePercentage,
        status: p.attendanceStatus,
        connectionStatus: p.connectionStatus
      };
    });

    // Generate student summary
    const summary = {
      student: {
        studentId: student.StudentID,
        name: `${student.FirstName} ${student.LastName}`,
        email: student.Email,
        department: student.Department
      },
      statistics: {
        totalMeetings: participations.length,
        averageAttendance: attendanceHistory.length > 0 ? 
          Math.round(attendanceHistory.reduce((sum, p) => sum + p.attendancePercentage, 0) / attendanceHistory.length) : 0,
        totalHours: Math.round(attendanceHistory.reduce((sum, p) => sum + p.duration, 0) / 60 * 10) / 10,
        perfectAttendance: attendanceHistory.filter(p => p.attendancePercentage >= 90).length,
        missedMeetings: attendanceHistory.filter(p => p.attendancePercentage < 30).length
      }
    };

    res.json({
      reportGenerated: new Date(),
      summary,
      attendanceHistory: attendanceHistory.slice(0, limit)
    });

  } catch (error) {
    console.error('Error generating student attendance report:', error);
    res.status(500).json({ error: 'Failed to generate student report' });
  }
});

/**
 * GET /api/attendance-reports/dashboard
 * Get live attendance dashboard data
 */
router.get('/dashboard', async (req, res) => {
  try {
    const { timeframe = '24h' } = req.query;

    // Calculate date range
    let startDate = new Date();
    switch (timeframe) {
      case '1h':
        startDate.setHours(startDate.getHours() - 1);
        break;
      case '24h':
        startDate.setDate(startDate.getDate() - 1);
        break;
      case '7d':
        startDate.setDate(startDate.getDate() - 7);
        break;
      case '30d':
        startDate.setDate(startDate.getDate() - 30);
        break;
    }

    // Get active meetings
    const activeMeetings = await ZoomMeeting.find({
      status: { $in: ['started', 'waiting'] },
      startTime: { $gte: startDate }
    });

    // Get recent participants
    const recentParticipants = await Participant.find({
      joinTime: { $gte: startDate }
    })
      .populate('studentId', 'FirstName LastName Department')
      .sort({ joinTime: -1 })
      .limit(100);

    // Calculate real-time statistics
    const activeParticipants = recentParticipants.filter(p => p.isActive);
    const totalParticipants = recentParticipants.length;
    const studentParticipants = recentParticipants.filter(p => p.studentId).length;

    // Meeting activity over time (hourly breakdown)
    const activityByHour = {};
    recentParticipants.forEach(p => {
      const hour = moment(p.joinTime).format('YYYY-MM-DD HH:00');
      if (!activityByHour[hour]) {
        activityByHour[hour] = { joins: 0, uniqueParticipants: new Set() };
      }
      activityByHour[hour].joins++;
      activityByHour[hour].uniqueParticipants.add(p.email || p.participantName);
    });

    const dashboard = {
      timestamp: new Date(),
      timeframe,
      liveStats: {
        activeMeetings: activeMeetings.length,
        activeParticipants: activeParticipants.length,
        totalParticipants,
        studentParticipants,
        averageSessionDuration: totalParticipants > 0 ? 
          Math.round(recentParticipants.reduce((sum, p) => sum + (p.duration || 0), 0) / totalParticipants) : 0
      },
      activeMeetings: activeMeetings.map(meeting => ({
        meetingId: meeting.meetingId,
        topic: meeting.topic,
        startTime: meeting.startTime,
        participantCount: recentParticipants.filter(p => p.meetingId === meeting.meetingId && p.isActive).length,
        status: meeting.status
      })),
      recentActivity: Object.keys(activityByHour)
        .sort()
        .slice(-24) // Last 24 hours
        .map(hour => ({
          timestamp: hour,
          joins: activityByHour[hour].joins,
          uniqueParticipants: activityByHour[hour].uniqueParticipants.size
        })),
      topParticipants: recentParticipants
        .filter(p => p.studentId)
        .slice(0, 10)
        .map(p => ({
          name: p.participantName,
          department: p.studentId?.Department,
          duration: p.duration,
          joinTime: p.joinTime,
          status: p.attendanceStatus
        }))
    };

    res.json(dashboard);

  } catch (error) {
    console.error('Error generating dashboard data:', error);
    res.status(500).json({ error: 'Failed to generate dashboard data' });
  }
});

/**
 * Helper function to export to CSV
 */
function exportToCSV(res, data, meeting) {
  const csvHeader = 'Student ID,Name,Email,Department,Join Time,Leave Time,Duration (min),Attendance %,Status\n';
  const csvRows = data.map(p => {
    const student = p.studentInfo;
    return [
      student?.studentId || 'N/A',
      student?.name || p.participantName,
      p.email || 'N/A',
      student?.department || 'N/A',
      moment(p.joinTime).format('YYYY-MM-DD HH:mm:ss'),
      p.leaveTime ? moment(p.leaveTime).format('YYYY-MM-DD HH:mm:ss') : 'Still in meeting',
      p.duration,
      p.attendancePercentage,
      p.status
    ].join(',');
  }).join('\n');

  const csv = csvHeader + csvRows;
  
  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', `attachment; filename="attendance-${meeting.meetingId}-${moment().format('YYYY-MM-DD')}.csv"`);
  res.send(csv);
}

/**
 * Helper function to export to Excel (simplified - you can enhance with actual Excel library)
 */
function exportToExcel(res, data, meeting) {
  // This would use a library like 'xlsx' or 'exceljs' in a real implementation
  res.status(501).json({ 
    error: 'Excel export not implemented yet',
    suggestion: 'Use CSV export for now, or implement with xlsx library'
  });
}

module.exports = router;
