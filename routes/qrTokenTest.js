const express = require('express');
const router = express.Router();

/**
 * QR Token Extraction Test API Routes
 * Test endpoints for demonstrating QR token extraction functionality
 */

// Test endpoint to validate and extract token from QR data
router.post('/extract-token', async (req, res) => {
  try {
    const { qrData } = req.body;
    
    if (!qrData) {
      return res.status(400).json({
        success: false,
        error: 'QR data is required',
        message: 'Please provide QR data to extract token from'
      });
    }
    
    // Parse QR data
    let parsedData;
    try {
      parsedData = typeof qrData === 'string' ? JSON.parse(qrData) : qrData;
    } catch (parseError) {
      return res.status(400).json({
        success: false,
        error: 'Invalid QR data format',
        message: 'QR data must be valid JSON',
        details: parseError.message
      });
    }
    
    // Validate QR data structure
    if (!parsedData.userToken) {
      return res.status(400).json({
        success: false,
        error: 'No user token found in QR data',
        message: 'QR data must contain userToken field',
        availableFields: Object.keys(parsedData)
      });
    }
    
    // Extract user information from token
    const userToken = parsedData.userToken;
    const extractedUserInfo = {
      userId: userToken.userId,
      username: userToken.username,
      email: userToken.email,
      fullName: userToken.fullName,
      firstName: userToken.firstName,
      lastName: userToken.lastName,
      role: userToken.role,
      studentId: userToken.studentId,
      department: userToken.department,
      hasStudentRecord: userToken.hasStudentRecord,
      tokenType: userToken.tokenType,
      permissions: userToken.permissions
    };
    
    // Validate extracted data
    const requiredFields = ['email', 'fullName'];
    const missingFields = requiredFields.filter(field => !extractedUserInfo[field]);
    
    if (missingFields.length > 0) {
      return res.status(400).json({
        success: false,
        error: 'Missing required user data',
        message: 'Token missing required user information',
        missingFields: missingFields
      });
    }
    
    // Success response
    res.json({
      success: true,
      message: 'Token extracted successfully',
      data: {
        extractedAt: new Date().toISOString(),
        qrMetadata: {
          id: parsedData.id,
          type: parsedData.type,
          timestamp: parsedData.timestamp,
          expiresAt: parsedData.expiresAt,
          location: parsedData.location
        },
        userInfo: extractedUserInfo,
        tokenValidation: {
          hasUserToken: true,
          hasRequiredFields: true,
          tokenType: userToken.tokenType || 'unknown',
          permissionsCount: (userToken.permissions || []).length
        }
      }
    });
    
  } catch (error) {
    console.error('QR Token Extraction Error:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error',
      message: 'Failed to process QR token extraction',
      details: error.message
    });
  }
});

// Test endpoint to generate sample QR data with token
router.post('/generate-sample-token', async (req, res) => {
  try {
    const { userInfo } = req.body;
    
    const timestamp = Date.now();
    const qrId = `sample_token_${timestamp}`;
    
    // Create sample QR data with user token
    const sampleQRData = {
      id: qrId,
      type: 'token_extraction_sample',
      timestamp: timestamp,
      expiresAt: new Date(Date.now() + (30 * 60 * 1000)).toISOString(), // 30 minutes
      checksum: Buffer.from(`${qrId}_${timestamp}`).toString('base64'),
      location: 'api_test_endpoint',
      
      userToken: {
        userId: userInfo?.userId || 'sample_user_123',
        username: userInfo?.username || 'sample_user',
        email: userInfo?.email || 'sample@example.com',
        fullName: userInfo?.fullName || 'Sample User',
        firstName: userInfo?.firstName || 'Sample',
        lastName: userInfo?.lastName || 'User',
        role: userInfo?.role || 'student',
        studentId: userInfo?.studentId || 'SAM001',
        department: userInfo?.department || 'Computer Science',
        hasStudentRecord: userInfo?.hasStudentRecord !== undefined ? userInfo.hasStudentRecord : true,
        
        tokenType: 'sample_test_token',
        permissions: ['scan_qr', 'submit_attendance', 'view_profile'],
        sessionData: {
          generatedAt: new Date().toISOString(),
          source: 'api_test_endpoint',
          testMode: true
        }
      },
      
      generatedBy: 'qr_token_test_api',
      purpose: 'demonstrate_token_generation'
    };
    
    res.json({
      success: true,
      message: 'Sample QR token generated successfully',
      data: {
        qrData: sampleQRData,
        qrString: JSON.stringify(sampleQRData),
        tokenSummary: {
          userId: sampleQRData.userToken.userId,
          name: sampleQRData.userToken.fullName,
          email: sampleQRData.userToken.email,
          studentId: sampleQRData.userToken.studentId,
          role: sampleQRData.userToken.role,
          department: sampleQRData.userToken.department
        }
      }
    });
    
  } catch (error) {
    console.error('Sample QR Generation Error:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error',
      message: 'Failed to generate sample QR token',
      details: error.message
    });
  }
});

// Test endpoint to validate QR token structure
router.post('/validate-token-structure', async (req, res) => {
  try {
    const { qrData } = req.body;
    
    if (!qrData) {
      return res.status(400).json({
        success: false,
        error: 'QR data is required'
      });
    }
    
    let parsedData;
    try {
      parsedData = typeof qrData === 'string' ? JSON.parse(qrData) : qrData;
    } catch (parseError) {
      return res.json({
        success: true,
        valid: false,
        issues: ['Invalid JSON format'],
        details: { parseError: parseError.message }
      });
    }
    
    const validation = {
      hasId: !!parsedData.id,
      hasType: !!parsedData.type,
      hasTimestamp: !!parsedData.timestamp,
      hasUserToken: !!parsedData.userToken,
      hasChecksum: !!parsedData.checksum
    };
    
    const tokenValidation = parsedData.userToken ? {
      hasUserId: !!parsedData.userToken.userId,
      hasUsername: !!parsedData.userToken.username,
      hasEmail: !!parsedData.userToken.email,
      hasFullName: !!parsedData.userToken.fullName,
      hasRole: !!parsedData.userToken.role,
      hasPermissions: Array.isArray(parsedData.userToken.permissions)
    } : {};
    
    const issues = [];
    if (!validation.hasUserToken) issues.push('Missing userToken field');
    if (!validation.hasId) issues.push('Missing id field');
    if (!validation.hasType) issues.push('Missing type field');
    if (parsedData.userToken && !tokenValidation.hasEmail) issues.push('Missing email in userToken');
    if (parsedData.userToken && !tokenValidation.hasFullName) issues.push('Missing fullName in userToken');
    
    res.json({
      success: true,
      valid: issues.length === 0,
      structure: validation,
      tokenStructure: tokenValidation,
      issues: issues,
      summary: {
        totalFields: Object.keys(parsedData).length,
        hasUserToken: validation.hasUserToken,
        tokenFields: parsedData.userToken ? Object.keys(parsedData.userToken).length : 0,
        validationScore: `${Object.values(validation).filter(Boolean).length}/${Object.values(validation).length}`
      }
    });
    
  } catch (error) {
    console.error('Token Validation Error:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error',
      message: 'Failed to validate token structure',
      details: error.message
    });
  }
});

module.exports = router;
