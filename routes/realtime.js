const express = require('express');
const { v4: uuidv4 } = require('uuid');
const moment = require('moment');

const router = express.Router();

// Import global state (will be set when server starts)
let globalState, io;

// Middleware to get IO instance and global state
router.use((req, res, next) => {
  if (!io) {
    io = req.app.get('io');
    // Try to get globalState from app first, then from server module
    globalState = req.app.get('globalState');
    if (!globalState) {
      try {
        const serverModule = require('../server');
        globalState = serverModule.globalState;
      } catch (error) {
        console.warn('Could not access globalState from server module');
      }
    }
  }
  next();
});

// Create or update meeting
router.post('/meeting', (req, res) => {
  try {
    const meetingData = {
      id: req.body.id || uuidv4(),
      topic: req.body.topic,
      startTime: req.body.startTime || new Date().toISOString(),
      duration: req.body.duration || 60,
      host: req.body.host,
      status: 'active',
      createdAt: new Date().toISOString(),
      ...req.body
    };

    // Store in global state
    globalState.activeMeetings.set(meetingData.id, meetingData);
    globalState.meetingAnalytics.totalMeetings++;
    globalState.meetingAnalytics.activeNow = globalState.activeMeetings.size;

    // Emit to all connected clients
    io.emit('meetingCreated', {
      meeting: meetingData,
      timestamp: new Date().toISOString()
    });

    // Send notification
    const notification = {
      id: Date.now(),
      type: 'meeting_created',
      title: '🎥 New Meeting Created',
      message: `Meeting "${meetingData.topic}" has been created`,
      timestamp: new Date().toISOString(),
      meetingId: meetingData.id
    };

    globalState.notifications.push(notification);
    io.emit('notification', notification);

    res.json({
      success: true,
      meeting: meetingData,
      message: 'Meeting created successfully'
    });
  } catch (error) {
    console.error('Error creating meeting:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Get active meetings
router.get('/meetings', (req, res) => {
  try {
    const meetings = Array.from(globalState.activeMeetings.values());
    res.json({
      success: true,
      meetings,
      count: meetings.length
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Get meeting details with real-time data
router.get('/meeting/:meetingId', (req, res) => {
  try {
    const { meetingId } = req.params;
    const meeting = globalState.activeMeetings.get(meetingId);
    
    if (!meeting) {
      return res.status(404).json({
        success: false,
        error: 'Meeting not found'
      });
    }

    const participants = Array.from(globalState.activeParticipants.values())
      .filter(p => p.meetingId === meetingId);

    const analytics = {
      totalParticipants: participants.length,
      activeParticipants: participants.filter(p => p.isActive).length,
      attendanceRate: participants.length > 0 
        ? Math.round((participants.filter(p => p.attendancePercentage >= 75).length / participants.length) * 100)
        : 0,
      averageAttendance: participants.length > 0
        ? Math.round(participants.reduce((sum, p) => sum + (p.attendancePercentage || 0), 0) / participants.length)
        : 0
    };

    res.json({
      success: true,
      meeting,
      participants,
      analytics
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Track participant activity
router.post('/participant/track', (req, res) => {
  try {
    const participantData = {
      id: req.body.id || uuidv4(),
      meetingId: req.body.meetingId,
      name: req.body.name,
      email: req.body.email,
      joinTime: req.body.joinTime || new Date().toISOString(),
      isActive: true,
      attendanceStatus: req.body.attendanceStatus || 'In Progress',
      attendancePercentage: req.body.attendancePercentage || 0,
      duration: req.body.duration || 0,
      lastUpdate: new Date().toISOString(),
      ...req.body
    };

    // Store in global state
    globalState.activeParticipants.set(participantData.id, participantData);
    globalState.meetingAnalytics.totalParticipants = globalState.activeParticipants.size;

    // Emit real-time update
    io.to(`meeting_${participantData.meetingId}`).emit('participantJoined', {
      participant: participantData,
      timestamp: new Date().toISOString()
    });

    // Global broadcast
    io.emit('participantUpdate', {
      participant: participantData,
      timestamp: new Date().toISOString()
    });

    // Send notification
    const notification = {
      id: Date.now(),
      type: 'participant_joined',
      title: '👋 Participant Joined',
      message: `${participantData.name} joined the meeting`,
      timestamp: new Date().toISOString(),
      meetingId: participantData.meetingId
    };

    globalState.notifications.push(notification);
    io.emit('notification', notification);

    res.json({
      success: true,
      participant: participantData,
      message: 'Participant tracked successfully'
    });
  } catch (error) {
    console.error('Error tracking participant:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Update participant status
router.put('/participant/:participantId', (req, res) => {
  try {
    const { participantId } = req.params;
    const existingParticipant = globalState.activeParticipants.get(participantId);
    
    if (!existingParticipant) {
      return res.status(404).json({
        success: false,
        error: 'Participant not found'
      });
    }

    const updatedParticipant = {
      ...existingParticipant,
      ...req.body,
      lastUpdate: new Date().toISOString()
    };

    globalState.activeParticipants.set(participantId, updatedParticipant);

    // Emit real-time update
    io.to(`meeting_${updatedParticipant.meetingId}`).emit('participantStatusUpdate', {
      participant: updatedParticipant,
      timestamp: new Date().toISOString()
    });

    // Send notification for status changes
    if (req.body.attendanceStatus && req.body.attendanceStatus !== existingParticipant.attendanceStatus) {
      const notification = {
        id: Date.now(),
        type: 'status_change',
        title: '📊 Status Update',
        message: `${updatedParticipant.name} status changed to ${req.body.attendanceStatus}`,
        timestamp: new Date().toISOString(),
        meetingId: updatedParticipant.meetingId
      };

      globalState.notifications.push(notification);
      io.emit('notification', notification);
    }

    res.json({
      success: true,
      participant: updatedParticipant,
      message: 'Participant updated successfully'
    });
  } catch (error) {
    console.error('Error updating participant:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Remove participant
router.delete('/participant/:participantId', (req, res) => {
  try {
    const { participantId } = req.params;
    const participant = globalState.activeParticipants.get(participantId);
    
    if (!participant) {
      return res.status(404).json({
        success: false,
        error: 'Participant not found'
      });
    }

    globalState.activeParticipants.delete(participantId);
    globalState.meetingAnalytics.totalParticipants = globalState.activeParticipants.size;

    // Emit real-time update
    io.to(`meeting_${participant.meetingId}`).emit('participantLeft', {
      participant: { ...participant, isActive: false },
      timestamp: new Date().toISOString()
    });

    // Send notification
    const notification = {
      id: Date.now(),
      type: 'participant_left',
      title: '👋 Participant Left',
      message: `${participant.name} left the meeting`,
      timestamp: new Date().toISOString(),
      meetingId: participant.meetingId
    };

    globalState.notifications.push(notification);
    io.emit('notification', notification);

    res.json({
      success: true,
      message: 'Participant removed successfully'
    });
  } catch (error) {
    console.error('Error removing participant:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// End meeting
router.post('/meeting/:meetingId/end', (req, res) => {
  try {
    const { meetingId } = req.params;
    const meeting = globalState.activeMeetings.get(meetingId);
    
    if (!meeting) {
      return res.status(404).json({
        success: false,
        error: 'Meeting not found'
      });
    }

    // Update meeting status
    meeting.status = 'ended';
    meeting.endTime = new Date().toISOString();
    
    // Get all participants for this meeting
    const participants = Array.from(globalState.activeParticipants.values())
      .filter(p => p.meetingId === meetingId);

    // Mark all participants as inactive
    participants.forEach(participant => {
      participant.isActive = false;
      participant.leaveTime = new Date().toISOString();
      globalState.activeParticipants.set(participant.id, participant);
    });

    // Remove from active meetings
    globalState.activeMeetings.delete(meetingId);
    globalState.meetingAnalytics.activeNow = globalState.activeMeetings.size;

    // Emit meeting ended event
    io.to(`meeting_${meetingId}`).emit('meetingEnded', {
      meeting,
      participants,
      timestamp: new Date().toISOString()
    });

    // Send global notification
    const notification = {
      id: Date.now(),
      type: 'meeting_ended',
      title: '🔚 Meeting Ended',
      message: `Meeting "${meeting.topic}" has ended`,
      timestamp: new Date().toISOString(),
      meetingId
    };

    globalState.notifications.push(notification);
    io.emit('notification', notification);

    res.json({
      success: true,
      meeting,
      participants,
      message: 'Meeting ended successfully'
    });
  } catch (error) {
    console.error('Error ending meeting:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Get real-time analytics
router.get('/analytics/:meetingId', (req, res) => {
  try {
    const { meetingId } = req.params;
    const meeting = globalState.activeMeetings.get(meetingId);
    
    if (!meeting) {
      return res.status(404).json({
        success: false,
        error: 'Meeting not found'
      });
    }

    const participants = Array.from(globalState.activeParticipants.values())
      .filter(p => p.meetingId === meetingId);

    const analytics = {
      meetingId,
      meetingTopic: meeting.topic,
      startTime: meeting.startTime,
      duration: meeting.duration,
      status: meeting.status,
      totalParticipants: participants.length,
      activeParticipants: participants.filter(p => p.isActive).length,
      presentCount: participants.filter(p => p.attendanceStatus === 'Present').length,
      inProgressCount: participants.filter(p => p.attendanceStatus === 'In Progress').length,
      leftEarlyCount: participants.filter(p => p.attendanceStatus === 'Left Early').length,
      absentCount: participants.filter(p => p.attendanceStatus === 'Absent').length,
      attendanceRate: participants.length > 0 
        ? Math.round((participants.filter(p => p.attendancePercentage >= 75).length / participants.length) * 100)
        : 0,
      averageAttendance: participants.length > 0
        ? Math.round(participants.reduce((sum, p) => sum + (p.attendancePercentage || 0), 0) / participants.length)
        : 0,
      averageDuration: participants.length > 0
        ? Math.round(participants.reduce((sum, p) => sum + (p.duration || 0), 0) / participants.length)
        : 0,
      participantDetails: participants.map(p => ({
        id: p.id,
        name: p.name,
        email: p.email,
        joinTime: p.joinTime,
        isActive: p.isActive,
        attendanceStatus: p.attendanceStatus,
        attendancePercentage: p.attendancePercentage,
        duration: p.duration
      })),
      lastUpdate: new Date().toISOString()
    };

    res.json({
      success: true,
      analytics
    });
  } catch (error) {
    console.error('Error getting analytics:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Get global analytics
router.get('/analytics', (req, res) => {
  try {
    const analytics = {
      totalMeetings: globalState.meetingAnalytics.totalMeetings,
      activeMeetings: globalState.activeMeetings.size,
      totalParticipants: globalState.activeParticipants.size,
      activeParticipants: Array.from(globalState.activeParticipants.values())
        .filter(p => p.isActive).length,
      meetingsList: Array.from(globalState.activeMeetings.values()).map(m => ({
        id: m.id,
        topic: m.topic,
        startTime: m.startTime,
        participantCount: Array.from(globalState.activeParticipants.values())
          .filter(p => p.meetingId === m.id).length
      })),
      recentNotifications: globalState.notifications.slice(-10),
      lastUpdate: new Date().toISOString()
    };

    res.json({
      success: true,
      analytics
    });
  } catch (error) {
    console.error('Error getting global analytics:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Get notifications
router.get('/notifications', (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 50;
    const notifications = globalState.notifications.slice(-limit);
    
    res.json({
      success: true,
      notifications,
      count: notifications.length,
      total: globalState.notifications.length
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Clear notifications
router.delete('/notifications', (req, res) => {
  try {
    globalState.notifications = [];
    
    // Notify all clients
    io.emit('notificationsCleared', {
      timestamp: new Date().toISOString()
    });

    res.json({
      success: true,
      message: 'All notifications cleared'
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Track link clicks from frontend
router.post('/track-link-click', (req, res) => {
  try {
    const clickData = {
      ...req.body,
      id: uuidv4(),
      serverTimestamp: new Date().toISOString()
    };

    // Send real-time notification
    const notification = {
      id: Date.now(),
      type: 'link_click',
      title: '🔗 Zoom Link Clicked',
      message: `${clickData.name} clicked the Zoom link for "${clickData.meetingTopic}"`,
      timestamp: new Date().toISOString(),
      meetingId: clickData.meetingId
    };

    globalState.notifications.push(notification);
    io.emit('notification', notification);

    // Broadcast link click event
    io.emit('linkClicked', {
      clickData,
      timestamp: new Date().toISOString()
    });

    res.json({
      success: true,
      clickData,
      message: 'Link click tracked successfully'
    });
  } catch (error) {
    console.error('Error tracking link click:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

module.exports = router;
