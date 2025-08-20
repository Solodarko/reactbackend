const axios = require('axios');
const cron = require('node-cron');
const moment = require('moment');
const EventEmitter = require('events');
const Participant = require('../models/Participant');
const Attendance = require('../models/Attendance');
const Student = require('../models/Student');
const ZoomMeeting = require('../models/ZoomMeeting');
const rateLimiter = require('../utils/rateLimiter');
const zoomRequestQueue = require('../utils/zoomRequestQueue');

// Get user session manager instance when available
let userSessionManager = null;

// Function to get UserSessionManager instance
const getUserSessionManager = () => {
  if (!userSessionManager && global.userSessionManager) {
    userSessionManager = global.userSessionManager;
  }
  return userSessionManager;
};

class AttendanceTracker extends EventEmitter {
  constructor() {
    super();
    this.trackingIntervals = new Map(); // Store polling intervals for active meetings
    this.meetingCache = new Map(); // Cache meeting details
    this.participantCache = new Map(); // Cache participant data
    this.retryAttempts = new Map(); // Track retry attempts for failed operations
    this.healthMetrics = {
      totalRequests: 0,
      successfulRequests: 0,
      failedRequests: 0,
      rateLimitHits: 0,
      lastHealthCheck: null
    };
    
    this.attendanceThresholds = {
      present: 70,    // >= 70% of meeting duration
      late: 30,       // 30-69% of meeting duration  
      absent: 0       // < 30% of meeting duration
    };
    
    this.config = {
      pollInterval: 60000, // Poll every minute for active meetings
      maxRetryAttempts: 3,
      retryDelay: 5000,
      cacheTimeout: 300000, // 5 minutes
      healthCheckInterval: 60000, // 1 minute
      batchSize: 50, // Process participants in batches
      rateLimitBuffer: 1000 // Buffer for rate limiting
    };
    
    this.initializeHealthMonitoring();
  }

  /**
   * Safely parse date string to Date object
   * @param {string|Date|null} dateString - Date string or Date object to parse
   * @param {string} fallbackMsg - Fallback message for logging
   * @returns {Date|null} - Valid Date object or null
   */
  safeParseDate(dateString, fallbackMsg = 'Invalid date') {
    if (!dateString) {
      return null;
    }
    
    if (dateString instanceof Date) {
      return isNaN(dateString.getTime()) ? null : dateString;
    }
    
    try {
      const date = new Date(dateString);
      if (isNaN(date.getTime())) {
        console.warn(`${fallbackMsg}: ${dateString}`);
        return null;
      }
      return date;
    } catch (error) {
      console.warn(`${fallbackMsg}: ${dateString}, Error: ${error.message}`);
      return null;
    }
  }

  /**
   * Get Zoom access token
   */
  async getZoomAccessToken() {
    try {
      const response = await axios.post(
        `https://zoom.us/oauth/token?grant_type=account_credentials&account_id=${process.env.ZOOM_ACCOUNT_ID}`,
        {},
        {
          headers: {
            Authorization: `Basic ${Buffer.from(`${process.env.ZOOM_CLIENT_ID}:${process.env.ZOOM_CLIENT_SECRET}`).toString('base64')}`,
            'Content-Type': 'application/x-www-form-urlencoded'
          },
          timeout: 10000
        }
      );
      return response.data.access_token;
    } catch (error) {
      console.error('❌ Error getting Zoom access token:', error.message);
      throw new Error(`Zoom token error: ${error.message}`);
    }
  }

  /**
   * Get live participants from Zoom API
   */
  async getLiveParticipants(meetingId) {
    try {
      const token = await this.getZoomAccessToken();
      
      const response = await axios.get(
        `https://api.zoom.us/v2/meetings/${meetingId}/participants`,
        {
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
          params: {
            page_size: 300,
            include_fields: 'registrant_id,status,join_time,leave_time,duration,failover,customer_key,in_waiting_room,role,participant_user_id'
          },
          timeout: 15000
        }
      );

      return response.data.participants || [];
    } catch (error) {
      if (error.response?.status === 404) {
        console.log('ℹ️ Meeting not found or ended:', meetingId);
        return [];
      }
      console.error('❌ Error fetching live participants:', error.message);
      throw error;
    }
  }

  /**
   * Get meeting details from Zoom API
   */
  async getMeetingDetails(meetingId) {
    try {
      const token = await this.getZoomAccessToken();
      
      const response = await axios.get(
        `https://api.zoom.us/v2/meetings/${meetingId}`,
        {
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
          timeout: 10000
        }
      );

      return response.data;
    } catch (error) {
      if (error.response?.status === 404) {
        console.log('ℹ️ Meeting not found:', meetingId);
        return null;
      }
      throw error;
    }
  }

  /**
   * Get meeting participants report (for ended meetings)
   */
  async getMeetingParticipantsReport(meetingId) {
    try {
      const token = await this.getZoomAccessToken();
      
      const response = await axios.get(
        `https://api.zoom.us/v2/report/meetings/${meetingId}/participants`,
        {
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
          params: {
            page_size: 300,
            include_fields: 'registrant_id,status,join_time,leave_time,duration,failover,customer_key,in_waiting_room,role,participant_user_id'
          },
          timeout: 15000
        }
      );

      return {
        participants: response.data.participants || [],
        meeting: {
          id: meetingId,
          topic: response.data.topic,
          start_time: response.data.start_time,
          end_time: response.data.end_time,
          duration: response.data.duration
        }
      };
    } catch (error) {
      console.error('❌ Error fetching meeting report:', error.message);
      throw error;
    }
  }

  /**
   * Calculate attendance status based on participation
   */
  calculateAttendanceStatus(participantDuration, meetingDuration, isActive = false) {
    if (isActive) {
      return 'In Progress';
    }

    if (!meetingDuration || meetingDuration === 0) {
      return participantDuration > 0 ? 'Present' : 'Absent';
    }

    const attendancePercentage = (participantDuration / meetingDuration) * 100;

    if (attendancePercentage >= this.attendanceThresholds.present) {
      return 'Present';
    } else if (attendancePercentage >= this.attendanceThresholds.late) {
      return 'Late';
    } else if (attendancePercentage > 0) {
      return 'Partial';
    } else {
      return 'Absent';
    }
  }

  /**
   * Update participant attendance in real-time
   */
  async updateParticipantAttendance(meetingId, zoomParticipants, meetingDetails) {
    const results = {
      updated: 0,
      created: 0,
      errors: []
    };

    try {
      const meetingDuration = meetingDetails?.duration || 0;
      const meetingTopic = meetingDetails?.topic || 'Zoom Meeting';
      const meetingStartTime = this.safeParseDate(meetingDetails?.start_time, 'Invalid meeting start_time') || new Date();

      for (const zoomParticipant of zoomParticipants) {
        try {
          // Safely calculate current duration
          const joinTime = this.safeParseDate(zoomParticipant.join_time, `Invalid join_time for participant ${zoomParticipant.name}`);
          const leaveTime = this.safeParseDate(zoomParticipant.leave_time, `Invalid leave_time for participant ${zoomParticipant.name}`);
          
          if (!joinTime) {
            console.warn(`⚠️ Skipping participant ${zoomParticipant.name} - invalid join_time`);
            continue;
          }
          
          const currentDuration = leaveTime 
            ? Math.round((leaveTime - joinTime) / (1000 * 60))
            : Math.round((Date.now() - joinTime.getTime()) / (1000 * 60));

          const isActive = zoomParticipant.status === 'in_meeting';
          const attendanceStatus = this.calculateAttendanceStatus(
            currentDuration, 
            meetingDuration, 
            isActive
          );

          // Find existing participant record
          let participant = await Participant.findOne({
            meetingId: meetingId,
            $or: [
              { participantId: zoomParticipant.id },
              { zoomUserId: zoomParticipant.user_id },
              { email: zoomParticipant.email }
            ]
          });

          if (participant) {
            // Update existing participant
            participant.participantName = zoomParticipant.name || participant.participantName;
            participant.email = zoomParticipant.email || participant.email;
            participant.duration = currentDuration;
            participant.attendanceStatus = attendanceStatus;
            participant.isActive = isActive;
            participant.connectionStatus = isActive ? 'in_meeting' : 'left';
            participant.lastActivity = new Date();

            if (leaveTime && !participant.leaveTime) {
              participant.leaveTime = leaveTime;
            }

            await participant.save();
            results.updated++;

          } else {
            // Create new participant record
            participant = new Participant({
              participantName: zoomParticipant.name,
              participantId: zoomParticipant.id,
              zoomUserId: zoomParticipant.user_id,
              email: zoomParticipant.email || '',
              meetingId: meetingId,
              meetingTopic: meetingTopic,
              joinTime: joinTime,
              leaveTime: leaveTime,
              duration: currentDuration,
              attendanceStatus: attendanceStatus,
              isActive: isActive,
              connectionStatus: isActive ? 'in_meeting' : 'left',
              lastActivity: new Date(),
              userType: 'attendee'
            });

            // Try to match with student
            if (participant.email) {
              try {
                const student = await Student.findOne({
                  Email: { $regex: new RegExp(participant.email, 'i') }
                });

                if (student) {
                  participant.studentId = student.StudentID;
                  participant.studentFirstName = student.FirstName;
                  participant.studentLastName = student.LastName;
                  participant.studentDepartment = student.Department;
                  participant.studentEmail = student.Email;
                  participant.userType = 'student';
                }
              } catch (studentError) {
                console.warn('⚠️ Student matching failed:', studentError.message);
              }
            }

            await participant.save();
            results.created++;
          }

        } catch (participantError) {
          console.error('❌ Error processing participant:', participantError.message);
          results.errors.push({
            participant: zoomParticipant.name || zoomParticipant.id,
            error: participantError.message
          });
        }
      }

    } catch (error) {
      console.error('❌ Error in updateParticipantAttendance:', error.message);
      results.errors.push({ error: error.message });
    }

    return results;
  }

  /**
   * Start real-time tracking for a meeting
   */
  async startTrackingMeeting(meetingId) {
    try {
      console.log(`🎯 Starting real-time tracking for meeting: ${meetingId}`);

      // Clear existing interval if any
      this.stopTrackingMeeting(meetingId);

      // Get initial meeting details
      let meetingDetails;
      try {
        meetingDetails = await this.getMeetingDetails(meetingId);
      } catch (detailsError) {
        console.error(`❌ Error getting meeting details: ${detailsError.message}`);
        
        if (detailsError.response?.status === 404) {
          throw new Error('Meeting not found. Please verify the meeting ID and ensure the meeting exists.');
        } else if (detailsError.response?.status === 401 || detailsError.response?.status === 403) {
          throw new Error('Not authorized to access this meeting. Please check your permissions.');
        } else if (detailsError.response?.status === 429) {
          throw new Error('Too many requests. Please wait a moment and try again.');
        } else {
          throw new Error(`Unable to connect to Zoom services: ${detailsError.message}`);
        }
      }
      
      if (!meetingDetails) {
        console.log('ℹ️ Meeting not found, cannot start tracking');
        throw new Error('Meeting not found or has not started yet. Please verify the meeting ID.');
      }

      // Set up polling interval
      const intervalId = setInterval(async () => {
        try {
          console.log(`📊 Polling participants for meeting: ${meetingId}`);
          
          const participants = await this.getLiveParticipants(meetingId);
          
          if (participants.length === 0) {
            console.log('ℹ️ No participants found, meeting may have ended');
            this.stopTrackingMeeting(meetingId);
            return;
          }

          const results = await this.updateParticipantAttendance(meetingId, participants, meetingDetails);
          
          console.log(`✅ Updated attendance - Created: ${results.created}, Updated: ${results.updated}, Errors: ${results.errors.length}`);

          // Broadcast real-time updates
          this.broadcastUpdate(meetingId, results, participants.length);

        } catch (pollError) {
          console.error(`❌ Error polling meeting ${meetingId}:`, pollError.message);
          
          // If meeting ended or error persists, stop tracking
          if (pollError.response?.status === 404) {
            console.log('📝 Meeting ended, generating final attendance report');
            await this.generateFinalAttendanceReport(meetingId);
            this.stopTrackingMeeting(meetingId);
          }
        }
      }, this.config.pollInterval);

      this.trackingIntervals.set(meetingId, intervalId);
      
      // Emit tracking started event
      this.emit('trackingStarted', {
        meetingId,
        pollInterval: this.config.pollInterval,
        timestamp: new Date().toISOString()
      });
      
      // Broadcast tracking started
      this.broadcastTrackingStarted(meetingId);
      
      console.log(`✅ Started tracking meeting: ${meetingId} (polling every ${this.config.pollInterval/1000}s)`);
      return true;

    } catch (error) {
      console.error(`❌ Error starting tracking for meeting ${meetingId}:`, error.message);
      this.emit('trackingError', {
        meetingId,
        error: error.message,
        timestamp: new Date().toISOString()
      });
      return false;
    }
  }
  
  /**
   * Broadcast tracking started event
   */
  broadcastTrackingStarted(meetingId) {
    try {
      const { globalState } = require('../server');
      const io = globalState?.io;
      
      if (io) {
        io.emit('trackingStarted', {
          meetingId,
          message: 'Meeting tracking started',
          timestamp: new Date().toISOString()
        });
        
        io.to(`meeting_${meetingId}`).emit('meetingTrackingStarted', {
          meetingId,
          status: 'tracking',
          timestamp: new Date().toISOString()
        });
      }
    } catch (error) {
      // Silently handle broadcast errors
    }
  }
  
  /**
   * Start tracking with test mode (works without active Zoom meeting)
   */
  async startTrackingWithTestData(meetingId) {
    try {
      console.log(`🧪 Starting test tracking for meeting: ${meetingId}`);

      // Clear existing interval if any
      this.stopTrackingMeeting(meetingId);

      // Create mock meeting details for testing
      const mockMeetingDetails = {
        id: meetingId,
        topic: `Test Meeting ${meetingId}`,
        start_time: new Date().toISOString(),
        duration: 60,
        status: 'in_progress'
      };

      // Set up test polling interval
      const intervalId = setInterval(async () => {
        try {
          console.log(`📊 Test polling for meeting: ${meetingId}`);
          
          // Generate mock participants for testing
          const mockParticipants = [
            {
              id: 'test_participant_1',
              name: 'Test Participant 1',
              email: 'test1@example.com',
              join_time: new Date(Date.now() - 10 * 60000).toISOString(), // Joined 10 minutes ago
              status: 'in_meeting',
              user_id: 'test_user_1'
            },
            {
              id: 'test_participant_2',
              name: 'Test Participant 2',
              email: 'test2@example.com',
              join_time: new Date(Date.now() - 5 * 60000).toISOString(), // Joined 5 minutes ago
              status: 'in_meeting',
              user_id: 'test_user_2'
            }
          ];

          const results = await this.updateParticipantAttendance(meetingId, mockParticipants, mockMeetingDetails);
          
          console.log(`✅ Test update - Created: ${results.created}, Updated: ${results.updated}, Errors: ${results.errors.length}`);

          // Broadcast test updates
          this.broadcastUpdate(meetingId, results, mockParticipants.length);

        } catch (pollError) {
          console.error(`❌ Error in test polling for meeting ${meetingId}:`, pollError.message);
        }
      }, this.config.pollInterval);

      this.trackingIntervals.set(meetingId, intervalId);
      
      // Emit tracking started event
      this.emit('trackingStarted', {
        meetingId,
        mode: 'test',
        pollInterval: this.config.pollInterval,
        timestamp: new Date().toISOString()
      });
      
      // Broadcast tracking started
      this.broadcastTrackingStarted(meetingId);
      
      console.log(`✅ Started test tracking for meeting: ${meetingId} (polling every ${this.config.pollInterval/1000}s)`);
      return true;

    } catch (error) {
      console.error(`❌ Error starting test tracking for meeting ${meetingId}:`, error.message);
      this.emit('trackingError', {
        meetingId,
        error: error.message,
        mode: 'test',
        timestamp: new Date().toISOString()
      });
      return false;
    }
  }

  /**
   * Stop tracking a meeting
   */
  stopTrackingMeeting(meetingId) {
    const intervalId = this.trackingIntervals.get(meetingId);
    
    if (intervalId) {
      clearInterval(intervalId);
      this.trackingIntervals.delete(meetingId);
      console.log(`⏹️ Stopped tracking meeting: ${meetingId}`);
      return true;
    }
    
    return false;
  }

  /**
   * Get enriched attendance data with user session information
   */
  async getEnrichedAttendanceData(meetingId) {
    try {
      // Get regular attendance data
      const attendanceData = await this.getCurrentAttendance(meetingId);
      
      if (!attendanceData.success) {
        return attendanceData;
      }

      // Get authenticated user sessions if available
      let authenticatedSessions = [];
      const sessionManager = getUserSessionManager();
      if (sessionManager) {
        try {
          authenticatedSessions = sessionManager.getActiveMeetingSessions(meetingId);
        } catch (sessionError) {
          console.warn('⚠️ Failed to get active sessions:', sessionError.message);
        }
      }

      // Enrich participant data with user session information
      const enrichedParticipants = attendanceData.participants.map(participant => {
        // Find matching user session
        const userSession = authenticatedSessions.find(session => 
          session.participant.participantId === participant.participantId ||
          session.participant.email?.toLowerCase() === participant.email?.toLowerCase() ||
          session.participant.participantName === participant.participantName
        );

        return {
          ...participant,
          authenticatedUser: userSession ? {
            username: userSession.user.username,
            email: userSession.user.email,
            role: userSession.user.role,
            sessionId: userSession.sessionId,
            joinedViaAuth: true,
            device: userSession.device,
            lastActivity: userSession.lastActivity
          } : null,
          isAuthenticated: !!userSession
        };
      });

      // Add statistics for authenticated users
      const authenticatedStats = {
        totalAuthenticated: enrichedParticipants.filter(p => p.isAuthenticated).length,
        authenticatedStudents: enrichedParticipants.filter(p => p.isAuthenticated && p.isStudent).length,
        authenticatedAdmins: enrichedParticipants.filter(p => p.isAuthenticated && p.authenticatedUser?.role === 'admin').length,
        authenticatedUsers: enrichedParticipants.filter(p => p.isAuthenticated && p.authenticatedUser?.role === 'user').length,
        unauthenticatedParticipants: enrichedParticipants.filter(p => !p.isAuthenticated).length
      };

      return {
        ...attendanceData,
        participants: enrichedParticipants,
        authenticatedSessions: authenticatedSessions.length,
        authenticationStats: authenticatedStats,
        sessionManagerAvailable: !!sessionManager
      };

    } catch (error) {
      console.error('❌ Error getting enriched attendance data:', error.message);
      return {
        success: false,
        error: error.message,
        meetingId,
        timestamp: new Date().toISOString()
      };
    }
  }

  /**
   * Get current attendance status for a meeting
   */
  async getCurrentAttendance(meetingId) {
    try {
      // Get participants from database
      const participants = await Participant.find({ meetingId })
        .sort({ joinTime: -1 });
      
      // Get student details separately to avoid populate issues with Number reference
      const studentIds = participants.map(p => p.studentId).filter(Boolean);
      const studentsMap = new Map();
      
      if (studentIds.length > 0) {
        // Ensure all studentIds are valid numbers
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

      // Get live data from Zoom API
      let liveParticipants = [];
      try {
        liveParticipants = await this.getLiveParticipants(meetingId);
      } catch (apiError) {
        console.log('ℹ️ Could not fetch live data, using database records only');
      }

      // Merge data
      const attendanceRecords = participants.map(participant => {
        const liveData = liveParticipants.find(lp => 
          lp.id === participant.participantId || 
          lp.user_id === participant.zoomUserId ||
          (lp.email && participant.email && lp.email.toLowerCase() === participant.email.toLowerCase())
        );

        let currentStatus = participant.attendanceStatus;
        let currentDuration = participant.duration || 0;

        // Update with live data if available
        if (liveData) {
          const joinTime = new Date(liveData.join_time);
          const leaveTime = liveData.leave_time ? new Date(liveData.leave_time) : null;
          currentDuration = leaveTime 
            ? Math.round((leaveTime - joinTime) / (1000 * 60))
            : Math.round((Date.now() - joinTime.getTime()) / (1000 * 60));

          const isActive = liveData.status === 'in_meeting';
          currentStatus = this.calculateAttendanceStatus(currentDuration, 60, isActive); // Assume 60min meeting
        }

        return {
          participantId: participant.participantId,
          participantName: participant.participantName,
          email: participant.email,
          studentInfo: participant.studentId ? {
            studentId: participant.studentId,
            firstName: participant.studentFirstName,
            lastName: participant.studentLastName,
            department: participant.studentDepartment,
            email: participant.studentEmail
          } : null,
          joinTime: participant.joinTime,
          leaveTime: participant.leaveTime,
          duration: currentDuration,
          attendanceStatus: currentStatus,
          isActive: participant.isActive,
          connectionStatus: participant.connectionStatus,
          lastActivity: participant.lastActivity,
          isStudent: !!participant.studentId
        };
      });

      // Calculate statistics
      const stats = {
        total: attendanceRecords.length,
        present: attendanceRecords.filter(p => p.attendanceStatus === 'Present').length,
        inProgress: attendanceRecords.filter(p => p.attendanceStatus === 'In Progress').length,
        late: attendanceRecords.filter(p => p.attendanceStatus === 'Late').length,
        partial: attendanceRecords.filter(p => p.attendanceStatus === 'Partial').length,
        absent: attendanceRecords.filter(p => p.attendanceStatus === 'Absent').length,
        students: attendanceRecords.filter(p => p.isStudent).length,
        active: attendanceRecords.filter(p => p.isActive).length
      };

      return {
        success: true,
        meetingId,
        participants: attendanceRecords,
        statistics: stats,
        timestamp: new Date().toISOString(),
        isLiveData: liveParticipants.length > 0
      };

    } catch (error) {
      console.error('❌ Error getting current attendance:', error.message);
      return {
        success: false,
        error: error.message,
        meetingId,
        timestamp: new Date().toISOString()
      };
    }
  }

  /**
   * Generate final attendance report when meeting ends
   */
  async generateFinalAttendanceReport(meetingId) {
    try {
      console.log(`📊 Generating final attendance report for meeting: ${meetingId}`);

      // Get meeting report from Zoom
      const meetingReport = await this.getMeetingParticipantsReport(meetingId);
      const meetingDuration = meetingReport.meeting?.duration || 0;

      // Update all participants with final data
      if (meetingReport.participants.length > 0) {
        await this.updateParticipantAttendance(meetingId, meetingReport.participants, meetingReport.meeting);
      }

      // Get all participants for this meeting
      const participants = await Participant.find({ meetingId });
      
      // Get student details separately to avoid populate issues
      const participantStudentIds = participants.map(p => p.studentId).filter(Boolean);
      const participantStudentsMap = new Map();
      
      if (participantStudentIds.length > 0) {
        const validIds = participantStudentIds.filter(id => typeof id === 'number' || !isNaN(Number(id)));
        
        if (validIds.length > 0) {
          const students = await Student.find({
            StudentID: { $in: validIds.map(id => Number(id)) }
          });
          students.forEach(student => {
            participantStudentsMap.set(student.StudentID, student);
          });
        }
      }

      // Generate attendance records for students
      const attendanceRecords = [];
      
      for (const participant of participants) {
        if (participant.studentId && participant.duration > 0) {
          const finalStatus = this.calculateAttendanceStatus(participant.duration, meetingDuration, false);
          
          // Update participant with final status
          participant.attendanceStatus = finalStatus;
          participant.isActive = false;
          await participant.save();

          // Create attendance record
          const attendanceRecord = new Attendance({
            StudentID: participant.studentId,
            Date: participant.joinTime || new Date(),
            Status: finalStatus,
            Duration: participant.duration,
            MeetingId: meetingId,
            MeetingTopic: participant.meetingTopic,
            Remarks: `Zoom meeting attendance: ${participant.duration} minutes (${Math.round((participant.duration / meetingDuration) * 100)}%)`
          });

          try {
            await attendanceRecord.save();
            attendanceRecords.push(attendanceRecord);
            console.log(`✅ Created attendance record for student: ${participant.studentId}`);
          } catch (saveError) {
            console.error(`❌ Failed to save attendance for ${participant.studentId}:`, saveError.message);
          }
        }
      }

      console.log(`📋 Final attendance report generated - ${attendanceRecords.length} records created`);
      
      return {
        success: true,
        meetingId,
        participantCount: participants.length,
        attendanceRecords: attendanceRecords.length,
        meetingDuration,
        timestamp: new Date().toISOString()
      };

    } catch (error) {
      console.error(`❌ Error generating final attendance report for ${meetingId}:`, error.message);
      return {
        success: false,
        error: error.message,
        meetingId,
        timestamp: new Date().toISOString()
      };
    }
  }

  /**
   * Get attendance summary for multiple meetings
   */
  async getAttendanceSummary(dateFrom, dateTo, studentId = null) {
    try {
      const dateFilter = {};
      
      if (dateFrom) {
        dateFilter.$gte = new Date(dateFrom);
      }
      
      if (dateTo) {
        dateFilter.$lte = new Date(dateTo);
      }

      let query = {};
      
      if (Object.keys(dateFilter).length > 0) {
        query.joinTime = dateFilter;
      }
      
      if (studentId) {
        query.studentId = studentId;
      }

      const participants = await Participant.find(query)
        .sort({ joinTime: -1 });
      
      // Get student details separately to avoid populate issues
      const participantStudentIds = participants.map(p => p.studentId).filter(Boolean);
      const summaryStudentsMap = new Map();
      
      if (participantStudentIds.length > 0) {
        const validIds = participantStudentIds.filter(id => typeof id === 'number' || !isNaN(Number(id)));
        
        if (validIds.length > 0) {
          const students = await Student.find({
            StudentID: { $in: validIds.map(id => Number(id)) }
          });
          students.forEach(student => {
            summaryStudentsMap.set(student.StudentID, student);
          });
        }
      }

      // Group by meeting
      const meetingGroups = {};
      
      participants.forEach(participant => {
        if (!meetingGroups[participant.meetingId]) {
          meetingGroups[participant.meetingId] = {
            meetingId: participant.meetingId,
            meetingTopic: participant.meetingTopic,
            participants: []
          };
        }
        meetingGroups[participant.meetingId].participants.push(participant);
      });

      // Calculate statistics for each meeting
      const meetingSummaries = Object.values(meetingGroups).map(meeting => {
        const stats = {
          present: meeting.participants.filter(p => p.attendanceStatus === 'Present').length,
          late: meeting.participants.filter(p => p.attendanceStatus === 'Late').length,
          partial: meeting.participants.filter(p => p.attendanceStatus === 'Partial').length,
          absent: meeting.participants.filter(p => p.attendanceStatus === 'Absent').length,
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
        totalMeetings: meetingSummaries.length,
        totalParticipants: participants.length,
        totalStudents: participants.filter(p => p.studentId).length,
        present: participants.filter(p => p.attendanceStatus === 'Present').length,
        late: participants.filter(p => p.attendanceStatus === 'Late').length,
        partial: participants.filter(p => p.attendanceStatus === 'Partial').length,
        absent: participants.filter(p => p.attendanceStatus === 'Absent').length
      };

      return {
        success: true,
        dateRange: { from: dateFrom, to: dateTo },
        studentId,
        meetings: meetingSummaries,
        overallStatistics: overallStats,
        timestamp: new Date().toISOString()
      };

    } catch (error) {
      console.error('❌ Error getting attendance summary:', error.message);
      return {
        success: false,
        error: error.message,
        timestamp: new Date().toISOString()
      };
    }
  }

  /**
   * Auto-start tracking for active meetings (scheduled job)
   */
  async autoTrackActiveMeetings() {
    try {
      console.log('🔍 Checking for active meetings to track...');
      
      // This would need to be customized based on how you identify active meetings
      // For now, checking database for meetings marked as active
      const activeMeetings = await ZoomMeeting.find({
        status: { $in: ['started', 'active', 'in_progress'] }
      });

      for (const meeting of activeMeetings) {
        const meetingId = meeting.meetingId;
        
        // Only start tracking if not already tracking
        if (!this.trackingIntervals.has(meetingId)) {
          console.log(`🎯 Auto-starting tracking for meeting: ${meetingId}`);
          await this.startTrackingMeeting(meetingId);
        }
      }

      console.log(`✅ Auto-tracking check complete. Tracking ${this.trackingIntervals.size} meetings.`);
      
    } catch (error) {
      console.error('❌ Error in auto-track active meetings:', error.message);
    }
  }

  /**
   * Initialize attendance tracker
   */
  init() {
    console.log('🎯 Initializing Attendance Tracker...');
    
    // Schedule auto-tracking check every 5 minutes
    cron.schedule('*/5 * * * *', () => {
      this.autoTrackActiveMeetings();
    });

    // Schedule cleanup of old tracking intervals daily
    cron.schedule('0 2 * * *', () => {
      this.cleanupTrackingIntervals();
    });

    console.log('✅ Attendance Tracker initialized');
  }

  /**
   * Cleanup tracking intervals for ended meetings
   */
  cleanupTrackingIntervals() {
    console.log('🧹 Cleaning up tracking intervals...');
    
    for (const [meetingId, intervalId] of this.trackingIntervals.entries()) {
      // You could add logic here to check if meeting actually ended
      // For now, just log active tracking
      console.log(`📊 Still tracking meeting: ${meetingId}`);
    }
  }

  /**
   * Initialize health monitoring
   */
  initializeHealthMonitoring() {
    // Health check interval
    setInterval(() => {
      this.performHealthCheck();
    }, this.config.healthCheckInterval);
    
    // Clean up expired cache entries
    setInterval(() => {
      this.cleanupCache();
    }, this.config.cacheTimeout);
  }

  /**
   * Perform health check
   */
  performHealthCheck() {
    const now = Date.now();
    this.healthMetrics.lastHealthCheck = new Date();
    
    // Check rate limit status
    if (rateLimiter && typeof rateLimiter.getStats === 'function') {
      const stats = rateLimiter.getStats();
      if (stats.requestsPerMinute >= 80) { // 80% of limit
        this.emit('healthWarning', {
          type: 'rate_limit_approaching',
          message: 'Approaching rate limit threshold',
          stats
        });
      }
    }
    
    // Check error rate
    const errorRate = this.healthMetrics.totalRequests > 0 
      ? (this.healthMetrics.failedRequests / this.healthMetrics.totalRequests) * 100 
      : 0;
      
    if (errorRate > 10) { // 10% error rate threshold
      this.emit('healthWarning', {
        type: 'high_error_rate',
        message: `High error rate detected: ${errorRate.toFixed(2)}%`,
        metrics: this.healthMetrics
      });
    }
    
    // Check memory usage
    const memUsage = process.memoryUsage();
    const heapUsedMB = memUsage.heapUsed / 1024 / 1024;
    if (heapUsedMB > 512) { // 512MB threshold
      this.emit('healthWarning', {
        type: 'high_memory_usage',
        message: `High memory usage: ${heapUsedMB.toFixed(2)}MB`,
        memoryUsage: memUsage
      });
    }
  }

  /**
   * Clean up expired cache entries
   */
  cleanupCache() {
    const now = Date.now();
    const expiredKeys = [];
    
    // Clean meeting cache
    for (const [key, data] of this.meetingCache.entries()) {
      if (now - data.timestamp > this.config.cacheTimeout) {
        expiredKeys.push(key);
      }
    }
    
    // Clean participant cache
    for (const [key, data] of this.participantCache.entries()) {
      if (now - data.timestamp > this.config.cacheTimeout) {
        expiredKeys.push(key);
      }
    }
    
    // Remove expired entries
    expiredKeys.forEach(key => {
      this.meetingCache.delete(key);
      this.participantCache.delete(key);
    });
    
    if (expiredKeys.length > 0) {
      console.log(`🧹 Cleaned up ${expiredKeys.length} expired cache entries`);
    }
  }

  /**
   * Enhanced API call with retry logic and rate limiting
   */
  async makeZoomAPICall(apiCall, identifier, options = {}) {
    const maxRetries = options.maxRetries || this.config.maxRetryAttempts;
    const retryDelay = options.retryDelay || this.config.retryDelay;
    
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        this.healthMetrics.totalRequests++;
        
        // Use rate limiter if available
        if (rateLimiter && typeof rateLimiter.executeApiCall === 'function') {
          const result = await rateLimiter.executeApiCall(
            apiCall,
            identifier,
            {
              retryCount: maxRetries - attempt,
              cacheKey: options.cacheKey,
              cacheTTL: options.cacheTTL || 300,
              ...options
            }
          );
          
          this.healthMetrics.successfulRequests++;
          return result;
        } else {
          // Fallback to direct API call
          const result = await apiCall();
          this.healthMetrics.successfulRequests++;
          return result;
        }
        
      } catch (error) {
        this.healthMetrics.failedRequests++;
        
        if (error.response?.status === 429) {
          this.healthMetrics.rateLimitHits++;
          
          if (attempt < maxRetries) {
            const delay = retryDelay * Math.pow(2, attempt - 1); // Exponential backoff
            console.warn(`⏳ Rate limit hit, retrying in ${delay}ms (attempt ${attempt}/${maxRetries})`);
            await this.sleep(delay);
            continue;
          }
        }
        
        if (attempt < maxRetries && this.isRetryableError(error)) {
          const delay = retryDelay * attempt;
          console.warn(`⏳ API call failed, retrying in ${delay}ms (attempt ${attempt}/${maxRetries}): ${error.message}`);
          await this.sleep(delay);
          continue;
        }
        
        throw error;
      }
    }
  }

  /**
   * Check if error is retryable
   */
  isRetryableError(error) {
    const retryableStatusCodes = [429, 500, 502, 503, 504];
    return error.response?.status && retryableStatusCodes.includes(error.response.status);
  }

  /**
   * Sleep utility function
   */
  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Enhanced get live participants with caching and retry
   */
  async getLiveParticipantsEnhanced(meetingId) {
    const cacheKey = `participants_${meetingId}`;
    const cached = this.participantCache.get(cacheKey);
    
    // Return cached data if still valid
    if (cached && Date.now() - cached.timestamp < 30000) { // 30-second cache
      return cached.data;
    }
    
    try {
      const participants = await this.makeZoomAPICall(
        () => this.getLiveParticipants(meetingId),
        `live-participants-${meetingId}`,
        {
          cacheKey: cacheKey,
          cacheTTL: 30,
          maxRetries: 3
        }
      );
      
      // Cache the result
      this.participantCache.set(cacheKey, {
        data: participants,
        timestamp: Date.now()
      });
      
      return participants;
      
    } catch (error) {
      console.error(`❌ Enhanced participants fetch failed for meeting ${meetingId}:`, error.message);
      
      // Return cached data if available, even if expired
      if (cached) {
        console.log('📦 Using expired cache data due to API failure');
        return cached.data;
      }
      
      throw error;
    }
  }

  /**
   * Batch process participants for better performance
   */
  async updateParticipantAttendanceBatch(meetingId, zoomParticipants, meetingDetails) {
    const results = {
      updated: 0,
      created: 0,
      errors: [],
      batches: 0
    };

    try {
      // Process participants in batches
      const batchSize = this.config.batchSize;
      const batches = [];
      
      for (let i = 0; i < zoomParticipants.length; i += batchSize) {
        batches.push(zoomParticipants.slice(i, i + batchSize));
      }
      
      for (const batch of batches) {
        try {
          const batchResult = await this.updateParticipantAttendance(meetingId, batch, meetingDetails);
          
          results.updated += batchResult.updated;
          results.created += batchResult.created;
          results.errors.push(...batchResult.errors);
          results.batches++;
          
          // Small delay between batches to prevent overwhelming the database
          if (batches.length > 1) {
            await this.sleep(100);
          }
          
        } catch (batchError) {
          console.error(`❌ Batch processing error:`, batchError.message);
          results.errors.push({
            error: `Batch processing failed: ${batchError.message}`,
            batchSize: batch.length
          });
        }
      }
      
    } catch (error) {
      console.error('❌ Error in batch processing:', error.message);
      results.errors.push({ error: error.message });
    }

    return results;
  }

  /**
   * Advanced meeting tracking with enhanced error handling
   */
  async startTrackingMeetingEnhanced(meetingId) {
    try {
      console.log(`🎯 Starting enhanced tracking for meeting: ${meetingId}`);
      
      // Reset retry attempts
      this.retryAttempts.delete(meetingId);
      
      // Clear existing interval
      this.stopTrackingMeeting(meetingId);
      
      // Get cached meeting details or fetch new
      let meetingDetails = this.meetingCache.get(`details_${meetingId}`);
      
      if (!meetingDetails || Date.now() - meetingDetails.timestamp > this.config.cacheTimeout) {
        try {
          const details = await this.makeZoomAPICall(
            () => this.getMeetingDetails(meetingId),
            `meeting-details-${meetingId}`,
            {
              cacheKey: `details_${meetingId}`,
              cacheTTL: 600 // 10 minutes
            }
          );
          
          if (!details) {
            throw new Error('Meeting not found or has not started yet');
          }
          
          meetingDetails = {
            data: details,
            timestamp: Date.now()
          };
          
          this.meetingCache.set(`details_${meetingId}`, meetingDetails);
          
        } catch (detailsError) {
          this.handleTrackingError(meetingId, detailsError);
          return false;
        }
      }
      
      // Set up enhanced polling interval
      const intervalId = setInterval(async () => {
        try {
          console.log(`📊 Enhanced polling for meeting: ${meetingId}`);
          
          const participants = await this.getLiveParticipantsEnhanced(meetingId);
          
          if (participants.length === 0) {
            const retryCount = this.retryAttempts.get(meetingId) || 0;
            
            if (retryCount < 3) {
              this.retryAttempts.set(meetingId, retryCount + 1);
              console.log(`ℹ️ No participants found, retry ${retryCount + 1}/3`);
              return;
            }
            
            console.log('📝 No participants found after retries, ending tracking');
            await this.generateFinalAttendanceReport(meetingId);
            this.stopTrackingMeeting(meetingId);
            return;
          }
          
          // Reset retry counter on successful fetch
          this.retryAttempts.delete(meetingId);
          
          const results = await this.updateParticipantAttendanceBatch(
            meetingId, 
            participants, 
            meetingDetails.data
          );
          
          console.log(`✅ Enhanced update - Created: ${results.created}, Updated: ${results.updated}, Batches: ${results.batches}, Errors: ${results.errors.length}`);
          
          // Emit events for real-time updates
          this.emit('attendanceUpdated', {
            meetingId,
            results,
            participants: participants.length,
            timestamp: new Date().toISOString()
          });
          
          // Broadcast via Socket.IO if available
          this.broadcastUpdate(meetingId, results, participants.length);
          
        } catch (pollError) {
          this.handleTrackingError(meetingId, pollError);
        }
      }, this.config.pollInterval);
      
      this.trackingIntervals.set(meetingId, intervalId);
      
      // Emit tracking started event
      this.emit('trackingStarted', {
        meetingId,
        pollInterval: this.config.pollInterval,
        timestamp: new Date().toISOString()
      });
      
      console.log(`✅ Enhanced tracking started for meeting: ${meetingId}`);
      return true;
      
    } catch (error) {
      console.error(`❌ Error starting enhanced tracking for meeting ${meetingId}:`, error.message);
      this.emit('trackingError', {
        meetingId,
        error: error.message,
        timestamp: new Date().toISOString()
      });
      return false;
    }
  }

  /**
   * Handle tracking errors with intelligent retry logic
   */
  handleTrackingError(meetingId, error) {
    console.error(`❌ Tracking error for meeting ${meetingId}:`, error.message);
    
    if (error.response?.status === 404) {
      console.log('📝 Meeting ended, generating final report');
      this.generateFinalAttendanceReport(meetingId);
      this.stopTrackingMeeting(meetingId);
      return;
    }
    
    if (error.response?.status === 429) {
      console.log('⏳ Rate limit hit, continuing with reduced frequency');
      // Could implement dynamic polling interval adjustment here
      return;
    }
    
    // For other errors, track retry attempts
    const retryCount = this.retryAttempts.get(meetingId) || 0;
    if (retryCount >= this.config.maxRetryAttempts) {
      console.error(`❌ Max retry attempts reached for meeting ${meetingId}, stopping tracking`);
      this.stopTrackingMeeting(meetingId);
      
      this.emit('trackingFailed', {
        meetingId,
        error: error.message,
        retryCount,
        timestamp: new Date().toISOString()
      });
    } else {
      this.retryAttempts.set(meetingId, retryCount + 1);
    }
  }

  /**
   * Broadcast updates via Socket.IO
   */
  broadcastUpdate(meetingId, results, participantCount) {
    try {
      const { globalState } = require('../server');
      const io = globalState?.io;
      
      if (io) {
        io.emit('attendanceUpdate', {
          meetingId,
          results,
          participants: participantCount,
          timestamp: new Date().toISOString()
        });
        
        io.to(`meeting_${meetingId}`).emit('meetingAttendanceUpdate', {
          meetingId,
          summary: {
            created: results.created,
            updated: results.updated,
            errors: results.errors.length,
            participantCount
          },
          timestamp: new Date().toISOString()
        });
      }
    } catch (broadcastError) {
      // Silently handle broadcast errors
    }
  }

  /**
   * Get comprehensive health metrics
   */
  getHealthMetrics() {
    const successRate = this.healthMetrics.totalRequests > 0 
      ? (this.healthMetrics.successfulRequests / this.healthMetrics.totalRequests) * 100 
      : 0;
      
    const errorRate = this.healthMetrics.totalRequests > 0 
      ? (this.healthMetrics.failedRequests / this.healthMetrics.totalRequests) * 100 
      : 0;
    
    return {
      ...this.healthMetrics,
      successRate: Math.round(successRate * 100) / 100,
      errorRate: Math.round(errorRate * 100) / 100,
      cacheStats: {
        meetingCacheSize: this.meetingCache.size,
        participantCacheSize: this.participantCache.size
      },
      activeTracking: {
        meetingsTracked: this.trackingIntervals.size,
        activeMeetings: Array.from(this.trackingIntervals.keys())
      },
      configuration: this.config
    };
  }

  /**
   * Get status of all tracked meetings with enhanced information
   */
  getTrackingStatus() {
    const activeMeetings = Array.from(this.trackingIntervals.keys());
    const healthMetrics = this.getHealthMetrics();
    
    return {
      isTracking: activeMeetings.length > 0,
      activeMeetings,
      totalTracked: activeMeetings.length,
      config: this.config,
      thresholds: this.attendanceThresholds,
      health: {
        successRate: healthMetrics.successRate,
        errorRate: healthMetrics.errorRate,
        rateLimitHits: healthMetrics.rateLimitHits,
        lastHealthCheck: healthMetrics.lastHealthCheck
      },
      cache: healthMetrics.cacheStats,
      retryAttempts: Object.fromEntries(this.retryAttempts),
      timestamp: new Date().toISOString()
    };
  }

  /**
   * Update configuration dynamically
   */
  updateConfiguration(newConfig) {
    const oldConfig = { ...this.config };
    this.config = { ...this.config, ...newConfig };
    
    console.log('⚙️ Configuration updated:', {
      old: oldConfig,
      new: this.config,
      changed: Object.keys(newConfig)
    });
    
    this.emit('configurationUpdated', {
      oldConfig,
      newConfig: this.config,
      changedKeys: Object.keys(newConfig),
      timestamp: new Date().toISOString()
    });
  }

  /**
   * Reset health metrics
   */
  resetHealthMetrics() {
    this.healthMetrics = {
      totalRequests: 0,
      successfulRequests: 0,
      failedRequests: 0,
      rateLimitHits: 0,
      lastHealthCheck: new Date()
    };
    
    console.log('🔄 Health metrics reset');
    this.emit('metricsReset', {
      timestamp: new Date().toISOString()
    });
  }
}

module.exports = AttendanceTracker;
