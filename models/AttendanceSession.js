// models/AttendanceSession.js
const mongoose = require('mongoose');

const attendanceSessionSchema = new mongoose.Schema({
  // Participant identification
  participantId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Participant',
    required: true,
    index: true
  },
  
  // Meeting reference
  meetingId: {
    type: String,
    required: true,
    index: true
  },
  
  // User identification (if authenticated)
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    sparse: true
  },
  
  studentId: {
    type: Number,
    ref: 'Student',
    sparse: true
  },
  
  // Session timing
  joinTime: {
    type: Date,
    required: true,
    index: true
  },
  
  leaveTime: {
    type: Date,
    index: true
  },
  
  duration: {
    type: Number, // Duration in minutes
    min: 0,
    default: 0
  },
  
  // Session status
  isActive: {
    type: Boolean,
    default: true
  },
  
  sessionStatus: {
    type: String,
    enum: ['active', 'completed', 'disconnected', 'removed', 'left'],
    default: 'active'
  },
  
  // Connection details
  connectionType: {
    type: String,
    enum: ['join', 'rejoin', 'reconnect'],
    default: 'join'
  },
  
  disconnectionReason: {
    type: String,
    enum: ['left_meeting', 'network_issue', 'removed_by_host', 'system_error', 'browser_closed'],
    sparse: true
  },
  
  // Device and connection info
  deviceInfo: {
    type: {
      type: String,
      enum: ['desktop', 'mobile', 'tablet', 'web', 'unknown'],
      default: 'unknown'
    },
    platform: String,
    browser: String,
    ipAddress: String,
    userAgent: String
  },
  
  // Engagement metrics during this session
  engagement: {
    audioEnabled: { type: Boolean, default: false },
    videoEnabled: { type: Boolean, default: false },
    screenShared: { type: Boolean, default: false },
    chatMessages: { type: Number, default: 0 },
    handsRaised: { type: Number, default: 0 },
    pollsAnswered: { type: Number, default: 0 }
  },
  
  // Quality metrics
  connectionQuality: {
    averageLatency: Number, // in milliseconds
    packetsLost: Number,
    jitterBuffer: Number,
    audioQuality: {
      type: String,
      enum: ['excellent', 'good', 'fair', 'poor', 'unavailable'],
      default: 'unavailable'
    },
    videoQuality: {
      type: String,
      enum: ['excellent', 'good', 'fair', 'poor', 'unavailable'],
      default: 'unavailable'
    }
  },
  
  // Location data (if available)
  location: {
    coordinates: {
      latitude: {
        type: Number,
        min: -90,
        max: 90
      },
      longitude: {
        type: Number,
        min: -180,
        max: 180
      }
    },
    accuracy: Number, // GPS accuracy in meters
    timestamp: Date,
    address: String
  },
  
  // Metadata
  metadata: {
    zoomParticipantId: String,
    zoomUserId: String,
    instanceId: String, // For tracking multiple sessions
    sessionNumber: { type: Number, default: 1 }, // 1st join, 2nd join, etc.
    parentSessionId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'AttendanceSession'
    }
  },
  
  // Tracking source
  trackingSource: {
    type: String,
    enum: ['zoom_webhook', 'zoom_api', 'manual', 'system_generated'],
    default: 'zoom_webhook'
  },
  
  // Notes and remarks
  remarks: String,
  
  // Timestamps
  createdAt: {
    type: Date,
    default: Date.now,
    index: true
  },
  
  updatedAt: {
    type: Date,
    default: Date.now
  }
}, {
  timestamps: false // We're handling timestamps manually
});

// Indexes for performance
attendanceSessionSchema.index({ meetingId: 1, participantId: 1 });
attendanceSessionSchema.index({ meetingId: 1, joinTime: 1 });
attendanceSessionSchema.index({ userId: 1, joinTime: -1 });
attendanceSessionSchema.index({ studentId: 1, joinTime: -1 });
attendanceSessionSchema.index({ isActive: 1, meetingId: 1 });

// Pre-save middleware to update timestamps and calculate duration
attendanceSessionSchema.pre('save', function(next) {
  this.updatedAt = Date.now();
  
  // Calculate duration if leaveTime is set and session is not active
  if (this.leaveTime && !this.isActive) {
    const durationMs = this.leaveTime.getTime() - this.joinTime.getTime();
    this.duration = Math.max(Math.round(durationMs / (1000 * 60)), 0); // Convert to minutes
  }
  
  next();
});

// Instance methods
attendanceSessionSchema.methods.endSession = function(leaveTime = null, reason = 'left_meeting') {
  this.leaveTime = leaveTime || new Date();
  this.isActive = false;
  this.sessionStatus = 'completed';
  this.disconnectionReason = reason;
  
  // Calculate final duration
  const durationMs = this.leaveTime.getTime() - this.joinTime.getTime();
  this.duration = Math.max(Math.round(durationMs / (1000 * 60)), 0);
  
  return this.save();
};

attendanceSessionSchema.methods.getCurrentDuration = function() {
  if (this.leaveTime) {
    return this.duration;
  }
  
  // Calculate current duration for active session
  const currentTime = new Date();
  const durationMs = currentTime.getTime() - this.joinTime.getTime();
  return Math.max(Math.round(durationMs / (1000 * 60)), 0);
};

// Static methods
attendanceSessionSchema.statics.getParticipantSessions = function(participantId, meetingId = null) {
  const query = { participantId };
  if (meetingId) {
    query.meetingId = meetingId;
  }
  
  return this.find(query).sort({ joinTime: 1 });
};

attendanceSessionSchema.statics.getMeetingSessions = function(meetingId, activeOnly = false) {
  const query = { meetingId };
  if (activeOnly) {
    query.isActive = true;
  }
  
  return this.find(query)
    .populate('participantId', 'participantName email studentId')
    .populate('userId', 'username email role')
    .sort({ joinTime: 1 });
};

attendanceSessionSchema.statics.calculateTotalDuration = function(participantId, meetingId) {
  return this.aggregate([
    {
      $match: {
        participantId: new mongoose.Types.ObjectId(participantId),
        meetingId: meetingId
      }
    },
    {
      $group: {
        _id: null,
        totalDuration: { $sum: '$duration' },
        sessionCount: { $sum: 1 },
        hasActiveSessions: {
          $sum: {
            $cond: ['$isActive', 1, 0]
          }
        }
      }
    }
  ]);
};

// Virtual for calculating attendance percentage
attendanceSessionSchema.virtual('attendancePercentage').get(function() {
  if (!this.meetingDuration || this.meetingDuration <= 0) return 0;
  return Math.min(Math.round((this.duration / this.meetingDuration) * 100), 100);
});

module.exports = mongoose.model('AttendanceSession', attendanceSessionSchema);
