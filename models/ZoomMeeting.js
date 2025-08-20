const mongoose = require('mongoose');

const zoomMeetingSchema = new mongoose.Schema(
  {
    meetingId: {
      type: String,
      required: true,
      unique: true,
    },
    meetingUuid: {
      type: String,
      required: true,
    },
    topic: {
      type: String,
      required: true,
      trim: true,
    },
    hostId: {
      type: String,
      required: true,
    },
    hostEmail: {
      type: String,
      required: true,
    },
    type: {
      type: Number,
      enum: [1, 2, 3, 8], // 1=instant, 2=scheduled, 3=recurring, 8=recurring with fixed time
      required: true,
    },
    status: {
      type: String,
      enum: ['waiting', 'started', 'ended'],
      default: 'waiting',
    },
    startTime: {
      type: Date,
      required: false,
    },
    actualStartTime: {
      type: Date,
      required: false,
    },
    endTime: {
      type: Date,
      required: false,
    },
    actualEndTime: {
      type: Date,
      required: false,
    },
    duration: {
      type: Number, // in minutes
      required: true,
    },
    actualDuration: {
      type: Number, // actual duration in minutes
      required: false,
    },
    timezone: {
      type: String,
      default: 'UTC',
    },
    password: {
      type: String,
      required: false,
    },
    joinUrl: {
      type: String,
      required: true,
    },
    startUrl: {
      type: String,
      required: true,
    },
    settings: {
      hostVideo: { type: Boolean, default: true },
      participantVideo: { type: Boolean, default: true },
      joinBeforeHost: { type: Boolean, default: true },
      muteUponEntry: { type: Boolean, default: true },
      waitingRoom: { type: Boolean, default: false },
      autoRecording: { type: String, enum: ['local', 'cloud', 'none'], default: 'none' },
      approvalType: { type: Number, default: 0 }, // 0=auto approve, 1=manual approve, 2=no registration required
    },
    participants: [{
      participantId: String,
      name: String,
      email: String,
      joinTime: Date,
      leaveTime: Date,
      duration: Number, // in seconds
      attentiveness: String, // Focus percentage if available
      recordingConsent: Boolean,
      status: { type: String, enum: ['joined', 'left', 'in_meeting'], default: 'joined' },
      studentId: { type: String }, // Matched student ID (StudentID from Student model)
      studentFirstName: { type: String },
      studentLastName: { type: String },
      studentDepartment: { type: String },
      studentEmail: { type: String },
      isMatched: { type: Boolean, default: false },
    }],
    attendanceGenerated: {
      type: Boolean,
      default: false,
    },
    attendanceGeneratedAt: {
      type: Date,
      required: false,
    },
    totalParticipants: {
      type: Number,
      default: 0,
    },
    uniqueParticipants: {
      type: Number,
      default: 0,
    },
    webhookEvents: [{
      eventType: String,
      eventData: mongoose.Schema.Types.Mixed,
      timestamp: { type: Date, default: Date.now },
      processed: { type: Boolean, default: false },
      source: { type: String, enum: ['webhook', 'api', 'manual'], default: 'webhook' }
    }],
    reportGenerated: {
      type: Boolean,
      default: false,
    },
    reportGeneratedAt: {
      type: Date,
      required: false,
    },
    reportGenerationFailed: {
      type: Boolean,
      default: false,
    },
    reportGenerationError: {
      type: String,
      required: false,
    },
    reconciliationCompleted: {
      type: Boolean,
      default: false,
    },
    reconciliationCompletedAt: {
      type: Date,
      required: false,
    },
    webhookSecret: {
      type: String,
      required: false,
    },
    metadata: {
      createdBy: String,
      tags: [String],
      department: String,
      course: String,
      session: String,
    },
  },
  {
    timestamps: true,
  }
);

// Index for better query performance
zoomMeetingSchema.index({ meetingId: 1 });
zoomMeetingSchema.index({ startTime: 1 });
zoomMeetingSchema.index({ status: 1 });
zoomMeetingSchema.index({ 'participants.email': 1 });
zoomMeetingSchema.index({ 'participants.studentId': 1 });

// Virtual for calculating attendance rate
zoomMeetingSchema.virtual('attendanceRate').get(function() {
  if (this.totalParticipants === 0) return 0;
  return Math.round((this.participants.filter(p => p.isMatched).length / this.totalParticipants) * 100);
});

// Method to update participant data
zoomMeetingSchema.methods.updateParticipant = function(participantData) {
  const existingParticipant = this.participants.find(p => p.participantId === participantData.participantId);
  
  if (existingParticipant) {
    Object.assign(existingParticipant, participantData);
  } else {
    this.participants.push(participantData);
  }
  
  this.totalParticipants = this.participants.length;
  this.uniqueParticipants = new Set(this.participants.map(p => p.email)).size;
  
  return this.save();
};

// Method to match participants with students
zoomMeetingSchema.methods.matchParticipantsWithStudents = async function() {
  const Student = mongoose.model('Student');
  const students = await Student.find({});
  
  for (let participant of this.participants) {
    if (!participant.isMatched && participant.email) {
      // Try to match by email first
      let matchedStudent = students.find(s => s.Email.toLowerCase() === participant.email.toLowerCase());
      
      if (!matchedStudent && participant.name) {
        // Try to match by name if email doesn't match
        const participantFullName = participant.name.toLowerCase();
        matchedStudent = students.find(s => {
          const studentFullName = `${s.FirstName} ${s.LastName}`.toLowerCase();
          return studentFullName === participantFullName;
        });
      }
      
      if (matchedStudent) {
        participant.studentId = matchedStudent.StudentID;
        participant.isMatched = true;
      }
    }
  }
  
  return this.save();
};

const ZoomMeeting = mongoose.model('ZoomMeeting', zoomMeetingSchema);

module.exports = ZoomMeeting;
