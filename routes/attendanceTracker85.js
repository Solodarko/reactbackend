const express = require('express');
const mongoose = require('mongoose');
const Participant = require('../models/Participant');
const Student = require('../models/Student');
const ZoomMeeting = require('../models/ZoomMeeting');
const ZoomAttendance = require('../models/ZoomAttendance');
// Use global userSessionManager instance
// const userSessionManager = require('../services/userSessionManager');

const router = express.Router();

// WebSocket functionality for real-time attendance tracking
class AttendanceTracker85WebSocket {
  constructor() {
    this.activeTrackers = new Map(); // meetingId -> tracking interval
    this.subscribedClients = new Map(); // meetingId -> Set of socket IDs
    this.participantJoinCallbacks = new Set(); // callbacks to run when participants join
  }

  // Start real-time tracking for a meeting
  startTracking(io, meetingId, intervalMs = 10000) {
    if (this.activeTrackers.has(meetingId)) {
      console.log(`📊 Already tracking meeting ${meetingId}`);
      return;
    }

    console.log(`🔄 Starting 85% attendance tracker for meeting ${meetingId}`);
    
    const trackingInterval = setInterval(async () => {
      try {
        const attendanceData = await this.getAttendanceData(meetingId);
        
        // Emit to all clients subscribed to this meeting
        io.to(`attendance_tracker_${meetingId}`).emit('attendance85Update', {
          meetingId,
          data: attendanceData,
          timestamp: new Date().toISOString()
        });
        
        // Also emit statistics update
        if (attendanceData.success) {
          io.to(`attendance_tracker_${meetingId}`).emit('attendance85Statistics', {
            meetingId,
            statistics: attendanceData.statistics,
            timestamp: new Date().toISOString()
          });
          
          // Emit table data for frontend components
          const tableData = attendanceData.participants.map(participant => ({
            id: participant.participantId,
            name: participant.participantName,
            email: participant.email,
            duration: participant.duration,
            percentage: participant.percentage,
            status: participant.status,
            joinTime: participant.joinTime,
            leaveTime: participant.leaveTime,
            isActive: participant.isActive,
            studentInfo: participant.studentInfo,
            authenticatedUser: participant.authenticatedUser
          }));
          
          io.to(`attendance_tracker_${meetingId}`).emit('attendance85TableUpdate', {
            meetingId,
            tableData,
            statistics: attendanceData.statistics,
            timestamp: new Date().toISOString()
          });
        }
        
      } catch (error) {
        console.error(`❌ Error in 85% attendance tracking for meeting ${meetingId}:`, error);
        
        // Emit error to clients
        io.to(`attendance_tracker_${meetingId}`).emit('attendance85Error', {
          meetingId,
          error: error.message,
          timestamp: new Date().toISOString()
        });
      }
    }, intervalMs);
    
    this.activeTrackers.set(meetingId, trackingInterval);
    console.log(`✅ 85% attendance tracker started for meeting ${meetingId}`);
  }

  // Stop tracking for a meeting
  stopTracking(meetingId) {
    const trackingInterval = this.activeTrackers.get(meetingId);
    if (trackingInterval) {
      clearInterval(trackingInterval);
      this.activeTrackers.delete(meetingId);
      console.log(`🛑 Stopped 85% attendance tracking for meeting ${meetingId}`);
    }
  }

  // Subscribe a client to meeting updates
  subscribeClient(socket, meetingId) {
    socket.join(`attendance_tracker_${meetingId}`);
    
    if (!this.subscribedClients.has(meetingId)) {
      this.subscribedClients.set(meetingId, new Set());
    }
    this.subscribedClients.get(meetingId).add(socket.id);
    
    console.log(`👥 Client ${socket.id} subscribed to 85% attendance tracker for meeting ${meetingId}`);
  }

  // Unsubscribe a client from meeting updates
  unsubscribeClient(socket, meetingId) {
    socket.leave(`attendance_tracker_${meetingId}`);
    
    const clients = this.subscribedClients.get(meetingId);
    if (clients) {
      clients.delete(socket.id);
      if (clients.size === 0) {
        this.subscribedClients.delete(meetingId);
        // Stop tracking if no clients are subscribed
        this.stopTracking(meetingId);
      }
    }
    
    console.log(`👋 Client ${socket.id} unsubscribed from 85% attendance tracker for meeting ${meetingId}`);
  }

  // Get current attendance data (same logic as the REST endpoint)
  async getAttendanceData(meetingId, options = {}) {
    const attendanceThreshold = options.threshold || 85;
    const includeInactiveParticipants = options.includeInactive || false;
    
    try {
      // Same logic as the REST endpoint
      const meeting = await ZoomMeeting.findOne({ 
        $or: [
          { meetingId: meetingId },
          { id: meetingId },
          { 'meetingId': String(meetingId) }
        ]
      });
      
      let meetingDuration = 0;
      let meetingStartTime = null;
      let meetingEndTime = null;
      let meetingStatus = 'scheduled';
      
      if (meeting) {
        meetingStartTime = meeting.startTime || meeting.start_time;
        meetingEndTime = meeting.endTime || meeting.end_time;
        meetingStatus = meeting.status || 'scheduled';
        
        if (meetingStartTime && meetingEndTime) {
          meetingDuration = Math.round((new Date(meetingEndTime) - new Date(meetingStartTime)) / (1000 * 60));
        } else if (meetingStartTime && (meetingStatus === 'started' || meetingStatus === 'in_progress')) {
          meetingDuration = Math.round((Date.now() - new Date(meetingStartTime).getTime()) / (1000 * 60));
        } else {
          meetingDuration = meeting.duration || 60;
        }
      } else {
        meetingDuration = 60;
      }
      
      let participantQuery = { meetingId: String(meetingId) };
      if (!includeInactiveParticipants) {
        participantQuery.joinTime = { $exists: true, $ne: null };
      }
      
      const participants = await Participant.find(participantQuery)
        .populate('userId', 'username email role')
        .sort({ joinTime: 1 });
      
      const authenticatedSessions = global.userSessionManager ? 
        global.userSessionManager.getActiveMeetingSessions(meetingId) : [];
      
      const attendanceData = await Promise.all(participants.map(async (participant) => {
        // [Same participant processing logic as in the REST endpoint]
        let participantDuration = 0;
        let currentJoinTime = null;
        let currentLeaveTime = null;
        let isCurrentlyInMeeting = false;
        
        if (participant.joinTime) {
          currentJoinTime = participant.joinTime;
          currentLeaveTime = participant.leaveTime;
          isCurrentlyInMeeting = participant.isActive && !participant.leaveTime;
          
          if (participant.leaveTime) {
            participantDuration = Math.round((participant.leaveTime - participant.joinTime) / (1000 * 60));
          } else if (participant.isActive) {
            participantDuration = Math.round((Date.now() - participant.joinTime.getTime()) / (1000 * 60));
          } else {
            participantDuration = participant.duration || 0;
          }
        }
        
        let attendancePercentage = 0;
        if (meetingDuration > 0) {
          attendancePercentage = Math.min(Math.round((participantDuration / meetingDuration) * 100), 100);
        } else if (isCurrentlyInMeeting) {
          attendancePercentage = 100;
        }
        
        let attendanceStatus = 'Absent';
        if (isCurrentlyInMeeting) {
          attendanceStatus = 'In Progress';
        } else if (attendancePercentage >= attendanceThreshold) {
          attendanceStatus = 'Present';
        } else if (attendancePercentage > 0) {
          attendanceStatus = 'Absent';
        }
        
        return {
          participantId: participant.participantId,
          participantName: participant.participantName,
          email: participant.email,
          duration: participantDuration,
          percentage: attendancePercentage,
          status: attendanceStatus,
          joinTime: currentJoinTime,
          leaveTime: currentLeaveTime,
          isActive: isCurrentlyInMeeting,
          studentInfo: null, // Simplified for WebSocket
          authenticatedUser: null, // Simplified for WebSocket
          meetingDuration,
          attendanceThreshold
        };
      }));
      
      const validAttendanceData = attendanceData.filter(entry => entry.status !== 'Error');
      
      const statistics = {
        totalParticipants: validAttendanceData.length,
        presentCount: validAttendanceData.filter(p => p.status === 'Present').length,
        absentCount: validAttendanceData.filter(p => p.status === 'Absent').length,
        inProgressCount: validAttendanceData.filter(p => p.status === 'In Progress').length,
        averageAttendance: validAttendanceData.length > 0 ? 
          Math.round(validAttendanceData.reduce((sum, p) => sum + p.percentage, 0) / validAttendanceData.length) : 0,
        meetingDuration,
        attendanceThreshold,
        above85Percent: validAttendanceData.filter(p => p.percentage >= attendanceThreshold).length,
        below85Percent: validAttendanceData.filter(p => p.percentage < attendanceThreshold && p.percentage > 0).length
      };
      
      return {
        success: true,
        meetingId,
        participants: validAttendanceData,
        statistics,
        timestamp: new Date().toISOString()
      };
      
    } catch (error) {
      return {
        success: false,
        error: error.message,
        meetingId,
        timestamp: new Date().toISOString()
      };
    }
  }

  // Get tracking status
  getTrackingStatus() {
    return {
      activeMeetings: Array.from(this.activeTrackers.keys()),
      totalClients: Array.from(this.subscribedClients.values()).reduce((sum, clients) => sum + clients.size, 0),
      meetingClients: Object.fromEntries(
        Array.from(this.subscribedClients.entries()).map(([meetingId, clients]) => [meetingId, clients.size])
      )
    };
  }
  
  // Register a participant join callback
  onParticipantJoin(callback) {
    if (typeof callback === 'function') {
      this.participantJoinCallbacks.add(callback);
      return true;
    }
    return false;
  }
  
  // Process participant join event (from user dashboard or webhook)
  async processParticipantJoin(io, meetingId, participantData) {
    try {
      console.log(`🔄 Processing participant join event for meeting ${meetingId}`);
      
      // Start tracking automatically if not already tracking
      if (!this.activeTrackers.has(meetingId)) {
        this.startTracking(io, meetingId);
      }
      
      // Fetch fresh attendance data to include the new participant
      const attendanceData = await this.getAttendanceData(meetingId);
      
      if (attendanceData.success) {
        // Find the participant that just joined
        const joinedParticipant = participantData ? 
          attendanceData.participants.find(p => {
            return p.participantId === participantData.participantId || 
                  p.email === participantData.email ||
                  p.participantName === participantData.participantName;
          }) : null;
        
        // Emit joined participant event to all subscribers
        if (joinedParticipant) {
          io.to(`attendance_tracker_${meetingId}`).emit('attendance85ParticipantJoined', {
            meetingId,
            participant: joinedParticipant,
            timestamp: new Date().toISOString()
          });
        }
        
        // Emit table update with all participants
        const tableData = attendanceData.participants.map(participant => ({
          id: participant.participantId,
          name: participant.participantName,
          email: participant.email,
          duration: participant.duration,
          percentage: participant.percentage,
          status: participant.status,
          joinTime: participant.joinTime,
          leaveTime: participant.leaveTime,
          isActive: participant.isActive,
          studentInfo: participant.studentInfo,
          authenticatedUser: participant.authenticatedUser
        }));
        
        io.to(`attendance_tracker_${meetingId}`).emit('attendance85TableUpdate', {
          meetingId,
          tableData,
          statistics: attendanceData.statistics,
          timestamp: new Date().toISOString()
        });
        
        // Execute all registered callbacks
        this.participantJoinCallbacks.forEach(callback => {
          try {
            callback(meetingId, joinedParticipant, attendanceData);
          } catch (callbackError) {
            console.error('Error executing participant join callback:', callbackError);
          }
        });
        
        return {
          success: true,
          participant: joinedParticipant,
          attendance: attendanceData
        };
      }
      
      return {
        success: false,
        error: 'Failed to get updated attendance data',
        meetingId
      };
      
    } catch (error) {
      console.error(`❌ Error processing participant join for meeting ${meetingId}:`, error);
      return {
        success: false,
        error: error.message,
        meetingId
      };
    }
  }
}

// Create global instance
const attendanceTracker85WS = new AttendanceTracker85WebSocket();

// Make it globally accessible
if (typeof global !== 'undefined') {
  global.attendanceTracker85WS = attendanceTracker85WS;
}

/**
 * GET /api/zoom/meeting/:meetingId/attendance-tracker
 * 85% Zoom Attendance Duration Tracker
 * Returns participant attendance data with duration percentages and 85% threshold status
 */
router.get('/meeting/:meetingId/attendance-tracker', async (req, res) => {
  try {
    const { meetingId } = req.params;
    const { includeInactive, threshold } = req.query;
    
    const attendanceThreshold = parseFloat(threshold) || 85;
    const includeInactiveParticipants = includeInactive === 'true';
    
    console.log(`📊 Getting 85% attendance tracker for meeting: ${meetingId}`);
    
    // Get meeting details for duration calculation
    const meeting = await ZoomMeeting.findOne({ 
      $or: [
        { meetingId: meetingId },
        { id: meetingId },
        { 'meetingId': String(meetingId) }
      ]
    });
    
    let meetingDuration = 0;
    let meetingStartTime = null;
    let meetingEndTime = null;
    let meetingStatus = 'scheduled';
    
    if (meeting) {
      meetingStartTime = meeting.startTime || meeting.start_time;
      meetingEndTime = meeting.endTime || meeting.end_time;
      meetingStatus = meeting.status || 'scheduled';
      
      // Calculate meeting duration
      if (meetingStartTime && meetingEndTime) {
        // Meeting has ended - use actual duration
        meetingDuration = Math.round((new Date(meetingEndTime) - new Date(meetingStartTime)) / (1000 * 60));
      } else if (meetingStartTime && (meetingStatus === 'started' || meetingStatus === 'in_progress')) {
        // Meeting is ongoing - use current duration
        meetingDuration = Math.round((Date.now() - new Date(meetingStartTime).getTime()) / (1000 * 60));
      } else {
        // Use scheduled duration or default
        meetingDuration = meeting.duration || 60;
      }
    } else {
      console.warn(`⚠️ Meeting not found: ${meetingId}, using default duration`);
      meetingDuration = 60; // Default 60 minutes
    }
    
    // Get all participants for this meeting
    let participantQuery = { meetingId: String(meetingId) };
    if (!includeInactiveParticipants) {
      // Only include participants who joined (have joinTime)
      participantQuery.joinTime = { $exists: true, $ne: null };
    }
    
    const participants = await Participant.find(participantQuery)
      .populate('userId', 'username email role')
      .sort({ joinTime: 1 });
    
    console.log(`📊 Found ${participants.length} participants for meeting ${meetingId}`);
    
    // Get user sessions for authenticated participants
    const authenticatedSessions = global.userSessionManager ? 
      global.userSessionManager.getActiveMeetingSessions(meetingId) : [];
    
    // Process each participant for 85% attendance tracking
    const attendanceData = await Promise.all(participants.map(async (participant) => {
      try {
        // Calculate participant duration
        let participantDuration = 0;
        let currentJoinTime = null;
        let currentLeaveTime = null;
        let isCurrentlyInMeeting = false;
        
        if (participant.joinTime) {
          currentJoinTime = participant.joinTime;
          currentLeaveTime = participant.leaveTime;
          isCurrentlyInMeeting = participant.isActive && !participant.leaveTime;
          
          if (participant.leaveTime) {
            // Participant has left - use recorded duration
            participantDuration = Math.round((participant.leaveTime - participant.joinTime) / (1000 * 60));
          } else if (participant.isActive) {
            // Participant still in meeting - calculate current duration
            participantDuration = Math.round((Date.now() - participant.joinTime.getTime()) / (1000 * 60));
          } else {
            // Use stored duration if available
            participantDuration = participant.duration || 0;
          }
        }
        
        // Calculate attendance percentage
        let attendancePercentage = 0;
        if (meetingDuration > 0) {
          attendancePercentage = Math.min(Math.round((participantDuration / meetingDuration) * 100), 100);
        } else if (isCurrentlyInMeeting) {
          attendancePercentage = 100;
        }
        
        // Determine attendance status based on 85% threshold
        let attendanceStatus = 'Absent';
        if (isCurrentlyInMeeting) {
          attendanceStatus = 'In Progress';
        } else if (attendancePercentage >= attendanceThreshold) {
          attendanceStatus = 'Present';
        } else if (attendancePercentage > 0) {
          attendanceStatus = 'Absent'; // Below 85% threshold
        }
        
        // Get student information
        let studentInfo = null;
        if (participant.studentId) {
          // Use cached student info from participant
          studentInfo = {
            studentId: participant.studentId,
            firstName: participant.studentFirstName,
            lastName: participant.studentLastName,
            fullName: `${participant.studentFirstName || ''} ${participant.studentLastName || ''}`.trim(),
            department: participant.studentDepartment,
            email: participant.studentEmail,
            isMatched: true
          };
        } else if (participant.email) {
          // Try to find student by email
          try {
            const student = await Student.findOne({
              Email: { $regex: new RegExp(`^${participant.email}$`, 'i') }
            });
            
            if (student) {
              studentInfo = {
                studentId: student.StudentID,
                firstName: student.FirstName,
                lastName: student.LastName,
                fullName: `${student.FirstName || ''} ${student.LastName || ''}`.trim(),
                department: student.Department,
                email: student.Email,
                isMatched: true
              };
            }
          } catch (studentError) {
            console.warn(`⚠️ Error finding student for ${participant.email}:`, studentError.message);
          }
        }
        
        // Check if this participant is authenticated
        let authenticatedUserInfo = null;
        const userSession = authenticatedSessions.find(session => 
          session.participant?.participantId === participant.participantId ||
          session.participant?.email === participant.email ||
          session.user?.email === participant.email
        );
        
        if (userSession) {
          authenticatedUserInfo = {
            userId: userSession.user?.id,
            username: userSession.user?.username,
            email: userSession.user?.email,
            role: userSession.user?.role,
            sessionId: userSession.sessionId,
            joinedViaAuth: true
          };
        } else if (participant.userId) {
          authenticatedUserInfo = {
            userId: participant.userId._id,
            username: participant.userId.username,
            email: participant.userId.email,
            role: participant.userId.role,
            joinedViaAuth: true
          };
        }
        
        return {
          // Core attendance tracking data
          participantId: participant.participantId,
          participantName: participant.participantName,
          email: participant.email,
          duration: participantDuration,
          percentage: attendancePercentage,
          status: attendanceStatus,
          joinTime: currentJoinTime,
          leaveTime: currentLeaveTime,
          isActive: isCurrentlyInMeeting,
          
          // Student information
          studentInfo,
          
          // Authentication info
          authenticatedUser: authenticatedUserInfo,
          
          // Additional metadata
          connectionStatus: participant.connectionStatus,
          userType: participant.userType,
          lastActivity: participant.lastActivity,
          meetingId: participant.meetingId,
          
          // Meeting context
          meetingDuration,
          attendanceThreshold,
          
          // Tracking metadata
          recordId: participant._id,
          createdAt: participant.createdAt,
          updatedAt: participant.updatedAt
        };
      } catch (participantError) {
        console.error(`❌ Error processing participant ${participant.participantName}:`, participantError);
        return {
          participantId: participant.participantId,
          participantName: participant.participantName,
          email: participant.email,
          duration: 0,
          percentage: 0,
          status: 'Error',
          joinTime: participant.joinTime,
          leaveTime: participant.leaveTime,
          isActive: false,
          studentInfo: null,
          authenticatedUser: null,
          error: participantError.message
        };
      }
    }));
    
    // Filter out error entries if requested
    const validAttendanceData = attendanceData.filter(entry => entry.status !== 'Error');
    
    // Calculate statistics
    const statistics = {
      totalParticipants: validAttendanceData.length,
      presentCount: validAttendanceData.filter(p => p.status === 'Present').length,
      absentCount: validAttendanceData.filter(p => p.status === 'Absent').length,
      inProgressCount: validAttendanceData.filter(p => p.status === 'In Progress').length,
      authenticatedCount: validAttendanceData.filter(p => p.authenticatedUser).length,
      studentsIdentified: validAttendanceData.filter(p => p.studentInfo?.isMatched).length,
      averageAttendance: validAttendanceData.length > 0 ? 
        Math.round(validAttendanceData.reduce((sum, p) => sum + p.percentage, 0) / validAttendanceData.length) : 0,
      meetingDuration,
      attendanceThreshold,
      above85Percent: validAttendanceData.filter(p => p.percentage >= attendanceThreshold).length,
      below85Percent: validAttendanceData.filter(p => p.percentage < attendanceThreshold && p.percentage > 0).length
    };
    
    // Meeting information
    const meetingInfo = {
      meetingId,
      topic: meeting?.topic || 'Zoom Meeting',
      status: meetingStatus,
      startTime: meetingStartTime,
      endTime: meetingEndTime,
      duration: meetingDuration,
      hostEmail: meeting?.hostEmail,
      joinUrl: meeting?.joinUrl
    };
    
    console.log(`✅ 85% Attendance Tracker processed: ${statistics.totalParticipants} participants, ${statistics.above85Percent} above 85%, ${statistics.below85Percent} below 85%`);
    
    res.json({
      success: true,
      meetingInfo,
      participants: validAttendanceData,
      statistics,
      attendanceThreshold,
      timestamp: new Date().toISOString(),
      message: `85% Zoom Attendance Duration Tracker for meeting ${meetingId}`
    });
    
  } catch (error) {
    console.error('❌ Error in 85% attendance tracker endpoint:', error);
    res.status(500).json({
      success: false,
      error: error.message,
      meetingId: req.params.meetingId,
      timestamp: new Date().toISOString()
    });
  }
});

/**
 * GET /api/zoom/meeting/:meetingId/attendance-export
 * Export 85% attendance data as CSV
 */
router.get('/meeting/:meetingId/attendance-export', async (req, res) => {
  try {
    const { meetingId } = req.params;
    
    // Get attendance data
    const attendanceResponse = await new Promise((resolve, reject) => {
      const mockReq = { params: { meetingId }, query: req.query };
      const mockRes = {
        json: (data) => resolve(data),
        status: () => mockRes
      };
      
      // Call the main endpoint logic
      router.stack[0].route.stack[0].handle(mockReq, mockRes);
    });
    
    if (!attendanceResponse.success) {
      throw new Error(attendanceResponse.error);
    }
    
    // Generate CSV content
    const csvHeaders = [
      'Participant Name',
      'Email',
      'Duration (Minutes)',
      'Percentage',
      'Status',
      'Join Time',
      'Leave Time',
      'Student ID',
      'Student Name',
      'Department',
      'Is Authenticated',
      'User Role'
    ];
    
    const csvRows = attendanceResponse.participants.map(p => [
      p.participantName || '',
      p.email || '',
      p.duration,
      `${p.percentage}%`,
      p.status,
      p.joinTime ? new Date(p.joinTime).toLocaleString() : '',
      p.leaveTime ? new Date(p.leaveTime).toLocaleString() : '',
      p.studentInfo?.studentId || '',
      p.studentInfo?.fullName || '',
      p.studentInfo?.department || '',
      p.authenticatedUser ? 'Yes' : 'No',
      p.authenticatedUser?.role || ''
    ]);
    
    const csvContent = [csvHeaders, ...csvRows]
      .map(row => row.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(','))
      .join('\n');
    
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="attendance-tracker-${meetingId}-${Date.now()}.csv"`);
    res.send(csvContent);
    
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
 * POST /api/zoom/meeting/:meetingId/attendance-tracker/start-websocket
 * Start WebSocket tracking for 85% attendance
 */
router.post('/meeting/:meetingId/attendance-tracker/start-websocket', (req, res) => {
  try {
    const { meetingId } = req.params;
    const { interval } = req.body;
    const io = req.app.get('io');
    
    if (!io) {
      return res.status(500).json({
        success: false,
        error: 'Socket.IO not available',
        timestamp: new Date().toISOString()
      });
    }
    
    // Start WebSocket tracking
    global.attendanceTracker85WS.startTracking(io, meetingId, interval || 10000);
    
    res.json({
      success: true,
      message: `85% attendance WebSocket tracking started for meeting ${meetingId}`,
      meetingId,
      interval: interval || 10000,
      timestamp: new Date().toISOString()
    });
    
  } catch (error) {
    console.error('❌ Error starting WebSocket tracking:', error);
    res.status(500).json({
      success: false,
      error: error.message,
      meetingId: req.params.meetingId,
      timestamp: new Date().toISOString()
    });
  }
});

/**
 * POST /api/zoom/meeting/:meetingId/attendance-tracker/stop-websocket
 * Stop WebSocket tracking for 85% attendance
 */
router.post('/meeting/:meetingId/attendance-tracker/stop-websocket', (req, res) => {
  try {
    const { meetingId } = req.params;
    
    // Stop WebSocket tracking
    global.attendanceTracker85WS.stopTracking(meetingId);
    
    res.json({
      success: true,
      message: `85% attendance WebSocket tracking stopped for meeting ${meetingId}`,
      meetingId,
      timestamp: new Date().toISOString()
    });
    
  } catch (error) {
    console.error('❌ Error stopping WebSocket tracking:', error);
    res.status(500).json({
      success: false,
      error: error.message,
      meetingId: req.params.meetingId,
      timestamp: new Date().toISOString()
    });
  }
});

/**
 * GET /api/zoom/attendance-tracker/websocket-status
 * Get WebSocket tracking status
 */
router.get('/attendance-tracker/websocket-status', (req, res) => {
  try {
    const status = global.attendanceTracker85WS.getTrackingStatus();
    
    res.json({
      success: true,
      status,
      timestamp: new Date().toISOString()
    });
    
  } catch (error) {
    console.error('❌ Error getting WebSocket status:', error);
    res.status(500).json({
      success: false,
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

module.exports = router;
