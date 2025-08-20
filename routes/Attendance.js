const express = require('express');
const AttendanceTracker = require('../services/attendanceTracker');
const Participant = require('../models/Participant');
const Attendance = require('../models/Attendance');
const Student = require('../models/Student');
const MeetingDiagnostics = require('../utils/meetingDiagnostics');
const { parseCoordinate, validateCoordinates, formatCoordinates, createLocationMetadata, validateLocationProximity } = require('../utils/locationUtils');
const { parseAndValidateQR, extractAttendanceMetadata } = require('../utils/qrCodeValidator');

const router = express.Router();

// Initialize attendance tracker and diagnostics
const attendanceTracker = new AttendanceTracker();
attendanceTracker.init();
const meetingDiagnostics = new MeetingDiagnostics();

/**
 * Start tracking attendance for a specific meeting
 * POST /api/attendance/start-tracking/:meetingId
 */
router.post('/start-tracking/:meetingId', async (req, res) => {
  try {
    const { meetingId } = req.params;
    
    console.log(`🎯 Starting attendance tracking for meeting: ${meetingId}`);
    
    const result = await attendanceTracker.startTrackingMeeting(meetingId);
    
    if (result) {
      res.json({
        success: true,
        message: `Successfully started tracking attendance for meeting ${meetingId}`,
        meetingId,
        trackingStatus: attendanceTracker.getTrackingStatus(),
        timestamp: new Date().toISOString()
      });
    } else {
      res.status(400).json({
        success: false,
        error: 'Failed to start tracking meeting. Please verify the meeting ID and try again.',
        meetingId,
        timestamp: new Date().toISOString()
      });
    }
    
  } catch (error) {
    console.error('❌ Error starting attendance tracking:', error);
    
    // Determine appropriate status code based on error type
    let statusCode = 500;
    let errorMessage = error.message;
    
    if (error.message.includes('Meeting not found') || error.message.includes('not started yet')) {
      statusCode = 404;
    } else if (error.message.includes('Not authorized') || error.message.includes('permissions')) {
      statusCode = 403;
    } else if (error.message.includes('Too many requests')) {
      statusCode = 429;
    } else if (error.message.includes('Unable to connect')) {
      statusCode = 503;
      errorMessage = 'Unable to connect to Zoom services. Please try again later.';
    }
    
    res.status(statusCode).json({
      success: false,
      error: errorMessage,
      meetingId: req.params.meetingId,
      timestamp: new Date().toISOString()
    });
  }
});

/**
 * Stop tracking attendance for a specific meeting
 * POST /api/attendance/stop-tracking/:meetingId
 */
router.post('/stop-tracking/:meetingId', async (req, res) => {
  try {
    const { meetingId } = req.params;
    const { generateReport = true } = req.body;
    
    console.log(`⏹️ Stopping attendance tracking for meeting: ${meetingId}`);
    
    let finalReport = null;
    
    if (generateReport) {
      finalReport = await attendanceTracker.generateFinalAttendanceReport(meetingId);
    }
    
    const stopped = attendanceTracker.stopTrackingMeeting(meetingId);
    
    res.json({
      success: true,
      message: `Stopped tracking attendance for meeting ${meetingId}`,
      meetingId,
      wasStopped: stopped,
      finalReport,
      trackingStatus: attendanceTracker.getTrackingStatus(),
      timestamp: new Date().toISOString()
    });
    
  } catch (error) {
    console.error('❌ Error stopping attendance tracking:', error);
    res.status(500).json({
      success: false,
      error: error.message,
      meetingId: req.params.meetingId,
      timestamp: new Date().toISOString()
    });
  }
});

/**
 * Get current attendance status for a meeting
 * GET /api/attendance/current/:meetingId
 */
router.get('/current/:meetingId', async (req, res) => {
  try {
    const { meetingId } = req.params;
    
    console.log(`📊 Getting current attendance for meeting: ${meetingId}`);
    
    const attendance = await attendanceTracker.getCurrentAttendance(meetingId);
    
    res.json(attendance);
    
  } catch (error) {
    console.error('❌ Error getting current attendance:', error);
    res.status(500).json({
      success: false,
      error: error.message,
      meetingId: req.params.meetingId,
      timestamp: new Date().toISOString()
    });
  }
});

/**
 * Get live participants from Zoom API
 * GET /api/attendance/live-participants/:meetingId
 */
router.get('/live-participants/:meetingId', async (req, res) => {
  try {
    const { meetingId } = req.params;
    
    console.log(`🔍 Getting live participants for meeting: ${meetingId}`);
    
    const participants = await attendanceTracker.getLiveParticipants(meetingId);
    const meetingDetails = await attendanceTracker.getMeetingDetails(meetingId);
    
    // Calculate current attendance status for each participant
    const participantsWithStatus = participants.map(participant => {
      const joinTime = new Date(participant.join_time);
      const leaveTime = participant.leave_time ? new Date(participant.leave_time) : null;
      const duration = leaveTime 
        ? Math.round((leaveTime - joinTime) / (1000 * 60))
        : Math.round((Date.now() - joinTime.getTime()) / (1000 * 60));
      
      const isActive = participant.status === 'in_meeting';
      const attendanceStatus = attendanceTracker.calculateAttendanceStatus(
        duration, 
        meetingDetails?.duration || 60, 
        isActive
      );
      
      return {
        ...participant,
        calculatedDuration: duration,
        attendanceStatus,
        isActive
      };
    });
    
    // Calculate statistics
    const stats = {
      total: participantsWithStatus.length,
      present: participantsWithStatus.filter(p => p.attendanceStatus === 'Present').length,
      inProgress: participantsWithStatus.filter(p => p.attendanceStatus === 'In Progress').length,
      late: participantsWithStatus.filter(p => p.attendanceStatus === 'Late').length,
      partial: participantsWithStatus.filter(p => p.attendanceStatus === 'Partial').length,
      absent: participantsWithStatus.filter(p => p.attendanceStatus === 'Absent').length,
      active: participantsWithStatus.filter(p => p.isActive).length
    };
    
    res.json({
      success: true,
      meetingId,
      meetingDetails,
      participants: participantsWithStatus,
      statistics: stats,
      timestamp: new Date().toISOString(),
      source: 'zoom_api_live'
    });
    
  } catch (error) {
    console.error('❌ Error getting live participants:', error);
    
    if (error.response?.status === 404) {
      return res.status(404).json({
        success: false,
        error: 'Meeting not found or has ended',
        meetingId: req.params.meetingId,
        timestamp: new Date().toISOString()
      });
    }
    
    res.status(500).json({
      success: false,
      error: error.message,
      meetingId: req.params.meetingId,
      timestamp: new Date().toISOString()
    });
  }
});

/**
 * Generate final attendance report for a meeting
 * POST /api/attendance/generate-report/:meetingId
 */
router.post('/generate-report/:meetingId', async (req, res) => {
  try {
    const { meetingId } = req.params;
    
    console.log(`📋 Generating final attendance report for meeting: ${meetingId}`);
    
    const report = await attendanceTracker.generateFinalAttendanceReport(meetingId);
    
    res.json(report);
    
  } catch (error) {
    console.error('❌ Error generating attendance report:', error);
    res.status(500).json({
      success: false,
      error: error.message,
      meetingId: req.params.meetingId,
      timestamp: new Date().toISOString()
    });
  }
});

/**
 * Get attendance summary for date range
 * GET /api/attendance/summary
 */
router.get('/summary', async (req, res) => {
  try {
    const { dateFrom, dateTo, studentId } = req.query;
    
    console.log(`📊 Getting attendance summary from ${dateFrom} to ${dateTo}`);
    
    const summary = await attendanceTracker.getAttendanceSummary(dateFrom, dateTo, studentId);
    
    res.json(summary);
    
  } catch (error) {
    console.error('❌ Error getting attendance summary:', error);
    res.status(500).json({
      success: false,
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

/**
 * Get tracking status for all meetings
 * GET /api/attendance/tracking-status
 */
router.get('/tracking-status', (req, res) => {
  try {
    const status = attendanceTracker.getTrackingStatus();
    
    res.json({
      success: true,
      ...status
    });
    
  } catch (error) {
    console.error('❌ Error getting tracking status:', error);
    res.status(500).json({
      success: false,
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

/**
 * Manually update attendance for a specific meeting
 * POST /api/attendance/manual-update/:meetingId
 */
router.post('/manual-update/:meetingId', async (req, res) => {
  try {
    const { meetingId } = req.params;
    
    console.log(`🔄 Manually updating attendance for meeting: ${meetingId}`);
    
    // Get current participants from Zoom
    const participants = await attendanceTracker.getLiveParticipants(meetingId);
    const meetingDetails = await attendanceTracker.getMeetingDetails(meetingId);
    
    // Update participant attendance
    const results = await attendanceTracker.updateParticipantAttendance(
      meetingId, 
      participants, 
      meetingDetails
    );
    
    res.json({
      success: true,
      meetingId,
      results,
      participantCount: participants.length,
      timestamp: new Date().toISOString()
    });
    
  } catch (error) {
    console.error('❌ Error manually updating attendance:', error);
    res.status(500).json({
      success: false,
      error: error.message,
      meetingId: req.params.meetingId,
      timestamp: new Date().toISOString()
    });
  }
});

/**
 * Get attendance history for a student
 * GET /api/attendance/student/:studentId
 */
router.get('/student/:studentId', async (req, res) => {
  try {
    const { studentId } = req.params;
    const { dateFrom, dateTo, status } = req.query;
    
    console.log(`👤 Getting attendance history for student: ${studentId}`);
    
    // Build query
    let query = { studentId };
    
    if (dateFrom || dateTo) {
      query.joinTime = {};
      if (dateFrom) query.joinTime.$gte = new Date(dateFrom);
      if (dateTo) query.joinTime.$lte = new Date(dateTo);
    }
    
    if (status) {
      query.attendanceStatus = status;
    }
    
    // Get participant records
    const participants = await Participant.find(query)
      .sort({ joinTime: -1 });
    
    // Calculate statistics
    const stats = {
      total: participants.length,
      present: participants.filter(p => p.attendanceStatus === 'Present').length,
      late: participants.filter(p => p.attendanceStatus === 'Late').length,
      partial: participants.filter(p => p.attendanceStatus === 'Partial').length,
      absent: participants.filter(p => p.attendanceStatus === 'Absent').length,
      inProgress: participants.filter(p => p.attendanceStatus === 'In Progress').length
    };
    
    stats.attendanceRate = stats.total > 0 ? 
      Math.round(((stats.present + stats.late) / stats.total) * 100) : 0;
    
    // Format response
    const attendanceHistory = participants.map(p => ({
      meetingId: p.meetingId,
      meetingTopic: p.meetingTopic,
      joinTime: p.joinTime,
      leaveTime: p.leaveTime,
      duration: p.duration,
      attendanceStatus: p.attendanceStatus,
      connectionStatus: p.connectionStatus,
      isActive: p.isActive,
      lastActivity: p.lastActivity
    }));
    
    res.json({
      success: true,
      studentId,
      studentInfo: participants.length > 0 ? {
        studentId: participants[0].studentId,
        firstName: participants[0].studentFirstName,
        lastName: participants[0].studentLastName,
        department: participants[0].studentDepartment,
        email: participants[0].studentEmail
      } : null,
      dateRange: { from: dateFrom, to: dateTo },
      attendanceHistory,
      statistics: stats,
      timestamp: new Date().toISOString()
    });
    
  } catch (error) {
    console.error('❌ Error getting student attendance history:', error);
    res.status(500).json({
      success: false,
      error: error.message,
      studentId: req.params.studentId,
      timestamp: new Date().toISOString()
    });
  }
});

/**
 * Get attendance statistics dashboard
 * GET /api/attendance/dashboard
 */
router.get('/dashboard', async (req, res) => {
  try {
    const { dateFrom, dateTo } = req.query;
    
    console.log('📊 Getting attendance dashboard data');
    
    // Build date filter
    let dateFilter = {};
    if (dateFrom || dateTo) {
      dateFilter.joinTime = {};
      if (dateFrom) dateFilter.joinTime.$gte = new Date(dateFrom);
      if (dateTo) dateFilter.joinTime.$lte = new Date(dateTo);
    }
    
    // Get all participants
    const participants = await Participant.find(dateFilter)
      .sort({ joinTime: -1 });
    
    // Group by meeting
    const meetingGroups = {};
    participants.forEach(participant => {
      if (!meetingGroups[participant.meetingId]) {
        meetingGroups[participant.meetingId] = {
          meetingId: participant.meetingId,
          meetingTopic: participant.meetingTopic,
          participants: [],
          date: participant.joinTime
        };
      }
      meetingGroups[participant.meetingId].participants.push(participant);
    });
    
    // Calculate meeting statistics
    const meetings = Object.values(meetingGroups).map(meeting => {
      const stats = {
        present: meeting.participants.filter(p => p.attendanceStatus === 'Present').length,
        late: meeting.participants.filter(p => p.attendanceStatus === 'Late').length,
        partial: meeting.participants.filter(p => p.attendanceStatus === 'Partial').length,
        absent: meeting.participants.filter(p => p.attendanceStatus === 'Absent').length,
        inProgress: meeting.participants.filter(p => p.attendanceStatus === 'In Progress').length,
        total: meeting.participants.length,
        students: meeting.participants.filter(p => p.studentId).length
      };
      
      return {
        ...meeting,
        statistics: stats,
        attendanceRate: stats.total > 0 ? Math.round((stats.present / stats.total) * 100) : 0
      };
    });
    
    // Overall statistics
    const overallStats = {
      totalMeetings: meetings.length,
      totalParticipants: participants.length,
      totalStudents: participants.filter(p => p.studentId).length,
      present: participants.filter(p => p.attendanceStatus === 'Present').length,
      late: participants.filter(p => p.attendanceStatus === 'Late').length,
      partial: participants.filter(p => p.attendanceStatus === 'Partial').length,
      absent: participants.filter(p => p.attendanceStatus === 'Absent').length,
      inProgress: participants.filter(p => p.attendanceStatus === 'In Progress').length
    };
    
    overallStats.attendanceRate = overallStats.totalParticipants > 0 ? 
      Math.round((overallStats.present / overallStats.totalParticipants) * 100) : 0;
    
    // Get tracking status
    const trackingStatus = attendanceTracker.getTrackingStatus();
    
    // Get QR scanner location statistics
    let qrLocationStats = null;
    try {
      // Build query for QR scanner data
      let qrQuery = {
        'qrScannerLocation.coordinates.latitude': { $exists: true },
        'qrScannerLocation.coordinates.longitude': { $exists: true }
      };
      
      if (dateFrom || dateTo) {
        qrQuery.Date = {};
        if (dateFrom) qrQuery.Date.$gte = new Date(dateFrom);
        if (dateTo) qrQuery.Date.$lte = new Date(dateTo);
      }
      
      // Get attendance records with QR scanner location data
      const qrAttendanceRecords = await Attendance.find(qrQuery)
        .sort({ Date: -1 });
      
      // Get student data separately for attendance records
      const qrStudentIds = [...new Set(qrAttendanceRecords.map(a => a.StudentID).filter(Boolean))];
      const qrStudentsMap = new Map();
      
      if (qrStudentIds.length > 0) {
        const qrStudents = await Student.find({
          StudentID: { $in: qrStudentIds }
        });
        qrStudents.forEach(student => {
          qrStudentsMap.set(student.StudentID, student);
        });
      }
      
      // Attach student data to attendance records
      qrAttendanceRecords.forEach(a => {
        if (a.StudentID && qrStudentsMap.has(a.StudentID)) {
          a.StudentData = qrStudentsMap.get(a.StudentID);
        }
      });
      
      if (qrAttendanceRecords.length > 0) {
        // Calculate QR scanner statistics
        const totalQrScans = qrAttendanceRecords.length;
        const uniqueQrStudents = [...new Set(qrAttendanceRecords.map(r => r.StudentID))].filter(Boolean).length;
        const distances = qrAttendanceRecords.map(r => r.qrScannerLocation?.distance).filter(Boolean);
        const averageDistance = distances.length > 0 
          ? Math.round((distances.reduce((sum, d) => sum + d, 0) / distances.length) * 100) / 100 
          : 0;
        
        // Verification status breakdown
        const verificationBreakdown = {
          verified: qrAttendanceRecords.filter(r => r.locationVerification?.status === 'verified').length,
          pending: qrAttendanceRecords.filter(r => r.locationVerification?.status === 'pending').length,
          failed: qrAttendanceRecords.filter(r => r.locationVerification?.status === 'failed').length,
          locationMismatch: qrAttendanceRecords.filter(r => r.locationVerification?.status === 'location_mismatch').length
        };
        
        // Recent QR scans (latest 5)
        const recentQrScans = qrAttendanceRecords.slice(0, 5).map(record => {
          const studentData = record.StudentData;
          return {
            studentId: record.StudentID,
            studentName: studentData ? 
              `${studentData.FirstName} ${studentData.LastName}` : 'Unknown',
            date: record.Date,
            coordinates: record.qrScannerLocation?.coordinates?.formatted || null,
            distance: record.qrScannerLocation?.distance || null,
            verificationStatus: record.locationVerification?.status || 'unknown'
          };
        });
        
        qrLocationStats = {
          totalScans: totalQrScans,
          uniqueStudents: uniqueQrStudents,
          averageDistance,
          maxDistance: Math.max(...distances, 0),
          minDistance: Math.min(...distances.filter(d => d > 0), 0) || 0,
          verificationBreakdown,
          recentScans: recentQrScans,
          referenceLocation: {
            coordinates: {
              latitude: '5.29836N',
              longitude: '2.00042W'
            },
            distance: 15.02,
            note: 'QR Scanner reference position'
          }
        };
      }
    } catch (qrError) {
      console.warn('⚠️ Error getting QR location stats:', qrError.message);
    }
    
    res.json({
      success: true,
      dateRange: { from: dateFrom, to: dateTo },
      meetings: meetings.slice(0, 20), // Latest 20 meetings
      overallStatistics: overallStats,
      trackingStatus,
      qrLocationStatistics: qrLocationStats,
      timestamp: new Date().toISOString()
    });
    
  } catch (error) {
    console.error('❌ Error getting dashboard data:', error);
    res.status(500).json({
      success: false,
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

/**
 * Get attendance trends for analytics dashboard
 * GET /api/attendance/trends
 */
router.get('/trends', async (req, res) => {
  try {
    const { dateFrom, dateTo, period = 'weekly' } = req.query;
    
    console.log('📈 Getting attendance trends data');
    
    // Build date filter for the last 30 days by default
    let dateFilter = {};
    const defaultEndDate = new Date();
    const defaultStartDate = new Date();
    defaultStartDate.setDate(defaultStartDate.getDate() - 30);
    
    dateFilter.joinTime = {
      $gte: dateFrom ? new Date(dateFrom) : defaultStartDate,
      $lte: dateTo ? new Date(dateTo) : defaultEndDate
    };
    
    // Get all participants within date range
    const participants = await Participant.find(dateFilter)
      .sort({ joinTime: -1 });
    
    // Get student details separately to avoid populate issues with Number reference
    const studentIds = participants.map(p => p.studentId).filter(Boolean);
    const studentsMap = new Map();
    
    if (studentIds.length > 0) {
      // Ensure all studentIds are valid numbers and not strings that might cause ObjectId issues
      const validStudentIds = studentIds.filter(id => typeof id === 'number' || !isNaN(Number(id)));
      
      if (validStudentIds.length > 0) {
        const students = await Student.find({
          StudentID: { $in: validStudentIds.map(id => Number(id)) }
        });
        students.forEach(student => {
          studentsMap.set(student.StudentID, student);
        });
      }
    }
    
    // Attach student data to participants
    participants.forEach(p => {
      if (p.studentId && studentsMap.has(p.studentId)) {
        p.studentData = studentsMap.get(p.studentId);
      }
    });
    
    // Get all attendance records for QR-based data
    const attendanceRecords = await Attendance.find({
      Date: {
        $gte: dateFrom ? new Date(dateFrom) : defaultStartDate,
        $lte: dateTo ? new Date(dateTo) : defaultEndDate
      }
    });
    
    // Get student data separately for attendance records
    const attendanceStudentIds = [...new Set(attendanceRecords.map(a => a.StudentID).filter(Boolean))];
    const attendanceStudentsMap = new Map();
    
    if (attendanceStudentIds.length > 0) {
      const attendanceStudents = await Student.find({
        StudentID: { $in: attendanceStudentIds }
      });
      attendanceStudents.forEach(student => {
        attendanceStudentsMap.set(student.StudentID, student);
      });
    }
    
    // Attach student data to attendance records
    attendanceRecords.forEach(a => {
      if (a.StudentID && attendanceStudentsMap.has(a.StudentID)) {
        a.StudentData = attendanceStudentsMap.get(a.StudentID);
      }
    });
    
    // Generate weekly trends (last 7 days)
    const weeklyTrends = [];
    const daysOfWeek = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    
    for (let i = 6; i >= 0; i--) {
      const date = new Date();
      date.setDate(date.getDate() - i);
      const dayName = daysOfWeek[date.getDay()];
      
      // Count participants for this day
      const dayParticipants = participants.filter(p => {
        const pDate = new Date(p.joinTime);
        return pDate.toDateString() === date.toDateString();
      });
      
      // Count QR attendance for this day
      const dayQrAttendance = attendanceRecords.filter(a => {
        const aDate = new Date(a.Date);
        return aDate.toDateString() === date.toDateString();
      });
      
      const totalForDay = dayParticipants.length + dayQrAttendance.length;
      const presentCount = dayParticipants.filter(p => p.attendanceStatus === 'Present').length + 
                          dayQrAttendance.filter(a => a.Status === 'Present').length;
      const lateCount = dayParticipants.filter(p => p.attendanceStatus === 'Late').length + 
                       dayQrAttendance.filter(a => a.Status === 'Late').length;
      const absentCount = totalForDay - presentCount - lateCount;
      
      weeklyTrends.push({
        day: dayName,
        date: date.toISOString().split('T')[0],
        present: presentCount,
        late: lateCount,
        absent: Math.max(0, absentCount),
        total: totalForDay
      });
    }
    
    // Calculate monthly statistics
    const totalParticipants = participants.length + attendanceRecords.length;
    const totalPresent = participants.filter(p => p.attendanceStatus === 'Present').length + 
                        attendanceRecords.filter(a => a.Status === 'Present').length;
    const totalLate = participants.filter(p => p.attendanceStatus === 'Late').length + 
                     attendanceRecords.filter(a => a.Status === 'Late').length;
    
    const monthlyStats = {
      totalDays: 30,
      averageAttendance: totalParticipants > 0 ? Math.round((totalPresent / totalParticipants) * 100) : 0,
      bestDay: weeklyTrends.length > 0 ? weeklyTrends.reduce((best, current) => 
        (current.present > best.present) ? current : best
      ).day : 'N/A',
      worstDay: weeklyTrends.length > 0 ? weeklyTrends.reduce((worst, current) => 
        (current.present < worst.present) ? current : worst
      ).day : 'N/A',
      trend: totalPresent > totalLate ? 'up' : 'down',
      change: totalParticipants > 0 ? Math.round(((totalPresent - totalLate) / totalParticipants) * 100) : 0
    };
    
    // Generate class-wise statistics (using departments as classes)
    const departmentStats = {};
    
    // From Zoom participants
    participants.forEach(p => {
      if (p.studentId && p.studentData && p.studentData.Department) {
        const dept = p.studentData.Department;
        if (!departmentStats[dept]) {
          departmentStats[dept] = { total: 0, present: 0, late: 0, absent: 0 };
        }
        departmentStats[dept].total++;
        if (p.attendanceStatus === 'Present') departmentStats[dept].present++;
        else if (p.attendanceStatus === 'Late') departmentStats[dept].late++;
        else departmentStats[dept].absent++;
      }
    });
    
    // From QR attendance
    attendanceRecords.forEach(a => {
      if (a.StudentID && a.StudentData && a.StudentData.Department) {
        const dept = a.StudentData.Department;
        if (!departmentStats[dept]) {
          departmentStats[dept] = { total: 0, present: 0, late: 0, absent: 0 };
        }
        departmentStats[dept].total++;
        if (a.Status === 'Present') departmentStats[dept].present++;
        else if (a.Status === 'Late') departmentStats[dept].late++;
        else departmentStats[dept].absent++;
      }
    });
    
    const classWiseStats = Object.entries(departmentStats).map(([className, stats]) => ({
      className,
      students: stats.total,
      attendance: stats.total > 0 ? Math.round((stats.present / stats.total) * 100) : 0,
      trend: stats.present > stats.late ? 'up' : (stats.present < stats.late ? 'down' : 'stable')
    }));
    
    const trendsData = {
      weeklyTrends,
      monthlyStats,
      classWiseStats: classWiseStats.slice(0, 10) // Top 10 departments
    };
    
    res.json({
      success: true,
      dateRange: { from: dateFrom, to: dateTo },
      period,
      trends: trendsData,
      dataPoints: {
        zoomParticipants: participants.length,
        qrAttendance: attendanceRecords.length,
        totalRecords: totalParticipants
      },
      timestamp: new Date().toISOString()
    });
    
  } catch (error) {
    console.error('❌ Error getting attendance trends:', error);
    res.status(500).json({
      success: false,
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

/**
 * Export attendance data to CSV
 * GET /api/attendance/export
 */
router.get('/export', async (req, res) => {
  try {
    const { dateFrom, dateTo, format = 'json', meetingId } = req.query;
    
    console.log('📤 Exporting attendance data');
    
    // Build query
    let query = {};
    
    if (meetingId) {
      query.meetingId = meetingId;
    }
    
    if (dateFrom || dateTo) {
      query.joinTime = {};
      if (dateFrom) query.joinTime.$gte = new Date(dateFrom);
      if (dateTo) query.joinTime.$lte = new Date(dateTo);
    }
    
    // Get participants
    const participants = await Participant.find(query)
      .sort({ joinTime: -1 });
    
    // Format data for export
    const exportData = participants.map(p => ({
      meetingId: p.meetingId,
      meetingTopic: p.meetingTopic,
      participantName: p.participantName,
      email: p.email,
      studentId: p.studentId || 'N/A',
      studentName: p.studentId ? `${p.studentFirstName} ${p.studentLastName}` : 'N/A',
      department: p.studentDepartment || 'N/A',
      joinTime: p.joinTime?.toISOString(),
      leaveTime: p.leaveTime?.toISOString(),
      duration: p.duration,
      attendanceStatus: p.attendanceStatus,
      connectionStatus: p.connectionStatus,
      isActive: p.isActive,
      userType: p.userType
    }));
    
    if (format === 'csv') {
      // Generate CSV
      const fields = [
        'meetingId', 'meetingTopic', 'participantName', 'email', 
        'studentId', 'studentName', 'department', 'joinTime', 
        'leaveTime', 'duration', 'attendanceStatus', 'connectionStatus'
      ];
      
      const csvHeader = fields.join(',') + '\n';
      const csvRows = exportData.map(row => 
        fields.map(field => `"${row[field] || ''}"`).join(',')
      ).join('\n');
      
      const csvContent = csvHeader + csvRows;
      
      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', `attachment; filename="attendance-${Date.now()}.csv"`);
      res.send(csvContent);
      
    } else {
      // Return JSON
      res.json({
        success: true,
        dateRange: { from: dateFrom, to: dateTo },
        meetingId,
        totalRecords: exportData.length,
        data: exportData,
        timestamp: new Date().toISOString()
      });
    }
    
  } catch (error) {
    console.error('❌ Error exporting attendance data:', error);
    res.status(500).json({
      success: false,
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

/**
 * Test Zoom API connectivity
 * GET /api/attendance/diagnostics/connectivity
 */
router.get('/diagnostics/connectivity', async (req, res) => {
  try {
    console.log('🔍 Running Zoom connectivity test...');
    
    const result = await meetingDiagnostics.testZoomConnectivity();
    
    res.json({
      success: true,
      test: 'zoom_connectivity',
      result,
      timestamp: new Date().toISOString()
    });
    
  } catch (error) {
    console.error('❌ Error running connectivity test:', error);
    res.status(500).json({
      success: false,
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

/**
 * Diagnose a specific meeting ID
 * POST /api/attendance/diagnostics/meeting/:meetingId
 */
router.post('/diagnostics/meeting/:meetingId', async (req, res) => {
  try {
    const { meetingId } = req.params;
    
    console.log(`🔍 Running diagnostic for meeting: ${meetingId}`);
    
    const result = await meetingDiagnostics.diagnoseMeetingId(meetingId);
    
    res.json({
      success: true,
      test: 'meeting_diagnosis',
      meetingId,
      result,
      timestamp: new Date().toISOString()
    });
    
  } catch (error) {
    console.error('❌ Error running meeting diagnosis:', error);
    res.status(500).json({
      success: false,
      error: error.message,
      meetingId: req.params.meetingId,
      timestamp: new Date().toISOString()
    });
  }
});

/**
 * Get diagnostic history
 * GET /api/attendance/diagnostics/history
 */
router.get('/diagnostics/history', (req, res) => {
  try {
    const { limit = 10 } = req.query;
    
    const history = meetingDiagnostics.getDiagnosticHistory(parseInt(limit));
    
    res.json({
      success: true,
      history,
      timestamp: new Date().toISOString()
    });
    
  } catch (error) {
    console.error('❌ Error getting diagnostic history:', error);
    res.status(500).json({
      success: false,
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

/**
 * Get diagnostic report
 * GET /api/attendance/diagnostics/report
 */
router.get('/diagnostics/report', (req, res) => {
  try {
    const report = meetingDiagnostics.generateDiagnosticReport();
    
    res.json({
      success: true,
      report,
      timestamp: new Date().toISOString()
    });
    
  } catch (error) {
    console.error('❌ Error generating diagnostic report:', error);
    res.status(500).json({
      success: false,
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

/**
 * Clear diagnostic history
 * DELETE /api/attendance/diagnostics/history
 */
router.delete('/diagnostics/history', (req, res) => {
  try {
    meetingDiagnostics.clearDiagnosticHistory();
    
    res.json({
      success: true,
      message: 'Diagnostic history cleared',
      timestamp: new Date().toISOString()
    });
    
  } catch (error) {
    console.error('❌ Error clearing diagnostic history:', error);
    res.status(500).json({
      success: false,
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

/**
 * Record QR scanner attendance with embedded user identity
 * POST /api/attendance/qr-location
 * 
 * This endpoint handles two scenarios:
 * 1. NEW: QR code with embedded user identity (from AdminQRGenerator)
 * 2. OLD: Direct coordinates and studentId (for backward compatibility)
 */
router.post('/qr-location', async (req, res) => {
  try {
    const { 
      coordinates, 
      distance, 
      studentId, 
      meetingId, 
      userLocation,
      qrCodeId,
      scannerLocation,
      scannedBy,
      scannedAt,
      attendanceType,
      // NEW: QR code data with embedded user identity
      qrCodeData,
      qrCodeString
    } = req.body;
    
    let finalStudentId, finalCoordinates, qrValidationResult, attendanceMetadata;
    
    // Handle QR code with embedded user identity (NEW FLOW)
    if (qrCodeData || qrCodeString) {
      console.log('📱 Processing QR code with embedded user identity');
      
      // Parse and validate QR code
      const qrString = qrCodeString || (typeof qrCodeData === 'string' ? qrCodeData : JSON.stringify(qrCodeData));
      qrValidationResult = parseAndValidateQR(qrString);
      
      if (!qrValidationResult.isValid) {
        return res.status(400).json({
          success: false,
          error: qrValidationResult.message,
          timestamp: new Date().toISOString()
        });
      }
      
      // QR code contains admin info who generated it
      const extractedData = qrValidationResult.extractedData;
      
      // For attendance, we use the scanning student's ID (from request body), not the QR generator's ID
      finalStudentId = studentId || req.body.scannedBy?.studentId;
      if (!finalStudentId) {
        return res.status(400).json({
          success: false,
          error: 'No scanning student ID provided. Please login as a student.',
          timestamp: new Date().toISOString()
        });
      }
      
      finalCoordinates = scannerLocation?.coordinates || userLocation;
      attendanceMetadata = extractAttendanceMetadata(qrValidationResult);
      
      // Override the student info in metadata to reflect the scanning student
      if (attendanceMetadata) {
        attendanceMetadata.studentId = finalStudentId;
        attendanceMetadata.studentName = req.body.scannedBy?.username || 'Unknown Student';
      }
      
      console.log(`📍 QR code validated - Student: ${finalStudentId}, Generated by: ${extractedData.generatedBy.username}`);
      
    } else {
      // Handle legacy format (OLD FLOW)
      console.log(`📍 Processing QR scanner attendance (legacy format) for student: ${studentId}`);
      finalStudentId = studentId || req.body.StudentID;
      finalCoordinates = coordinates || scannerLocation?.coordinates;
    }
    
    // Validate required fields
    if (!finalCoordinates || !finalStudentId) {
      return res.status(400).json({
        success: false,
        error: 'Missing required fields: coordinates/scannerLocation and studentId are required',
        timestamp: new Date().toISOString()
      });
    }
    
    // Parse and validate coordinates
    const latitude = typeof finalCoordinates.latitude === 'string' 
      ? parseCoordinate(finalCoordinates.latitude) 
      : finalCoordinates.latitude;
    const longitude = typeof finalCoordinates.longitude === 'string' 
      ? parseCoordinate(finalCoordinates.longitude) 
      : finalCoordinates.longitude;
    
    const coordinateValidation = validateCoordinates(latitude, longitude);
    if (!coordinateValidation.isValid) {
      return res.status(400).json({
        success: false,
        error: coordinateValidation.message,
        timestamp: new Date().toISOString()
      });
    }
    
    // Create formatted coordinates
    const formattedCoords = formatCoordinates(latitude, longitude);
    
    // Create location metadata
    const qrScannerData = {
      latitude,
      longitude,
      distance: distance || scannerLocation?.distance || null,
      timestamp: new Date().toISOString()
    };
    
    const locationMetadata = createLocationMetadata(qrScannerData, userLocation);
    
    // Create attendance record
    const attendanceData = {
      StudentID: parseInt(finalStudentId),
      Date: new Date(),
      Status: 'Present', // Default status when QR scanned
      attendanceType: qrValidationResult ? 'qr_scan' : 'hybrid', // QR + location verification
      qrScannerLocation: {
        coordinates: {
          latitude,
          longitude,
          formatted: formattedCoords
        },
        distance: distance || scannerLocation?.distance || null,
        accuracy: userLocation?.accuracy || null,
        timestamp: new Date()
      },
      locationVerification: {
        method: 'qr_scanner',
        status: locationMetadata.verification.status,
        proximity: locationMetadata.verification.proximity || null,
        verifiedAt: new Date(),
        notes: qrValidationResult 
          ? `QR scan from ${qrValidationResult.extractedData.generatedBy.username} at ${formattedCoords.latitude}, ${formattedCoords.longitude}`
          : `QR scanner at ${formattedCoords.latitude}, ${formattedCoords.longitude}`
      },
      metadata: {
        location: JSON.stringify(locationMetadata),
        // Include QR metadata if available
        ...(attendanceMetadata && {
          qrCode: JSON.stringify(attendanceMetadata),
          generatedBy: attendanceMetadata.generatedBy,
          qrCodeId: attendanceMetadata.qrCodeId
        })
      },
      verificationStatus: 'verified'
    };
    
    if (meetingId) {
      attendanceData.meetingId = meetingId;
    }
    
    // Try to find existing Student record to get additional info
    let studentInfo = null;
    try {
      const student = await Student.findOne({ StudentID: parseInt(finalStudentId) });
      if (student) {
        studentInfo = {
          studentId: student.StudentID,
          firstName: student.FirstName,
          lastName: student.LastName,
          email: student.Email,
          department: student.Department
        };
      } else if (qrValidationResult) {
        // Use info from QR code if student not found in DB
        studentInfo = {
          studentId: qrValidationResult.extractedData.studentInfo.studentId,
          firstName: qrValidationResult.extractedData.studentInfo.firstName,
          lastName: qrValidationResult.extractedData.studentInfo.lastName,
          email: qrValidationResult.extractedData.studentInfo.email,
          department: qrValidationResult.extractedData.studentInfo.department
        };
      }
    } catch (studentError) {
      console.warn('⚠️ Could not fetch student info:', studentError.message);
    }
    
    // Save attendance record
    const attendance = new Attendance(attendanceData);
    await attendance.save();
    
    console.log(`✅ Attendance recorded for student ${finalStudentId}${qrValidationResult ? ` via QR code ${qrValidationResult.extractedData.qrCodeId}` : ''}`);
    
    // Get Socket.IO instance for real-time notifications
    const io = req.app.get('io');
    const globalState = req.app.get('globalState');
    
    if (io && globalState) {
      // Create comprehensive attendance notification for admin dashboard
      const attendanceNotification = {
        id: `attendance_${attendance._id}`,
        type: 'attendance_recorded',
        icon: '✅',
        title: 'New Attendance Recorded',
        message: `${studentInfo?.firstName || 'Student'} ${studentInfo?.lastName || ''} marked present`,
        studentInfo: {
          studentId: finalStudentId,
          name: studentInfo ? `${studentInfo.firstName} ${studentInfo.lastName}` : 'Unknown Student',
          email: studentInfo?.email || null,
          department: studentInfo?.department || null
        },
        attendanceDetails: {
          attendanceId: attendance._id,
          date: attendance.Date.toLocaleDateString(),
          time: attendance.Date.toLocaleTimeString(),
          status: attendance.Status,
          method: qrValidationResult ? 'QR Code Scan' : 'Location-based',
          location: {
            coordinates: formattedCoords,
            distance: distance || scannerLocation?.distance || null,
            accuracy: userLocation?.accuracy || null
          },
          verification: locationMetadata.verification.status
        },
        qrCodeInfo: qrValidationResult ? {
          qrCodeId: qrValidationResult.extractedData.qrCodeId,
          generatedBy: qrValidationResult.extractedData.generatedBy.username,
          generatedAt: qrValidationResult.extractedData.generatedAt,
          location: qrValidationResult.extractedData.location
        } : null,
        timestamp: new Date().toISOString(),
        priority: 'high'
      };
      
      // Add to global notification state
      globalState.notifications = globalState.notifications || [];
      globalState.notifications.push(attendanceNotification);
      
      // Keep only last 100 notifications
      if (globalState.notifications.length > 100) {
        globalState.notifications = globalState.notifications.slice(-100);
      }
      
      // Emit to all connected admin clients
      io.emit('attendanceRecorded', attendanceNotification);
      
      // Also emit as a general notification
      io.emit('notification', attendanceNotification);
      
      // Emit to admin dashboard specifically
      io.to('admin_dashboard').emit('realTimeAttendanceUpdate', {
        type: 'new_attendance',
        data: {
          attendance: {
            _id: attendance._id,
            studentId: finalStudentId,
            studentName: studentInfo ? `${studentInfo.firstName} ${studentInfo.lastName}` : 'Unknown Student',
            date: attendance.Date,
            status: attendance.Status,
            location: formattedCoords,
            method: qrValidationResult ? 'QR Scan' : 'Location',
            verification: locationMetadata.verification.status
          },
          studentInfo,
          qrCodeInfo: qrValidationResult ? {
            generatedBy: qrValidationResult.extractedData.generatedBy.username,
            qrId: qrValidationResult.extractedData.qrCodeId
          } : null
        },
        timestamp: new Date().toISOString()
      });
      
      console.log(`📡 Real-time notification sent to admin dashboard for student ${finalStudentId}`);
    }
    
    res.json({
      success: true,
      message: qrValidationResult 
        ? 'Attendance recorded successfully via QR code scan'
        : 'QR scanner location recorded successfully',
      attendanceId: attendance._id,
      studentId: finalStudentId,
      studentInfo,
      location: {
        coordinates: formattedCoords,
        distance: distance || scannerLocation?.distance || null,
        verification: locationMetadata.verification
      },
      qrCodeInfo: qrValidationResult ? {
        qrCodeId: qrValidationResult.extractedData.qrCodeId,
        generatedBy: qrValidationResult.extractedData.generatedBy.username,
        generatedAt: qrValidationResult.extractedData.generatedAt,
        location: qrValidationResult.extractedData.location
      } : null,
      timestamp: new Date().toISOString()
    });
    
  } catch (error) {
    console.error('❌ Error recording QR scanner attendance:', error);
    res.status(500).json({
      success: false,
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

/**
 * Get QR scanner location info for dashboard
 * GET /api/attendance/qr-location/info
 */
router.get('/qr-location/info', async (req, res) => {
  try {
    const { studentId, dateFrom, dateTo } = req.query;
    
    console.log('📍 Getting QR scanner location information');
    
    // Build query for attendance records with QR scanner data
    let query = {
      'qrScannerLocation.coordinates.latitude': { $exists: true },
      'qrScannerLocation.coordinates.longitude': { $exists: true }
    };
    
    if (studentId) {
      query.StudentID = parseInt(studentId);
    }
    
    if (dateFrom || dateTo) {
      query.Date = {};
      if (dateFrom) query.Date.$gte = new Date(dateFrom);
      if (dateTo) query.Date.$lte = new Date(dateTo);
    }
    
    // Get attendance records with location data
    const attendanceRecords = await Attendance.find(query)
      .sort({ Date: -1 })
      .limit(100); // Limit to latest 100 records
    
    // Get student data separately for location records
    const locationStudentIds = [...new Set(attendanceRecords.map(a => a.StudentID).filter(Boolean))];
    const locationStudentsMap = new Map();
    
    if (locationStudentIds.length > 0) {
      const locationStudents = await Student.find({
        StudentID: { $in: locationStudentIds }
      });
      locationStudents.forEach(student => {
        locationStudentsMap.set(student.StudentID, student);
      });
    }
    
    // Attach student data to attendance records
    attendanceRecords.forEach(a => {
      if (a.StudentID && locationStudentsMap.has(a.StudentID)) {
        a.StudentData = locationStudentsMap.get(a.StudentID);
      }
    });
    
    // Process location data
    const locationData = attendanceRecords.map(record => {
      const studentData = record.StudentData;
      return {
        attendanceId: record._id,
        studentId: record.StudentID,
        studentName: studentData ? 
          `${studentData.FirstName} ${studentData.LastName}` : 'Unknown',
        date: record.Date,
        coordinates: record.qrScannerLocation?.coordinates || null,
        distance: record.qrScannerLocation?.distance || null,
        verification: record.locationVerification || null,
        status: record.Status,
        meetingId: record.meetingId || null
      };
    });
    
    // Calculate statistics
    const stats = {
      totalScans: locationData.length,
      uniqueStudents: [...new Set(locationData.map(l => l.studentId))].length,
      averageDistance: locationData.length > 0 ? 
        Math.round((locationData.reduce((sum, l) => sum + (l.distance || 0), 0) / locationData.length) * 100) / 100 : 0,
      verificationStatus: {
        verified: locationData.filter(l => l.verification?.status === 'verified').length,
        pending: locationData.filter(l => l.verification?.status === 'pending').length,
        failed: locationData.filter(l => l.verification?.status === 'failed').length,
        locationMismatch: locationData.filter(l => l.verification?.status === 'location_mismatch').length
      }
    };
    
    // QR scanner reference coordinates (user's actual GPS location)
    const qrScannerReference = {
      coordinates: {
        latitude: 5.636096,
        longitude: -0.196608,
        formatted: {
          latitude: '5.636096N',
          longitude: '0.196608W'
        }
      },
      radius: 5, // 5 meter geofence radius - Very precise location control
      note: 'Authorized Attendance Area - Geofence Center (High Precision)'
    };
    
    res.json({
      success: true,
      dateRange: { from: dateFrom, to: dateTo },
      qrScannerReference,
      locationData: locationData.slice(0, 20), // Latest 20 records
      statistics: stats,
      timestamp: new Date().toISOString()
    });
    
  } catch (error) {
    console.error('❌ Error getting QR scanner location info:', error);
    res.status(500).json({
      success: false,
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

/**
 * Validate user location against QR scanner position
 * POST /api/attendance/validate-location
 */
router.post('/validate-location', async (req, res) => {
  try {
    const { userLocation, qrScannerLocation, maxDistance = 50 } = req.body;
    
    console.log('🔍 Validating user location against QR scanner position');
    
    // Validate input
    if (!userLocation || !qrScannerLocation) {
      return res.status(400).json({
        success: false,
        error: 'Both userLocation and qrScannerLocation are required',
        timestamp: new Date().toISOString()
      });
    }
    
    // Parse coordinates if they are strings
    const qrLat = typeof qrScannerLocation.latitude === 'string' 
      ? parseCoordinate(qrScannerLocation.latitude) 
      : qrScannerLocation.latitude;
    const qrLng = typeof qrScannerLocation.longitude === 'string' 
      ? parseCoordinate(qrScannerLocation.longitude) 
      : qrScannerLocation.longitude;
    
    // Validate proximity
    const proximityResult = validateLocationProximity(
      { lat: qrLat, lng: qrLng },
      { lat: userLocation.lat, lng: userLocation.lng },
      maxDistance
    );
    
    // Format coordinates for response
    const formattedQrCoords = formatCoordinates(qrLat, qrLng);
    const formattedUserCoords = formatCoordinates(userLocation.lat, userLocation.lng);
    
    res.json({
      success: true,
      validation: {
        isValid: proximityResult.isWithinRange,
        distance: proximityResult.distance,
        maxDistance: proximityResult.maxDistance,
        message: proximityResult.message
      },
      locations: {
        qrScanner: {
          coordinates: formattedQrCoords,
          raw: { lat: qrLat, lng: qrLng }
        },
        user: {
          coordinates: formattedUserCoords,
          raw: { lat: userLocation.lat, lng: userLocation.lng },
          accuracy: userLocation.accuracy || null
        }
      },
      timestamp: new Date().toISOString()
    });
    
  } catch (error) {
    console.error('❌ Error validating location:', error);
    res.status(500).json({
      success: false,
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

module.exports = router;
