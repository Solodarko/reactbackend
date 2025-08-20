const express = require('express');
const router = express.Router();
const moment = require('moment');
const ZoomMeeting = require('../models/ZoomMeeting');
const ZoomAttendance = require('../models/ZoomAttendance');
const mongoose = require('mongoose');

// Helper function to generate unique meeting ID
const generateMeetingId = () => {
  return Math.floor(Math.random() * 900000000) + 100000000; // 9-digit number
};

// Helper function to generate UUID
const generateUUID = () => {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
    const r = Math.random() * 16 | 0;
    const v = c === 'x' ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
};

// Helper function to calculate duration
const calculateDuration = (start, end) => {
  const diffMs = new Date(end) - new Date(start);
  const diffMins = Math.round(diffMs / (1000 * 60));
  const hours = Math.floor(diffMins / 60);
  const mins = diffMins % 60;
  
  if (hours > 0) {
    return `${hours}h ${mins}m`;
  }
  return `${mins} min`;
};

// GET /api/meetings - Get all meetings
router.get('/', async (req, res) => {
  try {
    const { status, type } = req.query;
    
    let query = {};
    
    // Filter by status if provided
    if (status) {
      query.status = status;
    }
    
    // Filter by type if provided (assuming we map type to Zoom meeting type)
    if (type) {
      query['metadata.meetingType'] = type;
    }
    
    const meetings = await ZoomMeeting.find(query)
      .sort({ createdAt: -1 })
      .lean();
    
    // Transform data to match frontend expectations
    const transformedMeetings = meetings.map(meeting => ({
      id: meeting._id,
      title: meeting.topic,
      description: meeting.metadata?.description || '',
      startTime: meeting.startTime,
      endTime: meeting.endTime,
      type: meeting.metadata?.meetingType || 'online',
      status: meeting.status === 'waiting' ? 'scheduled' : 
              meeting.status === 'started' ? 'in-progress' : 'completed',
      participants: meeting.participants.map(p => p.name).filter(Boolean),
      location: meeting.metadata?.location || (meeting.joinUrl ? 'Zoom Meeting' : 'Unknown'),
      organizer: meeting.hostEmail,
      attendanceRate: meeting.attendanceRate || 0,
      duration: `${meeting.duration} min`,
      agenda: meeting.metadata?.agenda || '',
      createdAt: meeting.createdAt,
      updatedAt: meeting.updatedAt
    }));
    
    res.json({
      success: true,
      data: transformedMeetings,
      total: transformedMeetings.length
    });
  } catch (error) {
    console.error('Error fetching meetings:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch meetings',
      error: error.message
    });
  }
});

// GET /api/meetings/:id - Get a specific meeting
router.get('/:id', async (req, res) => {
  try {
    const meetingId = req.params.id;
    
    if (!mongoose.isValidObjectId(meetingId)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid meeting ID format'
      });
    }
    
    const meeting = await ZoomMeeting.findById(meetingId)
      .lean();
    
    if (!meeting) {
      return res.status(404).json({
        success: false,
        message: 'Meeting not found'
      });
    }
    
    // Transform data to match frontend expectations
    const transformedMeeting = {
      id: meeting._id,
      title: meeting.topic,
      description: meeting.metadata?.description || '',
      startTime: meeting.startTime,
      endTime: meeting.endTime,
      type: meeting.metadata?.meetingType || 'online',
      status: meeting.status === 'waiting' ? 'scheduled' : 
              meeting.status === 'started' ? 'in-progress' : 'completed',
      participants: meeting.participants.map(p => p.name).filter(Boolean),
      location: meeting.metadata?.location || (meeting.joinUrl ? 'Zoom Meeting' : 'Unknown'),
      organizer: meeting.hostEmail,
      attendanceRate: meeting.attendanceRate || 0,
      duration: `${meeting.duration} min`,
      agenda: meeting.metadata?.agenda || '',
      createdAt: meeting.createdAt,
      updatedAt: meeting.updatedAt
    };
    
    res.json({
      success: true,
      data: transformedMeeting
    });
  } catch (error) {
    console.error('Error fetching meeting:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch meeting',
      error: error.message
    });
  }
});

// POST /api/meetings - Create a new meeting
router.post('/', async (req, res) => {
  try {
    const {
      title,
      description,
      startTime,
      endTime,
      type,
      participants,
      location,
      organizer,
      agenda
    } = req.body;
    
    // Validation
    if (!title || !startTime || !endTime) {
      return res.status(400).json({
        success: false,
        message: 'Title, start time, and end time are required'
      });
    }
    
    // Parse participants if it's a string
    let participantsList = participants;
    if (typeof participants === 'string') {
      participantsList = participants.split(',').map(p => p.trim()).filter(p => p);
    }
    
    // Calculate duration in minutes
    const durationInMs = new Date(endTime) - new Date(startTime);
    const durationInMinutes = Math.round(durationInMs / (1000 * 60));
    
    // Create new ZoomMeeting document
    const newMeetingData = {
      meetingId: generateMeetingId().toString(),
      meetingUuid: generateUUID(),
      topic: title,
      hostId: organizer || 'system',
      hostEmail: organizer || 'system@example.com',
      type: 2, // Scheduled meeting
      status: 'waiting',
      startTime: new Date(startTime),
      endTime: new Date(endTime),
      duration: durationInMinutes,
      timezone: 'UTC',
      joinUrl: `https://zoom.us/j/${generateMeetingId()}`,
      startUrl: `https://zoom.us/s/${generateMeetingId()}`,
      settings: {
        hostVideo: true,
        participantVideo: false,
        joinBeforeHost: false,
        muteUponEntry: true,
        waitingRoom: true,
        autoRecording: 'none'
      },
      participants: participantsList.map(name => ({
        name,
        email: '',
        status: 'joined',
        isMatched: false
      })),
      metadata: {
        description: description || '',
        meetingType: type || 'online',
        location: location || '',
        agenda: agenda || '',
        createdBy: organizer || 'system'
      }
    };
    
    const meeting = new ZoomMeeting(newMeetingData);
    await meeting.save();
    
    // Transform data to match frontend expectations
    const transformedMeeting = {
      id: meeting._id,
      title: meeting.topic,
      description: meeting.metadata.description,
      startTime: meeting.startTime,
      endTime: meeting.endTime,
      type: meeting.metadata.meetingType,
      status: 'scheduled',
      participants: participantsList,
      location: meeting.metadata.location,
      organizer: meeting.hostEmail,
      attendanceRate: 0,
      duration: `${meeting.duration} min`,
      agenda: meeting.metadata.agenda,
      createdAt: meeting.createdAt,
      updatedAt: meeting.updatedAt
    };
    
    res.status(201).json({
      success: true,
      message: 'Meeting created successfully',
      data: transformedMeeting
    });
  } catch (error) {
    console.error('Error creating meeting:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to create meeting',
      error: error.message
    });
  }
});

// PUT /api/meetings/:id - Update a meeting
router.put('/:id', async (req, res) => {
  try {
    const meetingId = req.params.id;
    
    if (!mongoose.isValidObjectId(meetingId)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid meeting ID format'
      });
    }
    
    const {
      title,
      description,
      startTime,
      endTime,
      type,
      participants,
      location,
      organizer,
      agenda
    } = req.body;
    
    // Parse participants if it's a string
    let participantsList = participants;
    if (typeof participants === 'string') {
      participantsList = participants.split(',').map(p => p.trim()).filter(p => p);
    }
    
    // Prepare update data
    const updateData = {};
    
    if (title) updateData.topic = title;
    if (startTime) updateData.startTime = new Date(startTime);
    if (endTime) updateData.endTime = new Date(endTime);
    if (organizer) updateData.hostEmail = organizer;
    
    // Calculate new duration if both times provided
    if (startTime && endTime) {
      const durationInMs = new Date(endTime) - new Date(startTime);
      updateData.duration = Math.round(durationInMs / (1000 * 60));
    }
    
    // Update metadata
    const metadataUpdates = {};
    if (description !== undefined) metadataUpdates['metadata.description'] = description;
    if (type) metadataUpdates['metadata.meetingType'] = type;
    if (location !== undefined) metadataUpdates['metadata.location'] = location;
    if (agenda !== undefined) metadataUpdates['metadata.agenda'] = agenda;
    
    // Update participants
    if (participantsList !== undefined) {
      updateData.participants = participantsList.map(name => ({
        name,
        email: '',
        status: 'joined',
        isMatched: false
      }));
    }
    
    const meeting = await ZoomMeeting.findByIdAndUpdate(
      meetingId,
      { ...updateData, ...metadataUpdates },
      { new: true, runValidators: true }
    );
    
    if (!meeting) {
      return res.status(404).json({
        success: false,
        message: 'Meeting not found'
      });
    }
    
    // Transform data to match frontend expectations
    const transformedMeeting = {
      id: meeting._id,
      title: meeting.topic,
      description: meeting.metadata?.description || '',
      startTime: meeting.startTime,
      endTime: meeting.endTime,
      type: meeting.metadata?.meetingType || 'online',
      status: meeting.status === 'waiting' ? 'scheduled' : 
              meeting.status === 'started' ? 'in-progress' : 'completed',
      participants: meeting.participants.map(p => p.name).filter(Boolean),
      location: meeting.metadata?.location || '',
      organizer: meeting.hostEmail,
      attendanceRate: meeting.attendanceRate || 0,
      duration: `${meeting.duration} min`,
      agenda: meeting.metadata?.agenda || '',
      createdAt: meeting.createdAt,
      updatedAt: meeting.updatedAt
    };
    
    res.json({
      success: true,
      message: 'Meeting updated successfully',
      data: transformedMeeting
    });
  } catch (error) {
    console.error('Error updating meeting:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update meeting',
      error: error.message
    });
  }
});

// DELETE /api/meetings/:id - Delete a meeting
router.delete('/:id', async (req, res) => {
  try {
    const meetingId = req.params.id;
    
    if (!mongoose.isValidObjectId(meetingId)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid meeting ID format'
      });
    }
    
    const meeting = await ZoomMeeting.findByIdAndDelete(meetingId);
    
    if (!meeting) {
      return res.status(404).json({
        success: false,
        message: 'Meeting not found'
      });
    }
    
    // Transform deleted meeting data
    const transformedMeeting = {
      id: meeting._id,
      title: meeting.topic,
      description: meeting.metadata?.description || '',
      startTime: meeting.startTime,
      endTime: meeting.endTime,
      type: meeting.metadata?.meetingType || 'online',
      status: meeting.status === 'waiting' ? 'scheduled' : 
              meeting.status === 'started' ? 'in-progress' : 'completed',
      participants: meeting.participants.map(p => p.name).filter(Boolean),
      location: meeting.metadata?.location || '',
      organizer: meeting.hostEmail,
      attendanceRate: meeting.attendanceRate || 0,
      duration: `${meeting.duration} min`,
      agenda: meeting.metadata?.agenda || ''
    };
    
    res.json({
      success: true,
      message: 'Meeting deleted successfully',
      data: transformedMeeting
    });
  } catch (error) {
    console.error('Error deleting meeting:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to delete meeting',
      error: error.message
    });
  }
});

// GET /api/meetings/:id/participants - Get participants for a specific meeting
router.get('/:id/participants', async (req, res) => {
  try {
    const meetingId = req.params.id;
    
    if (!mongoose.isValidObjectId(meetingId)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid meeting ID format'
      });
    }
    
    // Find the meeting first to get meetingId for ZoomAttendance lookup
    const meeting = await ZoomMeeting.findById(meetingId).lean();
    
    if (!meeting) {
      return res.status(404).json({
        success: false,
        message: 'Meeting not found'
      });
    }
    
    // Calculate meeting duration for attendance calculation
    const meetingStartTime = meeting.startTime ? new Date(meeting.startTime) : new Date();
    const meetingEndTime = meeting.endTime ? new Date(meeting.endTime) : new Date();
    const totalMeetingDuration = Math.max(
      Math.round((meetingEndTime.getTime() - meetingStartTime.getTime()) / (1000 * 60)),
      1 // Minimum 1 minute to avoid division by zero
    );
    
    // Get attendance data using the meeting ID
    let participants = [];
    let attendanceStats = {
      total: 0,
      present: 0,
      partial: 0,
      late: 0,
      absent: 0,
      inProgress: 0
    };
    
    try {
      const attendanceData = await ZoomAttendance.getAttendanceSummary(meeting.meetingId);
      
      if (attendanceData && attendanceData.participants) {
        // Process each participant to calculate proper attendance status
        participants = attendanceData.participants.map(participant => {
          const joinTime = participant.joinTime ? new Date(participant.joinTime) : null;
          const leaveTime = participant.leaveTime ? new Date(participant.leaveTime) : null;
          const isActive = !leaveTime;
          
          // Calculate participant duration
          let participantDuration = 0;
          if (joinTime) {
            const endTime = leaveTime || new Date();
            participantDuration = Math.max(
              Math.round((endTime.getTime() - joinTime.getTime()) / (1000 * 60)),
              0
            );
          }
          
          // Calculate attendance percentage
          const attendancePercentage = totalMeetingDuration > 0 
            ? Math.min(Math.round((participantDuration / totalMeetingDuration) * 100), 100)
            : 0;
          
          // Determine attendance status based on percentage and activity
          let attendanceStatus = 'Absent';
          if (isActive && participantDuration > 0) {
            attendanceStatus = 'In Progress';
          } else if (attendancePercentage >= 90) {
            attendanceStatus = 'Present';
          } else if (attendancePercentage >= 70) {
            attendanceStatus = 'Partial';
          } else if (attendancePercentage >= 30) {
            attendanceStatus = 'Late';
          }
          
          return {
            id: participant._id,
            name: participant.participantName || 'Unknown',
            email: participant.participantEmail || '',
            joinTime: participant.joinTime,
            leaveTime: participant.leaveTime,
            duration: participantDuration,
            attendanceStatus: attendanceStatus,
            attendancePercentage: attendancePercentage,
            isActive: isActive,
            isMatched: participant.isMatched || false,
            student: participant.student ? {
              id: participant.student.StudentID,
              firstName: participant.student.FirstName,
              lastName: participant.student.LastName,
              email: participant.student.Email,
              department: participant.student.Department
            } : null,
            source: participant.source || 'unknown',
            isReconciled: participant.isReconciled || false,
            connectionStatus: participant.connectionStatus || 'unknown',
            zoomUserId: participant.zoomUserId,
            participantUuid: participant.participantUuid,
            metadata: participant.metadata || {}
          };
        });
        
        // Calculate attendance statistics
        attendanceStats = {
          total: participants.length,
          present: participants.filter(p => p.attendanceStatus === 'Present').length,
          partial: participants.filter(p => p.attendanceStatus === 'Partial').length,
          late: participants.filter(p => p.attendanceStatus === 'Late').length,
          absent: participants.filter(p => p.attendanceStatus === 'Absent').length,
          inProgress: participants.filter(p => p.attendanceStatus === 'In Progress').length
        };
      }
    } catch (attendanceError) {
      console.warn('Failed to get attendance data, returning empty participants list:', attendanceError.message);
      participants = [];
    }
    
    res.json({
      success: true,
      data: {
        meetingId: meeting.meetingId,
        meetingTitle: meeting.topic,
        meetingStatus: meeting.status,
        meetingDuration: totalMeetingDuration,
        attendanceStats: attendanceStats,
        participants: participants
      }
    });
  } catch (error) {
    console.error('Error fetching meeting participants:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch meeting participants',
      error: error.message
    });
  }
});

// GET /api/meetings/stats/analytics - Get meeting analytics
router.get('/stats/analytics', async (req, res) => {
  try {
    const totalMeetings = await ZoomMeeting.countDocuments();
    const completedMeetings = await ZoomMeeting.countDocuments({ status: 'ended' });
    const scheduledMeetings = await ZoomMeeting.countDocuments({ status: 'waiting' });
    const inProgress = await ZoomMeeting.countDocuments({ status: 'started' });
    
    // Calculate average attendance from completed meetings
    const avgAttendanceResult = await ZoomMeeting.aggregate([
      { $match: { status: 'ended' } },
      {
        $group: {
          _id: null,
          avgAttendance: { $avg: "$attendanceRate" }
        }
      }
    ]);
    
    const avgAttendance = avgAttendanceResult.length > 0 
      ? Math.round(avgAttendanceResult[0].avgAttendance)
      : 0;
    
    // Get recent meetings
    const recentMeetings = await ZoomMeeting.find()
      .sort({ createdAt: -1 })
      .limit(5)
      .lean();
    
    // Get upcoming meetings
    const upcomingMeetings = await ZoomMeeting.find({
      status: 'waiting',
      startTime: { $gt: new Date() }
    })
    .sort({ startTime: 1 })
    .limit(3)
    .lean();
    
    // Transform meetings data
    const transformedRecentMeetings = recentMeetings.map(meeting => ({
      id: meeting._id,
      title: meeting.topic,
      status: meeting.status === 'waiting' ? 'scheduled' : 
              meeting.status === 'started' ? 'in-progress' : 'completed',
      startTime: meeting.startTime,
      attendanceRate: meeting.attendanceRate || 0
    }));
    
    const transformedUpcomingMeetings = upcomingMeetings.map(meeting => ({
      id: meeting._id,
      title: meeting.topic,
      startTime: meeting.startTime,
      duration: `${meeting.duration} min`
    }));
    
    res.json({
      success: true,
      data: {
        totalMeetings,
        completed: completedMeetings,
        scheduled: scheduledMeetings,
        inProgress: inProgress,
        cancelled: 0, // We don't track cancelled status in current schema
        averageAttendance: avgAttendance,
        recentMeetings: transformedRecentMeetings,
        upcomingMeetings: transformedUpcomingMeetings
      }
    });
  } catch (error) {
    console.error('Error fetching meeting analytics:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch meeting analytics',
      error: error.message
    });
  }
});

module.exports = router;
