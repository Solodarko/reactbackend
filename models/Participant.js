// models/Participant.js
const mongoose = require("mongoose");

const participantSchema = new mongoose.Schema({
  // Basic participant info
  participantName: { type: String, required: true },
  participantId: { type: String, required: true },
  zoomUserId: { type: String }, // Zoom user ID if available
  
  // Link to authenticated user
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    sparse: true // Allow null values
  },
  
  // Authenticated user details (cached for performance)
  authenticatedUser: {
    username: { type: String },
    email: { type: String },
    role: { type: String, enum: ['user', 'admin'] },
    joinedViaAuth: { type: Boolean, default: false },
    authTokenUsed: { type: Boolean, default: false }
  },
  studentId: {
    type: Number,
    sparse: true // Allow null values - References Student.StudentID not _id
  },
  
  // Direct student details (for easier access and performance)
  studentFirstName: { type: String },
  studentLastName: { type: String },
  studentDepartment: { type: String },
  studentEmail: { type: String },
  
  // Meeting information
  meetingId: { type: String, required: true },
  meetingTopic: { type: String },
  
  // Session tracking
  joinTime: { type: Date, required: true },
  leaveTime: { type: Date },
  duration: { type: Number }, // in minutes
  
  // Status and behavior
  attendanceStatus: { 
    type: String, 
    enum: ['Present', 'Absent', 'Late', 'Left Early', 'In Progress', 'Partial', 'Unknown'],
    default: "Unknown" 
  },
  connectionStatus: {
    type: String,
    enum: ['joined', 'left', 'reconnected', 'disconnected', 'in_meeting', 'waiting'],
    default: 'joined'
  },
  
  // Additional participant details
  email: { type: String },
  userType: { 
    type: String, 
    enum: ['student', 'instructor', 'guest', 'attendee', 'host', 'panelist', 'unknown'],
    default: 'unknown'
  },
  device: { type: String }, // Mobile, Desktop, Web
  
  // Engagement metrics
  audioStatus: { type: Boolean, default: false }, // Muted/Unmuted
  videoStatus: { type: Boolean, default: false }, // Camera on/off
  sharingScreen: { type: Boolean, default: false },
  handRaised: { type: Boolean, default: false },
  
  // Session history for reconnections
  sessions: [{
    joinTime: { type: Date, required: true },
    leaveTime: { type: Date },
    duration: { type: Number }, // in minutes
    reason: { type: String } // left, disconnected, removed, etc.
  }],
  
  // Real-time tracking
  lastActivity: { type: Date, default: Date.now },
  isActive: { type: Boolean, default: true },
  
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now }
});

// Update the updatedAt field before saving
participantSchema.pre('save', function(next) {
  this.updatedAt = Date.now();
  next();
});

// Calculate total duration including all sessions
participantSchema.methods.calculateTotalDuration = function() {
  let totalDuration = 0;
  
  // Add completed sessions
  this.sessions.forEach(session => {
    if (session.duration) {
      totalDuration += session.duration;
    }
  });
  
  // Add current session if still active
  if (this.isActive && this.joinTime && !this.leaveTime) {
    const currentDuration = (Date.now() - this.joinTime.getTime()) / (1000 * 60);
    totalDuration += currentDuration;
  } else if (this.duration) {
    totalDuration += this.duration;
  }
  
  return Math.round(totalDuration);
};

// Check if participant meets attendance threshold
participantSchema.methods.meetsAttendanceThreshold = function(meetingDuration, threshold = 75) {
  const totalDuration = this.calculateTotalDuration();
  const attendancePercentage = (totalDuration / meetingDuration) * 100;
  return attendancePercentage >= threshold;
};

module.exports = mongoose.model("Participant", participantSchema);
