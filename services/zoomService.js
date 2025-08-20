const axios = require('axios');
const jwt = require('jsonwebtoken');
const ZoomMeeting = require('../models/ZoomMeeting');
const Attendance = require('../models/Attendance');
const Student = require('../models/Student');
const moment = require('moment');
const zoomRequestQueue = require('../utils/zoomRequestQueue');

class ZoomService {
  constructor() {
    this.baseURL = 'https://api.zoom.us/v2';
    this.tokenCache = new Map();
    this.rateLimiter = new Map();
  }

  // Enhanced token management with caching
  async getAccessToken() {
    const now = Date.now();
    const cached = this.tokenCache.get('access_token');
    
    if (cached && cached.expires > now + 300000) { // 5 minutes buffer
      return cached.token;
    }

    try {
      const response = await zoomRequestQueue.enqueue(
        async () => {
          return await axios.post(
            `https://zoom.us/oauth/token?grant_type=account_credentials&account_id=${process.env.ZOOM_ACCOUNT_ID}`,
            {},
            {
              headers: {
                Authorization: `Basic ${Buffer.from(
                  `${process.env.ZOOM_CLIENT_ID}:${process.env.ZOOM_CLIENT_SECRET}`
                ).toString('base64')}`,
                'Content-Type': 'application/x-www-form-urlencoded'
              },
              timeout: 15000
            }
          );
        },
        {
          category: 'user',
          priority: 2,
          identifier: 'zoom-service-access-token',
          cacheKey: 'zoom_service_access_token',
          cacheTTL: 3300,
          enableCache: true
        }
      );

      const token = response.data.access_token;
      const expiresIn = response.data.expires_in || 3600; // Default 1 hour
      
      this.tokenCache.set('access_token', {
        token,
        expires: now + (expiresIn * 1000)
      });

      return token;
    } catch (error) {
      console.error('🚨 Zoom token error:', error.response?.data || error.message);
      throw new Error(`Zoom authentication failed: ${error.response?.data?.error || error.message}`);
    }
  }

  // Enhanced signature generation
  generateSignature(meetingNumber, role = 0) {
    const iat = Math.round(Date.now() / 1000) - 30;
    const exp = iat + 60 * 60 * 2; // 2 hours
    
    const payload = {
      iss: process.env.ZOOM_CLIENT_ID,
      exp,
      iat,
      aud: 'zoom',
      appKey: process.env.ZOOM_CLIENT_ID,
      tokenExp: exp,
      alg: 'HS256'
    };
    
    if (meetingNumber) {
      payload.meetingNumber = meetingNumber.toString();
    }
    
    if (typeof role !== 'undefined') {
      payload.role = parseInt(role) || 0;
    }
    
    try {
      return jwt.sign(payload, process.env.ZOOM_CLIENT_SECRET, { algorithm: 'HS256' });
    } catch (error) {
      console.error('🚨 JWT signature error:', error);
      throw new Error('Failed to generate meeting signature');
    }
  }

  // Create meeting with enhanced options
  async createMeeting(meetingData) {
    const token = await this.getAccessToken();
    
    const defaultSettings = {
      topic: 'New Meeting',
      type: 1, // Instant meeting
      duration: 5,
      settings: {
        host_video: true,
        participant_video: true,
        cn_meeting: false,
        in_meeting: false,
        join_before_host: true,
        mute_upon_entry: false,
        watermark: false,
        use_pmi: false,
        approval_type: 0,
        audio: 'both',
        auto_recording: 'none',
        waiting_room: false,
        registrants_confirmation_email: false,
        registrants_email_notification: false,
        meeting_authentication: false,
        encryption_type: 'enhanced_encryption',
        allow_multiple_devices: true
      }
    };

    const finalMeetingData = {
      ...defaultSettings,
      ...meetingData,
      settings: {
        ...defaultSettings.settings,
        ...meetingData.settings
      }
    };

    try {
      const response = await zoomRequestQueue.enqueue(
        async () => {
          return await axios.post(
            `${this.baseURL}/users/me/meetings`,
            finalMeetingData,
            {
              headers: {
                Authorization: `Bearer ${token}`,
                'Content-Type': 'application/json'
              },
              timeout: 30000
            }
          );
        },
        {
          category: 'meeting',
          priority: 3,
          identifier: `zoom-service-create-meeting-${Date.now()}`,
          retryCount: 3
        }
      );

      const meeting = response.data;
      
      // Store in database
      const zoomMeeting = new ZoomMeeting({
        meetingId: meeting.id.toString(),
        meetingUuid: meeting.uuid,
        topic: meeting.topic,
        hostId: meeting.host_id,
        hostEmail: meeting.host_email,
        type: meeting.type,
        startTime: meeting.start_time ? new Date(meeting.start_time) : null,
        duration: meeting.duration,
        timezone: meeting.timezone,
        password: meeting.password,
        joinUrl: meeting.join_url,
        startUrl: meeting.start_url,
        settings: {
          hostVideo: meeting.settings.host_video,
          participantVideo: meeting.settings.participant_video,
          joinBeforeHost: meeting.settings.join_before_host,
          muteUponEntry: meeting.settings.mute_upon_entry,
          waitingRoom: meeting.settings.waiting_room,
          autoRecording: meeting.settings.auto_recording,
          approvalType: meeting.settings.approval_type
        },
        metadata: finalMeetingData.metadata || {}
      });

      await zoomMeeting.save();
      
      return {
        ...meeting,
        dbRecord: zoomMeeting
      };
    } catch (error) {
      console.error('🚨 Meeting creation error:', error.response?.data || error.message);
      
      if (error.response?.status === 429) {
        throw new Error('Rate limit exceeded. Please try again in a moment.');
      }
      
      throw new Error(`Meeting creation failed: ${error.response?.data?.message || error.message}`);
    }
  }

  // Get meeting details
  async getMeetingDetails(meetingId) {
    const token = await this.getAccessToken();
    
    try {
      const response = await zoomRequestQueue.enqueue(
        async () => {
          return await axios.get(
            `${this.baseURL}/meetings/${meetingId}`,
            {
              headers: {
                Authorization: `Bearer ${token}`
              },
              timeout: 15000
            }
          );
        },
        {
          category: 'meeting',
          priority: 2,
          identifier: `zoom-service-get-meeting-${meetingId}`,
          cacheKey: `zoom_service_meeting_${meetingId}`,
          cacheTTL: 300,
          enableCache: true
        }
      );
      
      return response.data;
    } catch (error) {
      console.error('🚨 Get meeting details error:', error.response?.data || error.message);
      throw new Error(`Failed to get meeting details: ${error.response?.data?.message || error.message}`);
    }
  }

  // Get meeting participants
  async getMeetingParticipants(meetingId) {
    const token = await this.getAccessToken();
    
    try {
      const response = await zoomRequestQueue.enqueue(
        async () => {
          return await axios.get(
            `${this.baseURL}/meetings/${meetingId}/participants`,
            {
              headers: {
                Authorization: `Bearer ${token}`
              },
              params: {
                page_size: 300
              },
              timeout: 15000
            }
          );
        },
        {
          category: 'meeting',
          priority: 2,
          identifier: `zoom-service-get-participants-${meetingId}`,
          cacheKey: `zoom_service_participants_${meetingId}`,
          cacheTTL: 60,
          enableCache: true
        }
      );
      
      return response.data;
    } catch (error) {
      console.error('🚨 Get participants error:', error.response?.data || error.message);
      throw new Error(`Failed to get participants: ${error.response?.data?.message || error.message}`);
    }
  }

  // Update meeting
  async updateMeeting(meetingId, updateData) {
    const token = await this.getAccessToken();
    
    try {
      const response = await axios.patch(
        `${this.baseURL}/meetings/${meetingId}`,
        updateData,
        {
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json'
          },
          timeout: 15000
        }
      );
      
      // Update database record
      await ZoomMeeting.findOneAndUpdate(
        { meetingId: meetingId.toString() },
        { $set: updateData },
        { new: true }
      );
      
      return response.data;
    } catch (error) {
      console.error('🚨 Update meeting error:', error.response?.data || error.message);
      throw new Error(`Failed to update meeting: ${error.response?.data?.message || error.message}`);
    }
  }

  // Delete meeting
  async deleteMeeting(meetingId) {
    const token = await this.getAccessToken();
    
    try {
      await axios.delete(
        `${this.baseURL}/meetings/${meetingId}`,
        {
          headers: {
            Authorization: `Bearer ${token}`
          },
          timeout: 15000
        }
      );
      
      // Update database record
      await ZoomMeeting.findOneAndUpdate(
        { meetingId: meetingId.toString() },
        { $set: { status: 'ended', actualEndTime: new Date() } },
        { new: true }
      );
      
      return { success: true };
    } catch (error) {
      console.error('🚨 Delete meeting error:', error.response?.data || error.message);
      throw new Error(`Failed to delete meeting: ${error.response?.data?.message || error.message}`);
    }
  }

  // Track participant join
  async trackParticipantJoin(meetingId, participantData) {
    try {
      const meeting = await ZoomMeeting.findOne({ meetingId: meetingId.toString() });
      if (!meeting) {
        throw new Error('Meeting not found');
      }

      const joinTime = new Date();
      const participant = {
        participantId: participantData.userId || participantData.id,
        name: participantData.displayName || participantData.name,
        email: participantData.email || '',
        joinTime,
        status: 'in_meeting'
      };

      // Try to match with student
      if (participant.email) {
        const student = await Student.findOne({ 
          Email: { $regex: new RegExp(participant.email, 'i') } 
        });
        
        if (student) {
          participant.studentId = student.StudentID;
          participant.studentFirstName = student.FirstName;
          participant.studentLastName = student.LastName;
          participant.studentDepartment = student.Department;
          participant.studentEmail = student.Email;
          participant.isMatched = true;
        }
      }

      await meeting.updateParticipant(participant);
      
      return {
        success: true,
        participant,
        meetingInfo: {
          id: meeting.meetingId,
          topic: meeting.topic,
          totalParticipants: meeting.totalParticipants
        }
      };
    } catch (error) {
      console.error('🚨 Track participant join error:', error);
      throw error;
    }
  }

  // Track participant leave
  async trackParticipantLeave(meetingId, participantData) {
    try {
      const meeting = await ZoomMeeting.findOne({ meetingId: meetingId.toString() });
      if (!meeting) {
        throw new Error('Meeting not found');
      }

      const participant = meeting.participants.find(
        p => p.participantId === (participantData.userId || participantData.id)
      );

      if (participant) {
        const leaveTime = new Date();
        const duration = Math.floor((leaveTime - participant.joinTime) / 1000); // seconds

        participant.leaveTime = leaveTime;
        participant.duration = duration;
        participant.status = 'left';

        await meeting.save();

        // Generate attendance record if participant was matched with a student
        if (participant.isMatched && participant.studentId) {
          await this.generateAttendanceRecord(meeting, participant, duration);
        }

        return {
          success: true,
          participant,
          duration,
          durationMinutes: Math.round(duration / 60)
        };
      }

      throw new Error('Participant not found in meeting');
    } catch (error) {
      console.error('🚨 Track participant leave error:', error);
      throw error;
    }
  }

  // Generate attendance record
  async generateAttendanceRecord(meeting, participant, duration) {
    try {
      const attendanceThreshold = parseInt(process.env.ATTENDANCE_THRESHOLD) || 75; // 75% minimum
      const requiredDuration = (meeting.duration * 60 * attendanceThreshold) / 100; // in seconds
      
      const attendanceRecord = new Attendance({
        StudentID: participant.studentId,
        FirstName: participant.studentFirstName,
        LastName: participant.studentLastName,
        Email: participant.studentEmail,
        Department: participant.studentDepartment,
        Course: meeting.metadata?.course || 'Unknown',
        Session: meeting.metadata?.session || meeting.topic,
        AttendanceDate: participant.joinTime,
        TimeIn: participant.joinTime,
        TimeOut: participant.leaveTime,
        Duration: Math.round(duration / 60), // minutes
        AttendanceStatus: duration >= requiredDuration ? 'Present' : 'Partial',
        MeetingID: meeting.meetingId,
        MeetingTopic: meeting.topic,
        AttendancePercentage: Math.round((duration / (meeting.duration * 60)) * 100)
      });

      await attendanceRecord.save();
      console.log(`📊 Attendance record created for ${participant.name}`);
      
      return attendanceRecord;
    } catch (error) {
      console.error('🚨 Generate attendance record error:', error);
      throw error;
    }
  }

  // Process webhook events
  async processWebhook(eventType, eventData) {
    try {
      console.log(`📡 Processing webhook: ${eventType}`);
      
      const meetingId = eventData.object?.id?.toString();
      if (!meetingId) {
        console.warn('No meeting ID in webhook data');
        return;
      }

      const meeting = await ZoomMeeting.findOne({ meetingId });
      if (!meeting) {
        console.warn(`Meeting ${meetingId} not found in database`);
        return;
      }

      // Store webhook event
      meeting.webhookEvents.push({
        eventType,
        eventData,
        timestamp: new Date()
      });

      switch (eventType) {
        case 'meeting.started':
          meeting.status = 'started';
          meeting.actualStartTime = new Date(eventData.object.start_time);
          break;

        case 'meeting.ended':
          meeting.status = 'ended';
          meeting.actualEndTime = new Date(eventData.object.end_time);
          if (meeting.actualStartTime) {
            meeting.actualDuration = Math.round(
              (meeting.actualEndTime - meeting.actualStartTime) / (1000 * 60)
            );
          }
          break;

        case 'meeting.participant_joined':
          await this.trackParticipantJoin(meetingId, eventData.object.participant);
          break;

        case 'meeting.participant_left':
          await this.trackParticipantLeave(meetingId, eventData.object.participant);
          break;
      }

      await meeting.save();
      console.log(`✅ Webhook processed: ${eventType} for meeting ${meetingId}`);
      
    } catch (error) {
      console.error('🚨 Webhook processing error:', error);
      throw error;
    }
  }
}

module.exports = new ZoomService();
