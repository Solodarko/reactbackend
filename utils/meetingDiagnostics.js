/**
 * Meeting Diagnostics Utility
 * Provides debugging and diagnostic tools for real-time tracking issues
 */

const axios = require('axios');

class MeetingDiagnostics {
  constructor() {
    this.diagnosticHistory = [];
  }

  /**
   * Test Zoom API connectivity and credentials
   */
  async testZoomConnectivity() {
    const test = {
      timestamp: new Date().toISOString(),
      test: 'zoom_connectivity',
      steps: [],
      success: false,
      errors: []
    };

    try {
      // Step 1: Check environment variables
      test.steps.push('Checking environment variables...');
      const requiredEnvVars = ['ZOOM_ACCOUNT_ID', 'ZOOM_CLIENT_ID', 'ZOOM_CLIENT_SECRET'];
      const missingVars = requiredEnvVars.filter(envVar => !process.env[envVar]);
      
      if (missingVars.length > 0) {
        test.errors.push(`Missing environment variables: ${missingVars.join(', ')}`);
        test.steps.push(`❌ Missing: ${missingVars.join(', ')}`);
      } else {
        test.steps.push('✅ All environment variables present');
      }

      // Step 2: Test OAuth token generation
      test.steps.push('Testing OAuth token generation...');
      const tokenResponse = await this.getZoomAccessToken();
      if (tokenResponse.success) {
        test.steps.push('✅ OAuth token generated successfully');
        test.tokenLength = tokenResponse.token.length;
      } else {
        test.errors.push(`Token generation failed: ${tokenResponse.error}`);
        test.steps.push(`❌ Token generation failed: ${tokenResponse.error}`);
      }

      // Step 3: Test basic API call
      if (tokenResponse.success) {
        test.steps.push('Testing basic API call...');
        const apiResponse = await this.testBasicApiCall(tokenResponse.token);
        if (apiResponse.success) {
          test.steps.push('✅ Basic API call successful');
          test.apiResponse = apiResponse.data;
        } else {
          test.errors.push(`API call failed: ${apiResponse.error}`);
          test.steps.push(`❌ API call failed: ${apiResponse.error}`);
        }
      }

      test.success = test.errors.length === 0;
      
    } catch (error) {
      test.errors.push(`Connectivity test failed: ${error.message}`);
      test.steps.push(`❌ Test failed: ${error.message}`);
    }

    this.diagnosticHistory.push(test);
    return test;
  }

  /**
   * Diagnose a specific meeting ID
   */
  async diagnoseMeetingId(meetingId) {
    const diagnostic = {
      timestamp: new Date().toISOString(),
      test: 'meeting_diagnosis',
      meetingId,
      steps: [],
      success: false,
      errors: [],
      warnings: []
    };

    try {
      // Step 1: Validate meeting ID format
      diagnostic.steps.push('Validating meeting ID format...');
      const formatValidation = this.validateMeetingIdFormat(meetingId);
      if (formatValidation.isValid) {
        diagnostic.steps.push(`✅ Meeting ID format is valid: ${formatValidation.formattedId}`);
        diagnostic.formattedId = formatValidation.formattedId;
      } else {
        diagnostic.errors.push(`Invalid meeting ID format: ${formatValidation.error}`);
        diagnostic.steps.push(`❌ Invalid format: ${formatValidation.error}`);
        diagnostic.suggestions = formatValidation.suggestions;
      }

      // Step 2: Get OAuth token
      diagnostic.steps.push('Getting OAuth token...');
      const tokenResponse = await this.getZoomAccessToken();
      if (!tokenResponse.success) {
        diagnostic.errors.push(`Token error: ${tokenResponse.error}`);
        diagnostic.steps.push(`❌ Token error: ${tokenResponse.error}`);
        return diagnostic;
      }
      diagnostic.steps.push('✅ OAuth token obtained');

      // Step 3: Test meeting details API
      diagnostic.steps.push('Testing meeting details API...');
      const detailsResponse = await this.getMeetingDetails(meetingId, tokenResponse.token);
      if (detailsResponse.success) {
        diagnostic.steps.push('✅ Meeting details retrieved');
        diagnostic.meetingDetails = detailsResponse.data;
        diagnostic.meetingStatus = this.analyzeMeetingStatus(detailsResponse.data);
      } else {
        diagnostic.errors.push(`Meeting details error: ${detailsResponse.error}`);
        diagnostic.steps.push(`❌ Meeting details error: ${detailsResponse.error}`);
        diagnostic.statusCode = detailsResponse.statusCode;
      }

      // Step 4: Test participants API
      diagnostic.steps.push('Testing participants API...');
      const participantsResponse = await this.getMeetingParticipants(meetingId, tokenResponse.token);
      if (participantsResponse.success) {
        diagnostic.steps.push(`✅ Participants retrieved (${participantsResponse.data.length} found)`);
        diagnostic.participantCount = participantsResponse.data.length;
        diagnostic.participants = participantsResponse.data.slice(0, 5); // Sample
      } else {
        if (participantsResponse.statusCode === 404) {
          diagnostic.warnings.push('Meeting has no participants or has not started');
          diagnostic.steps.push('⚠️ No participants found - meeting may not have started');
        } else {
          diagnostic.errors.push(`Participants error: ${participantsResponse.error}`);
          diagnostic.steps.push(`❌ Participants error: ${participantsResponse.error}`);
        }
      }

      // Step 5: Determine overall status
      diagnostic.steps.push('Analyzing overall status...');
      diagnostic.trackingRecommendation = this.getTrackingRecommendation(diagnostic);
      diagnostic.success = diagnostic.errors.length === 0;

    } catch (error) {
      diagnostic.errors.push(`Diagnosis failed: ${error.message}`);
      diagnostic.steps.push(`❌ Diagnosis failed: ${error.message}`);
    }

    this.diagnosticHistory.push(diagnostic);
    return diagnostic;
  }

  /**
   * Get OAuth access token for testing
   */
  async getZoomAccessToken() {
    try {
      const response = await axios.post(
        `https://zoom.us/oauth/token?grant_type=account_credentials&account_id=${process.env.ZOOM_ACCOUNT_ID}`,
        {},
        {
          headers: {
            Authorization: `Basic ${Buffer.from(`${process.env.ZOOM_CLIENT_ID}:${process.env.ZOOM_CLIENT_SECRET}`).toString('base64')}`,
            'Content-Type': 'application/x-www-form-urlencoded'
          },
          timeout: 10000
        }
      );
      
      return {
        success: true,
        token: response.data.access_token,
        expiresIn: response.data.expires_in
      };
    } catch (error) {
      return {
        success: false,
        error: error.response?.data?.message || error.message,
        statusCode: error.response?.status
      };
    }
  }

  /**
   * Test basic API call
   */
  async testBasicApiCall(token) {
    try {
      const response = await axios.get(
        'https://api.zoom.us/v2/users/me',
        {
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json'
          },
          timeout: 10000
        }
      );
      
      return {
        success: true,
        data: {
          id: response.data.id,
          email: response.data.email,
          type: response.data.type,
          status: response.data.status
        }
      };
    } catch (error) {
      return {
        success: false,
        error: error.response?.data?.message || error.message,
        statusCode: error.response?.status
      };
    }
  }

  /**
   * Get meeting details for diagnosis
   */
  async getMeetingDetails(meetingId, token) {
    try {
      const response = await axios.get(
        `https://api.zoom.us/v2/meetings/${meetingId}`,
        {
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json'
          },
          timeout: 10000
        }
      );
      
      return {
        success: true,
        data: {
          id: response.data.id,
          topic: response.data.topic,
          type: response.data.type,
          status: response.data.status,
          start_time: response.data.start_time,
          duration: response.data.duration,
          timezone: response.data.timezone,
          created_at: response.data.created_at
        }
      };
    } catch (error) {
      return {
        success: false,
        error: error.response?.data?.message || error.message,
        statusCode: error.response?.status
      };
    }
  }

  /**
   * Get meeting participants for diagnosis
   */
  async getMeetingParticipants(meetingId, token) {
    try {
      const response = await axios.get(
        `https://api.zoom.us/v2/meetings/${meetingId}/participants`,
        {
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json'
          },
          params: {
            page_size: 300
          },
          timeout: 15000
        }
      );
      
      return {
        success: true,
        data: response.data.participants || []
      };
    } catch (error) {
      return {
        success: false,
        error: error.response?.data?.message || error.message,
        statusCode: error.response?.status
      };
    }
  }

  /**
   * Validate meeting ID format
   */
  validateMeetingIdFormat(meetingId) {
    if (!meetingId || typeof meetingId !== 'string') {
      return {
        isValid: false,
        error: 'Meeting ID is required',
        suggestions: ['Enter a valid Zoom meeting ID']
      };
    }

    const cleanId = meetingId.replace(/\D/g, '');
    
    if (cleanId.length < 9 || cleanId.length > 11) {
      return {
        isValid: false,
        error: 'Meeting ID should be 9-11 digits long',
        suggestions: [
          'Check your meeting invitation for the correct ID',
          'Meeting IDs are typically 9-11 digit numbers'
        ]
      };
    }

    return {
      isValid: true,
      formattedId: this.formatMeetingId(cleanId),
      cleanId
    };
  }

  /**
   * Format meeting ID
   */
  formatMeetingId(meetingId) {
    const cleanId = meetingId.replace(/\D/g, '');
    
    if (cleanId.length === 9) {
      return `${cleanId.slice(0, 3)}-${cleanId.slice(3, 6)}-${cleanId.slice(6)}`;
    } else if (cleanId.length === 10) {
      return `${cleanId.slice(0, 3)}-${cleanId.slice(3, 6)}-${cleanId.slice(6)}`;
    } else if (cleanId.length === 11) {
      return `${cleanId.slice(0, 3)}-${cleanId.slice(3, 7)}-${cleanId.slice(7)}`;
    }
    
    return cleanId;
  }

  /**
   * Analyze meeting status
   */
  analyzeMeetingStatus(meetingDetails) {
    const now = new Date();
    const startTime = new Date(meetingDetails.start_time);
    const analysis = {
      currentTime: now.toISOString(),
      startTime: startTime.toISOString(),
      status: meetingDetails.status,
      type: meetingDetails.type
    };

    if (meetingDetails.status === 'waiting') {
      analysis.interpretation = 'Meeting is scheduled but not started';
      analysis.canTrack = false;
      analysis.recommendation = 'Wait for the meeting to start';
    } else if (meetingDetails.status === 'started') {
      analysis.interpretation = 'Meeting is currently active';
      analysis.canTrack = true;
      analysis.recommendation = 'Good to start tracking';
    } else if (meetingDetails.status === 'ended') {
      analysis.interpretation = 'Meeting has ended';
      analysis.canTrack = false;
      analysis.recommendation = 'Use reports API for historical data';
    } else {
      analysis.interpretation = `Meeting status: ${meetingDetails.status}`;
      analysis.canTrack = false;
      analysis.recommendation = 'Check meeting status with host';
    }

    return analysis;
  }

  /**
   * Get tracking recommendation
   */
  getTrackingRecommendation(diagnostic) {
    if (diagnostic.errors.length > 0) {
      return {
        canTrack: false,
        reason: 'Errors detected',
        action: 'Fix errors before attempting to track',
        priority: 'high'
      };
    }

    if (diagnostic.meetingStatus && !diagnostic.meetingStatus.canTrack) {
      return {
        canTrack: false,
        reason: diagnostic.meetingStatus.interpretation,
        action: diagnostic.meetingStatus.recommendation,
        priority: 'medium'
      };
    }

    if (diagnostic.participantCount === 0) {
      return {
        canTrack: true,
        reason: 'Meeting exists but no participants yet',
        action: 'Can start tracking, participants will appear when they join',
        priority: 'low'
      };
    }

    return {
      canTrack: true,
      reason: 'Meeting is ready for tracking',
      action: 'Start tracking now',
      priority: 'high'
    };
  }

  /**
   * Get diagnostic history
   */
  getDiagnosticHistory(limit = 10) {
    return this.diagnosticHistory
      .slice(-limit)
      .reverse();
  }

  /**
   * Clear diagnostic history
   */
  clearDiagnosticHistory() {
    this.diagnosticHistory = [];
    return true;
  }

  /**
   * Generate diagnostic report
   */
  generateDiagnosticReport() {
    const report = {
      timestamp: new Date().toISOString(),
      totalTests: this.diagnosticHistory.length,
      recentTests: this.getDiagnosticHistory(5),
      summary: {
        successful: this.diagnosticHistory.filter(t => t.success).length,
        failed: this.diagnosticHistory.filter(t => !t.success).length,
        commonErrors: this.getCommonErrors(),
        recommendations: this.getSystemRecommendations()
      }
    };

    return report;
  }

  /**
   * Get common errors from diagnostic history
   */
  getCommonErrors() {
    const errorCounts = {};
    
    this.diagnosticHistory.forEach(test => {
      test.errors.forEach(error => {
        const errorKey = error.split(':')[0]; // Get error type
        errorCounts[errorKey] = (errorCounts[errorKey] || 0) + 1;
      });
    });

    return Object.entries(errorCounts)
      .sort(([,a], [,b]) => b - a)
      .slice(0, 5)
      .map(([error, count]) => ({ error, count }));
  }

  /**
   * Get system recommendations
   */
  getSystemRecommendations() {
    const recommendations = [];
    const recentTests = this.getDiagnosticHistory(10);
    
    const failureRate = recentTests.filter(t => !t.success).length / recentTests.length;
    
    if (failureRate > 0.5) {
      recommendations.push({
        type: 'high',
        message: 'High failure rate detected - check Zoom API credentials and connectivity'
      });
    }

    const tokenErrors = recentTests.filter(t => 
      t.errors.some(e => e.includes('token') || e.includes('auth'))
    ).length;
    
    if (tokenErrors > 0) {
      recommendations.push({
        type: 'medium',
        message: 'Authentication issues detected - verify environment variables'
      });
    }

    if (recommendations.length === 0) {
      recommendations.push({
        type: 'info',
        message: 'System is functioning normally'
      });
    }

    return recommendations;
  }
}

module.exports = MeetingDiagnostics;
