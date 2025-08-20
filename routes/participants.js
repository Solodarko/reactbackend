const express = require('express');
const Participant = require('../models/Participant');
const Student = require('../models/Student');
const User = require('../models/User');
const Attendance = require('../models/Attendance');

const router = express.Router();

// GET all participants with populated user data
router.get("/", async (req, res) => {
  try {
    const { meetingId, active } = req.query;
    
    let query = {};
    if (meetingId) query.meetingId = meetingId;
    if (active !== undefined) query.isActive = active === 'true';
    
    const participants = await Participant.find(query)
      .populate('userId', 'firstName lastName email')
      .populate('studentId', 'FirstName LastName Email StudentID Department')
      .sort({ joinTime: -1 });
      
    res.json(participants);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET participant by ID with full details
router.get("/:id", async (req, res) => {
  try {
    const participant = await Participant.findById(req.params.id)
      .populate('userId', 'firstName lastName email')
      .populate('studentId', 'FirstName LastName Email StudentID Department');
      
    if (!participant) {
      return res.status(404).json({ error: 'Participant not found' });
    }
    
    res.json(participant);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST - Track when user joins Zoom meeting
router.post("/join-meeting", async (req, res) => {
  try {
    const {
      participantName,
      participantId,
      zoomUserId,
      meetingId,
      meetingTopic,
      email,
      device,
      userToken, // JWT token from authenticated user
      // Direct student fields from frontend
      studentId: directStudentId,
      studentFirstName,
      studentLastName,
      studentDepartment,
      studentEmail
    } = req.body;
    
    const io = req.app.get('io');
    
    // Try to identify the user from token or email
    let userId = null;
    let studentId = null;
    let userType = 'unknown';
    
    // If user is authenticated, get their ID from token
    if (userToken) {
      try {
        const jwt = require('jsonwebtoken');
        const decoded = jwt.verify(userToken, process.env.JWT_SECRET);
        userId = decoded.id;
        userType = decoded.role || 'student';
      } catch (error) {
        console.log('Invalid token, treating as guest');
      }
    }
    
    // Use direct student ID if provided from frontend validation
    if (directStudentId) {
      studentId = directStudentId;
      userType = 'student';
    }
    
    // Try to match with existing student by email (fallback)
    if (email && !userId && !studentId) {
      const student = await Student.findOne({ Email: email });
      if (student) {
        studentId = student.StudentID;
        userType = 'student';
      }
    }
    
    // Check if participant already exists in this meeting
    let participant = await Participant.findOne({
      meetingId,
      $or: [
        { participantId },
        { zoomUserId },
        { email }
      ]
    });
    
    if (participant) {
      // Handle reconnection
      if (!participant.isActive) {
        // Add previous session to history
        if (participant.joinTime && participant.leaveTime) {
          const sessionDuration = (participant.leaveTime - participant.joinTime) / (1000 * 60);
          participant.sessions.push({
            joinTime: participant.joinTime,
            leaveTime: participant.leaveTime,
            duration: Math.round(sessionDuration),
            reason: 'left'
          });
        }
        
        // Start new session
        participant.joinTime = new Date();
        participant.leaveTime = null;
        participant.isActive = true;
        participant.connectionStatus = 'reconnected';
        participant.lastActivity = new Date();
        
        await participant.save();
        
        // Emit reconnection event
        if (io) {
          io.to(`meeting_${meetingId}`).emit('participantReconnected', {
            participant,
            timestamp: new Date().toISOString()
          });
        }
      } else {
        // Update last activity for existing active participant
        participant.lastActivity = new Date();
        await participant.save();
      }
    } else {
      // Create new participant record
      participant = new Participant({
        participantName,
        participantId,
        zoomUserId,
        userId,
        studentId,
        // Store direct student fields for easier access
        studentFirstName,
        studentLastName,
        studentDepartment,
        studentEmail,
        meetingId,
        meetingTopic,
        joinTime: new Date(),
        email,
        userType,
        device,
        connectionStatus: 'joined',
        isActive: true,
        lastActivity: new Date()
      });
      
      await participant.save();
      
      // Emit new participant event
      if (io) {
        io.to(`meeting_${meetingId}`).emit('participantJoined', {
          participant,
          timestamp: new Date().toISOString()
        });
        
        // Send notification
        const notification = {
          id: Date.now(),
          type: 'participant_joined',
          title: '👤 New Participant',
          message: `${participantName} joined the meeting`,
          timestamp: new Date().toISOString(),
          meetingId
        };
        
        io.emit('notification', notification);
      }
    }
    
    // Populate the response
    await participant.populate('userId', 'firstName lastName email');
    await participant.populate('studentId', 'FirstName LastName Email StudentID Department');
    
    res.json({
      success: true,
      participant,
      message: participant.connectionStatus === 'reconnected' ? 'Participant reconnected' : 'Participant joined'
    });
    
  } catch (err) {
    console.error('Error tracking participant join:', err);
    res.status(500).json({ error: err.message });
  }
});

// POST - Track when user leaves Zoom meeting
router.post("/leave-meeting", async (req, res) => {
  try {
    const {
      participantId,
      meetingId,
      reason = 'left'
    } = req.body;
    
    const io = req.app.get('io');
    
    const participant = await Participant.findOne({
      participantId,
      meetingId,
      isActive: true
    });
    
    if (!participant) {
      return res.status(404).json({ error: 'Active participant not found' });
    }
    
    // Calculate session duration
    const leaveTime = new Date();
    const duration = (leaveTime - participant.joinTime) / (1000 * 60); // minutes
    
    // Update participant
    participant.leaveTime = leaveTime;
    participant.duration = Math.round(duration);
    participant.isActive = false;
    participant.connectionStatus = reason === 'disconnected' ? 'disconnected' : 'left';
    participant.lastActivity = leaveTime;
    
    await participant.save();
    
    // Emit participant left event
    if (io) {
      io.to(`meeting_${meetingId}`).emit('participantLeft', {
        participant,
        reason,
        timestamp: leaveTime.toISOString()
      });
    }
    
    res.json({
      success: true,
      participant,
      duration: Math.round(duration),
      message: 'Participant leave tracked'
    });
    
  } catch (err) {
    console.error('Error tracking participant leave:', err);
    res.status(500).json({ error: err.message });
  }
});

// PUT - Update participant status (audio, video, etc.)
router.put("/update-status/:id", async (req, res) => {
  try {
    const {
      audioStatus,
      videoStatus,
      sharingScreen,
      handRaised,
      attendanceStatus
    } = req.body;
    
    const participant = await Participant.findById(req.params.id);
    
    if (!participant) {
      return res.status(404).json({ error: 'Participant not found' });
    }
    
    // Update status fields
    if (audioStatus !== undefined) participant.audioStatus = audioStatus;
    if (videoStatus !== undefined) participant.videoStatus = videoStatus;
    if (sharingScreen !== undefined) participant.sharingScreen = sharingScreen;
    if (handRaised !== undefined) participant.handRaised = handRaised;
    if (attendanceStatus) participant.attendanceStatus = attendanceStatus;
    
    participant.lastActivity = new Date();
    
    await participant.save();
    
    // Emit status update
    const io = req.app.get('io');
    if (io) {
      io.to(`meeting_${participant.meetingId}`).emit('participantStatusUpdate', {
        participant,
        timestamp: new Date().toISOString()
      });
    }
    
    res.json({
      success: true,
      participant,
      message: 'Participant status updated'
    });
    
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST - Automatically mark attendance based on participation
router.post("/mark-attendance/:meetingId", async (req, res) => {
  try {
    const { meetingId } = req.params;
    const { meetingDuration, attendanceThreshold = 75 } = req.body;
    
    const participants = await Participant.find({ meetingId })
      .populate('studentId', 'FirstName LastName Email StudentID');
    
    const attendanceRecords = [];
    
    for (const participant of participants) {
      if (participant.studentId) {
        const totalDuration = participant.calculateTotalDuration();
        const attendancePercentage = (totalDuration / meetingDuration) * 100;
        
        let status = 'Absent';
        if (attendancePercentage >= attendanceThreshold) {
          status = 'Present';
        } else if (attendancePercentage > 30) {
          status = 'Late';
        }
        
        // Update participant attendance status
        participant.attendanceStatus = status;
        await participant.save();
        
        // Create attendance record
        const attendanceRecord = new Attendance({
          StudentID: participant.studentId,
          Date: new Date(),
          Status: status,
          Remarks: `Meeting participation: ${Math.round(attendancePercentage)}% (${totalDuration}/${meetingDuration} min)`
        });
        
        await attendanceRecord.save();
        attendanceRecords.push(attendanceRecord);
      }
    }
    
    res.json({
      success: true,
      attendanceRecords,
      totalParticipants: participants.length,
      studentsMarked: attendanceRecords.length,
      message: 'Attendance marked successfully'
    });
    
  } catch (err) {
    console.error('Error marking attendance:', err);
    res.status(500).json({ error: err.message });
  }
});

// GET - Meeting analytics
router.get("/meeting/:meetingId/analytics", async (req, res) => {
  try {
    const { meetingId } = req.params;
    
    const participants = await Participant.find({ meetingId })
      .populate('userId', 'firstName lastName')
      .populate('studentId', 'FirstName LastName StudentID');
    
    const analytics = {
      totalParticipants: participants.length,
      activeParticipants: participants.filter(p => p.isActive).length,
      studentsCount: participants.filter(p => p.studentId).length,
      guestsCount: participants.filter(p => p.userType === 'guest').length,
      averageDuration: 0,
      attendanceByStatus: {
        Present: 0,
        Absent: 0,
        Late: 0,
        'Left Early': 0,
        Unknown: 0
      },
      engagementMetrics: {
        videoOn: participants.filter(p => p.videoStatus).length,
        audioOn: participants.filter(p => !p.audioStatus).length, // unmuted
        screenSharing: participants.filter(p => p.sharingScreen).length,
        handRaised: participants.filter(p => p.handRaised).length
      }
    };
    
    // Calculate average duration
    const totalDuration = participants.reduce((sum, p) => sum + p.calculateTotalDuration(), 0);
    analytics.averageDuration = participants.length > 0 ? Math.round(totalDuration / participants.length) : 0;
    
    // Count attendance by status
    participants.forEach(p => {
      analytics.attendanceByStatus[p.attendanceStatus]++;
    });
    
    res.json(analytics);
    
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST new participant (legacy endpoint)
router.post("/", async (req, res) => {
  try {
    const newParticipant = new Participant(req.body);
    await newParticipant.save();
    res.json(newParticipant);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT update participant (legacy endpoint)
router.put("/:id", async (req, res) => {
  try {
    const updated = await Participant.findByIdAndUpdate(
      req.params.id,
      req.body,
      { new: true }
    );
    res.json(updated);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE participant
router.delete("/:id", async (req, res) => {
  try {
    await Participant.findByIdAndDelete(req.params.id);
    res.sendStatus(204);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
