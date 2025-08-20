const express = require('express');
const router = express.Router();
const QRCode = require('qrcode');
const { v4: uuidv4 } = require('uuid');
const QRAttendance = require('../models/QRAttendance');

/**
 * Generate QR Code for Attendance Session
 * POST /api/qr-attendance/generate
 */
router.post('/generate', async (req, res) => {
  try {
    const { sessionTitle, validUntil, options = {} } = req.body;

    if (!sessionTitle) {
      return res.status(400).json({
        success: false,
        error: 'Session title is required',
      });
    }

    // Generate unique session ID and QR code ID
    const sessionId = uuidv4();
    const qrCodeId = uuidv4();

    // Create the QR code data
    const qrData = {
      type: 'attendance',
      sessionId,
      qrCodeId,
      sessionTitle,
      timestamp: new Date().toISOString(),
      validUntil: validUntil || new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(), // 24 hours default
    };

    // Generate QR code
    const qrCodeString = `${process.env.FRONTEND_URL || 'http://localhost:3000'}/qr-scan?data=${encodeURIComponent(JSON.stringify(qrData))}`;
    
    const qrCodeOptions = {
      width: options.width || 300,
      margin: options.margin || 2,
      color: {
        dark: options.darkColor || '#000000',
        light: options.lightColor || '#FFFFFF',
      },
    };

    const qrCodeDataURL = await QRCode.toDataURL(qrCodeString, qrCodeOptions);

    res.json({
      success: true,
      data: {
        sessionId,
        qrCodeId,
        sessionTitle,
        qrCodeDataURL,
        qrCodeString,
        validUntil: qrData.validUntil,
        scanUrl: `${process.env.FRONTEND_URL || 'http://localhost:3000'}/qr-scan?data=${encodeURIComponent(JSON.stringify(qrData))}`,
      },
    });
  } catch (error) {
    console.error('Error generating QR code:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to generate QR code',
    });
  }
});

/**
 * Record Attendance from QR Scan
 * POST /api/qr-attendance/record
 */
router.post('/record', async (req, res) => {
  try {
    const {
      sessionId,
      qrCodeId,
      sessionTitle,
      name,
      email,
      phoneNumber,
      organization,
      position,
      notes,
      location,
      deviceInfo,
    } = req.body;

    // Validate required fields
    if (!sessionId || !qrCodeId || !sessionTitle || !name || !email) {
      return res.status(400).json({
        success: false,
        error: 'Missing required fields: sessionId, qrCodeId, sessionTitle, name, email',
      });
    }

    // Get client IP and user agent
    const ipAddress = req.ip || req.connection.remoteAddress;
    const userAgent = req.headers['user-agent'];

    // Check if user already recorded attendance for this session
    const existingAttendance = await QRAttendance.findOne({
      sessionId,
      email: email.toLowerCase(),
    });

    if (existingAttendance) {
      return res.status(409).json({
        success: false,
        error: 'Attendance already recorded for this session',
        data: existingAttendance,
      });
    }

    // Create new attendance record
    const attendanceRecord = new QRAttendance({
      sessionId,
      qrCodeId,
      sessionTitle,
      name: name.trim(),
      email: email.toLowerCase().trim(),
      phoneNumber,
      organization,
      position,
      notes,
      ipAddress,
      userAgent,
      location,
      deviceInfo,
      scannedAt: new Date(),
    });

    await attendanceRecord.save();

    res.status(201).json({
      success: true,
      message: 'Attendance recorded successfully',
      data: attendanceRecord,
    });
  } catch (error) {
    console.error('Error recording attendance:', error);
    
    if (error.code === 11000) {
      return res.status(409).json({
        success: false,
        error: 'Attendance already recorded for this session',
      });
    }

    res.status(500).json({
      success: false,
      error: 'Failed to record attendance',
    });
  }
});

/**
 * Get Attendance Records for a Session
 * GET /api/qr-attendance/session/:sessionId
 */
router.get('/session/:sessionId', async (req, res) => {
  try {
    const { sessionId } = req.params;
    const { page = 1, limit = 50, sort = '-scannedAt' } = req.query;

    const attendanceRecords = await QRAttendance.find({ sessionId })
      .sort(sort)
      .limit(limit * 1)
      .skip((page - 1) * limit)
      .select('-__v');

    const totalRecords = await QRAttendance.countDocuments({ sessionId });

    res.json({
      success: true,
      data: {
        records: attendanceRecords,
        totalRecords,
        currentPage: parseInt(page),
        totalPages: Math.ceil(totalRecords / limit),
        hasNextPage: page < Math.ceil(totalRecords / limit),
        hasPrevPage: page > 1,
      },
    });
  } catch (error) {
    console.error('Error fetching attendance records:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch attendance records',
    });
  }
});

/**
 * Get All Attendance Sessions
 * GET /api/qr-attendance/sessions
 */
router.get('/sessions', async (req, res) => {
  try {
    const { page = 1, limit = 20 } = req.query;

    const sessions = await QRAttendance.aggregate([
      {
        $group: {
          _id: '$sessionId',
          sessionTitle: { $first: '$sessionTitle' },
          totalAttendees: { $sum: 1 },
          firstScan: { $min: '$scannedAt' },
          lastScan: { $max: '$scannedAt' },
          qrCodeId: { $first: '$qrCodeId' },
        },
      },
      {
        $sort: { firstScan: -1 },
      },
      {
        $skip: (page - 1) * limit,
      },
      {
        $limit: parseInt(limit),
      },
    ]);

    const totalSessions = await QRAttendance.distinct('sessionId').then(ids => ids.length);

    res.json({
      success: true,
      data: {
        sessions,
        totalSessions,
        currentPage: parseInt(page),
        totalPages: Math.ceil(totalSessions / limit),
      },
    });
  } catch (error) {
    console.error('Error fetching sessions:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch sessions',
    });
  }
});

/**
 * Delete Attendance Session
 * DELETE /api/qr-attendance/session/:sessionId
 */
router.delete('/session/:sessionId', async (req, res) => {
  try {
    const { sessionId } = req.params;

    const result = await QRAttendance.deleteMany({ sessionId });

    res.json({
      success: true,
      message: `Deleted ${result.deletedCount} attendance records`,
      deletedCount: result.deletedCount,
    });
  } catch (error) {
    console.error('Error deleting session:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to delete session',
    });
  }
});

/**
 * Export Attendance Records as CSV
 * GET /api/qr-attendance/export/:sessionId
 */
router.get('/export/:sessionId', async (req, res) => {
  try {
    const { sessionId } = req.params;

    const attendanceRecords = await QRAttendance.find({ sessionId })
      .sort({ scannedAt: -1 })
      .select('-__v -_id');

    if (attendanceRecords.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'No attendance records found for this session',
      });
    }

    // Convert to CSV format
    const csvHeader = 'Name,Email,Phone,Organization,Position,Scanned At,Status,Notes\n';
    const csvData = attendanceRecords
      .map(record => {
        return [
          `"${record.name}"`,
          `"${record.email}"`,
          `"${record.phoneNumber || ''}"`,
          `"${record.organization || ''}"`,
          `"${record.position || ''}"`,
          `"${record.scannedAt.toISOString()}"`,
          `"${record.status}"`,
          `"${record.notes || ''}"`,
        ].join(',');
      })
      .join('\n');

    const csv = csvHeader + csvData;

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="attendance-${sessionId}.csv"`);
    res.send(csv);
  } catch (error) {
    console.error('Error exporting attendance:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to export attendance records',
    });
  }
});

/**
 * Get Attendance Statistics
 * GET /api/qr-attendance/stats/:sessionId
 */
router.get('/stats/:sessionId', async (req, res) => {
  try {
    const { sessionId } = req.params;

    const stats = await QRAttendance.aggregate([
      { $match: { sessionId } },
      {
        $group: {
          _id: null,
          totalAttendees: { $sum: 1 },
          firstScan: { $min: '$scannedAt' },
          lastScan: { $max: '$scannedAt' },
          organizations: { $addToSet: '$organization' },
          uniqueEmails: { $addToSet: '$email' },
        },
      },
    ]);

    const hourlyScanData = await QRAttendance.aggregate([
      { $match: { sessionId } },
      {
        $group: {
          _id: {
            hour: { $hour: '$scannedAt' },
            date: { $dateToString: { format: '%Y-%m-%d', date: '$scannedAt' } },
          },
          count: { $sum: 1 },
        },
      },
      { $sort: { '_id.date': 1, '_id.hour': 1 } },
    ]);

    const result = stats.length > 0 ? stats[0] : {
      totalAttendees: 0,
      firstScan: null,
      lastScan: null,
      organizations: [],
      uniqueEmails: [],
    };

    res.json({
      success: true,
      data: {
        ...result,
        uniqueAttendees: result.uniqueEmails.length,
        organizationCount: result.organizations.filter(org => org).length,
        hourlyScanData,
      },
    });
  } catch (error) {
    console.error('Error fetching statistics:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch statistics',
    });
  }
});

module.exports = router;
