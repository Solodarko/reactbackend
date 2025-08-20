const mongoose = require('mongoose');

const zoomAttendanceSchema = new mongoose.Schema(
  {
    // Meeting identification
    meetingId: {
      type: String,
      required: true,
      index: true,
    },
    meetingUuid: {
      type: String,
      required: true,
      index: true,
    },
    meetingTopic: {
      type: String,
      required: true,
    },
    
    // Participant identification (with fallbacks)
    participantUuid: {
      type: String,
      required: true,
      index: true,
    },
    participantId: {
      type: String,
      required: false, // May not be available in all webhook events
    },
    participantName: {
      type: String,
      required: true,
    },
    participantEmail: {
      type: String,
      required: false,
      index: true,
    },
    zoomUserId: {
      type: String,
      required: false,
    },
    
    // Student matching
    studentId: {
      type: Number,
      ref: 'Student',
      required: false,
      index: true,
    },
    isMatched: {
      type: Boolean,
      default: false,
    },
    
    // Attendance times (from webhooks)
    joinTime: {
      type: Date,
      required: true,
    },
    leaveTime: {
      type: Date,
      required: false,
    },
    duration: {
      type: Number, // in seconds
      required: false,
    },
    
    // Status tracking
    attendanceStatus: {
      type: String,
      enum: ['Present', 'Absent', 'Late', 'Partial', 'In Progress'],
      default: 'In Progress',
    },
    connectionStatus: {
      type: String,
      enum: ['joined', 'left', 'in_meeting', 'admitted'],
      default: 'joined',
    },
    
    // Data sources and validation
    source: {
      type: String,
      enum: ['webhook', 'api_reconcile', 'manual'],
      default: 'webhook',
    },
    isReconciled: {
      type: Boolean,
      default: false,
    },
    reconciledAt: {
      type: Date,
      required: false,
    },
    
    // Webhook event tracking
    webhookEvents: [{
      eventType: {
        type: String,
        enum: ['meeting.participant_joined', 'meeting.participant_left', 'meeting.ended'],
        required: true,
      },
      timestamp: {
        type: Date,
        default: Date.now,
      },
      eventData: mongoose.Schema.Types.Mixed,
      processed: {
        type: Boolean,
        default: true,
      }
    }],
    
    // Additional metadata
    metadata: {
      userAgent: String,
      ipAddress: String,
      deviceType: String,
      clientType: String,
      version: String,
    },
    
    // Calculated fields (updated during reconciliation)
    attendancePercentage: {
      type: Number,
      min: 0,
      max: 100,
      default: 0,
    },
    isValidAttendance: {
      type: Boolean,
      default: true,
    },
    
    // Error tracking
    reconciliationErrors: [{
      error: String,
      timestamp: { type: Date, default: Date.now },
      resolved: { type: Boolean, default: false },
    }],
  },
  {
    timestamps: true,
  }
);

// Compound indexes for performance
zoomAttendanceSchema.index({ meetingUuid: 1, participantUuid: 1 }, { unique: true });
zoomAttendanceSchema.index({ meetingId: 1, participantEmail: 1 });
zoomAttendanceSchema.index({ meetingId: 1, studentId: 1 });
zoomAttendanceSchema.index({ joinTime: 1 });
zoomAttendanceSchema.index({ source: 1, isReconciled: 1 });

// Method to calculate duration and status with 85% threshold
zoomAttendanceSchema.methods.calculateDurationAndStatus = function(meetingDuration = null) {
  if (this.joinTime && this.leaveTime) {
    this.duration = Math.round((this.leaveTime - this.joinTime) / 1000);
  } else if (this.joinTime) {
    // Still in meeting or just joined
    this.duration = Math.round((Date.now() - this.joinTime) / 1000);
  }
  
  if (meetingDuration && this.duration) {
    this.attendancePercentage = Math.round((this.duration / (meetingDuration * 60)) * 100);
    
    // Apply 85% threshold rule for attendance status
    if (this.attendancePercentage >= 85) {
      this.attendanceStatus = 'Present';
    } else {
      this.attendanceStatus = 'Absent';
    }
  } else if (!this.leaveTime) {
    this.attendanceStatus = 'In Progress';
  }
  
  return this;
};

// Method to calculate total attendance time for user across multiple sessions
zoomAttendanceSchema.statics.calculateUserAttendanceTime = async function(meetingUuid, participantIdentifier, identifierType = 'email') {
  try {
    let matchQuery = { meetingUuid };
    
    // Build query based on identifier type
    switch (identifierType) {
      case 'email':
        matchQuery.participantEmail = participantIdentifier;
        break;
      case 'name':
        matchQuery.participantName = participantIdentifier;
        break;
      case 'uuid':
        matchQuery.participantUuid = participantIdentifier;
        break;
      case 'studentId':
        matchQuery.studentId = participantIdentifier;
        break;
      default:
        matchQuery.participantEmail = participantIdentifier;
    }
    
    // Get all sessions for this participant in this meeting
    const sessions = await this.find(matchQuery).sort({ joinTime: 1 });
    
    if (!sessions.length) {
      return {
        totalAttendanceTime: 0,
        sessions: [],
        attendancePercentage: 0,
        status: 'Absent'
      };
    }
    
    let totalAttendanceTime = 0;
    const processedSessions = [];
    
    // Calculate total time across all join/leave sessions
    for (const session of sessions) {
      if (session.joinTime) {
        const leaveTime = session.leaveTime || new Date(); // Use current time if still in meeting
        const sessionDuration = Math.max(0, (leaveTime - session.joinTime) / 1000); // Duration in seconds
        
        totalAttendanceTime += sessionDuration;
        
        processedSessions.push({
          joinTime: session.joinTime,
          leaveTime: session.leaveTime,
          duration: sessionDuration,
          participantName: session.participantName,
          participantEmail: session.participantEmail
        });
      }
    }
    
    return {
      totalAttendanceTime, // in seconds
      sessions: processedSessions,
      sessionCount: processedSessions.length,
      participant: {
        name: sessions[0].participantName,
        email: sessions[0].participantEmail,
        studentId: sessions[0].studentId
      }
    };
    
  } catch (error) {
    console.error('Error calculating user attendance time:', error);
    return {
      totalAttendanceTime: 0,
      sessions: [],
      attendancePercentage: 0,
      status: 'Absent',
      error: error.message
    };
  }
};

// Method to calculate attendance percentage and status with 85% threshold
zoomAttendanceSchema.statics.calculateAttendanceStatus = function(attendanceTime, meetingDuration) {
  if (!meetingDuration || meetingDuration <= 0) {
    return { attendancePercentage: 0, status: 'Absent' };
  }
  
  const attendancePercentage = Math.round((attendanceTime / (meetingDuration * 60)) * 100);
  const status = attendancePercentage >= 85 ? 'Present' : 'Absent';
  
  return { attendancePercentage, status };
};

// Method to add webhook event
zoomAttendanceSchema.methods.addWebhookEvent = function(eventType, eventData) {
  this.webhookEvents.push({
    eventType,
    eventData,
    timestamp: new Date(),
    processed: true,
  });
  
  // Update relevant fields based on event type
  switch (eventType) {
    case 'meeting.participant_joined':
      this.connectionStatus = 'joined';
      if (!this.joinTime) {
        this.joinTime = new Date(eventData.object?.participant?.join_time || Date.now());
      }
      break;
      
    case 'meeting.participant_left':
      this.connectionStatus = 'left';
      this.leaveTime = new Date(eventData.object?.participant?.leave_time || Date.now());
      break;
      
    case 'meeting.ended':
      if (this.connectionStatus === 'joined' || this.connectionStatus === 'in_meeting') {
        this.connectionStatus = 'left';
        this.leaveTime = new Date(eventData.object?.end_time || Date.now());
      }
      break;
  }
  
  return this.save();
};

// Method to match with student
zoomAttendanceSchema.methods.matchWithStudent = async function() {
  if (this.isMatched || (!this.participantEmail && !this.participantName)) {
    return this;
  }
  
  const Student = mongoose.model('Student');
  let matchedStudent = null;
  
  // Try to match by email first
  if (this.participantEmail) {
    matchedStudent = await Student.findOne({
      Email: { $regex: new RegExp(`^${this.participantEmail}$`, 'i') }
    });
  }
  
  // Try to match by name if email doesn't work
  if (!matchedStudent && this.participantName) {
    const nameVariations = [
      this.participantName,
      this.participantName.replace(/[.,]/g, ''), // Remove punctuation
      this.participantName.toLowerCase(),
    ];
    
    for (const nameVar of nameVariations) {
      matchedStudent = await Student.findOne({
        $or: [
          { FirstName: { $regex: new RegExp(`^${nameVar}$`, 'i') } },
          { LastName: { $regex: new RegExp(`^${nameVar}$`, 'i') } },
          { $expr: { 
            $eq: [
              { $toLower: { $concat: ['$FirstName', ' ', '$LastName'] } },
              nameVar.toLowerCase()
            ]
          }}
        ]
      });
      
      if (matchedStudent) break;
    }
  }
  
  if (matchedStudent) {
    this.studentId = matchedStudent.StudentID;
    this.isMatched = true;
  }
  
  return this.save();
};

// Static method to get attendance summary for a meeting
zoomAttendanceSchema.statics.getAttendanceSummary = async function(meetingId, options = {}) {
  const pipeline = [
    { $match: { meetingId: meetingId } },
    {
      $lookup: {
        from: 'students',
        localField: 'studentId',
        foreignField: 'StudentID',
        as: 'student'
      }
    },
    { $unwind: { path: '$student', preserveNullAndEmptyArrays: true } },
    {
      $project: {
        meetingId: 1,
        meetingTopic: 1,
        participantName: 1,
        participantEmail: 1,
        studentId: 1,
        student: 1,
        joinTime: 1,
        leaveTime: 1,
        duration: 1,
        attendanceStatus: 1,
        attendancePercentage: 1,
        isMatched: 1,
        source: 1,
        isReconciled: 1,
        createdAt: 1,
        updatedAt: 1
      }
    },
    { $sort: { joinTime: 1 } }
  ];
  
  const attendanceRecords = await this.aggregate(pipeline);
  
  // Calculate statistics
  const stats = {
    total: attendanceRecords.length,
    students: attendanceRecords.filter(r => r.studentId).length,
    present: attendanceRecords.filter(r => r.attendanceStatus === 'Present').length,
    partial: attendanceRecords.filter(r => r.attendanceStatus === 'Partial').length,
    late: attendanceRecords.filter(r => r.attendanceStatus === 'Late').length,
    absent: attendanceRecords.filter(r => r.attendanceStatus === 'Absent').length,
    inProgress: attendanceRecords.filter(r => r.attendanceStatus === 'In Progress').length,
    reconciled: attendanceRecords.filter(r => r.isReconciled).length,
  };
  
  stats.attendanceRate = stats.total > 0 ? 
    Math.round(((stats.present + stats.partial) / stats.total) * 100) : 0;
  
  return {
    meetingId,
    summary: stats,
    participants: attendanceRecords,
    generatedAt: new Date(),
  };
};

const ZoomAttendance = mongoose.model('ZoomAttendance', zoomAttendanceSchema);

module.exports = ZoomAttendance;
