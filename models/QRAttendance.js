const mongoose = require('mongoose');

const qrAttendanceSchema = new mongoose.Schema(
  {
    sessionId: {
      type: String,
      required: true,
      index: true,
    },
    sessionTitle: {
      type: String,
      required: true,
      trim: true,
    },
    name: {
      type: String,
      required: true,
      trim: true,
    },
    email: {
      type: String,
      required: true,
      trim: true,
      lowercase: true,
    },
    phoneNumber: {
      type: String,
      trim: true,
    },
    organization: {
      type: String,
      trim: true,
    },
    position: {
      type: String,
      trim: true,
    },
    qrCodeId: {
      type: String,
      required: true,
      index: true,
    },
    scannedAt: {
      type: Date,
      default: Date.now,
    },
    ipAddress: {
      type: String,
    },
    userAgent: {
      type: String,
    },
    location: {
      latitude: Number,
      longitude: Number,
    },
    deviceInfo: {
      type: String,
    },
    status: {
      type: String,
      enum: ['present', 'late', 'verified'],
      default: 'present',
    },
    notes: {
      type: String,
      trim: true,
    },
  },
  {
    timestamps: true,
  }
);

// Compound index for unique attendance per session per email
qrAttendanceSchema.index({ sessionId: 1, email: 1 }, { unique: true });

// Index for quick lookups
qrAttendanceSchema.index({ sessionId: 1, scannedAt: -1 });
qrAttendanceSchema.index({ qrCodeId: 1 });

// Virtual for formatted scan time
qrAttendanceSchema.virtual('formattedScannedAt').get(function() {
  return this.scannedAt.toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
});

const QRAttendance = mongoose.model('QRAttendance', qrAttendanceSchema);

module.exports = QRAttendance;
