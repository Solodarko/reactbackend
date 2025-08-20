const axios = require('axios');
const jwt = require('jsonwebtoken');

class SimpleZoomService {
  constructor() {
    this.baseURL = 'https://api.zoom.us/v2';
    this.tokenCache = null;
    this.tokenExpiry = null;
  }

  // Get OAuth access token
  async getAccessToken() {
    // Check if we have a valid cached token
    if (this.tokenCache && this.tokenExpiry && Date.now() < this.tokenExpiry - 300000) {
      return this.tokenCache;
    }

    try {
      const { ZOOM_ACCOUNT_ID, ZOOM_CLIENT_ID, ZOOM_CLIENT_SECRET } = process.env;

      if (!ZOOM_ACCOUNT_ID || !ZOOM_CLIENT_ID || !ZOOM_CLIENT_SECRET) {
        throw new Error('Missing Zoom credentials in environment variables');
      }

      const response = await axios.post(
        `https://zoom.us/oauth/token?grant_type=account_credentials&account_id=${ZOOM_ACCOUNT_ID}`,
        {},
        {
          headers: {
            Authorization: `Basic ${Buffer.from(`${ZOOM_CLIENT_ID}:${ZOOM_CLIENT_SECRET}`).toString('base64')}`,
            'Content-Type': 'application/x-www-form-urlencoded'
          },
          timeout: 10000
        }
      );

      if (response.data && response.data.access_token) {
        this.tokenCache = response.data.access_token;
        this.tokenExpiry = Date.now() + (response.data.expires_in * 1000 || 3600000);
        console.log('✅ Zoom access token obtained');
        return this.tokenCache;
      } else {
        throw new Error('Invalid token response');
      }

    } catch (error) {
      console.error('❌ Failed to get Zoom access token:', error.response?.data || error.message);
      throw new Error(`Zoom authentication failed: ${error.response?.data?.error || error.message}`);
    }
  }

  // Generate JWT signature for SDK
  generateSignature(meetingNumber, role = 0) {
    const { ZOOM_CLIENT_ID, ZOOM_CLIENT_SECRET } = process.env;

    if (!ZOOM_CLIENT_ID || !ZOOM_CLIENT_SECRET) {
      throw new Error('Missing Zoom SDK credentials');
    }

    const iat = Math.round(Date.now() / 1000) - 30;
    const exp = iat + 60 * 60 * 2; // 2 hours

    const payload = {
      iss: ZOOM_CLIENT_ID,
      exp,
      iat,
      aud: 'zoom',
      appKey: ZOOM_CLIENT_ID,
      tokenExp: exp,
      alg: 'HS256'
    };

    if (meetingNumber) {
      payload.meetingNumber = meetingNumber.toString();
    }

    if (typeof role !== 'undefined') {
      payload.role = parseInt(role) || 0;
    }

    try {
      const signature = jwt.sign(payload, ZOOM_CLIENT_SECRET, { algorithm: 'HS256' });
      console.log('✅ JWT signature generated');
      return signature;
    } catch (error) {
      console.error('❌ Failed to generate JWT signature:', error);
      throw new Error('Failed to generate meeting signature');
    }
  }

  // Create a meeting
  async createMeeting(meetingData) {
    try {
      const token = await this.getAccessToken();

      const defaultMeetingData = {
        topic: 'New Meeting',
        type: 1, // Instant meeting
        duration: 5,
        settings: {
          host_video: true,
          participant_video: true,
          join_before_host: true,
          mute_upon_entry: false,
          waiting_room: false,
          approval_type: 0,
          audio: 'both',
          auto_recording: 'none'
        }
      };

      const finalMeetingData = {
        ...defaultMeetingData,
        ...meetingData,
        settings: {
          ...defaultMeetingData.settings,
          ...meetingData.settings
        }
      };

      const response = await axios.post(
        `${this.baseURL}/users/me/meetings`,
        finalMeetingData,
        {
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json'
          },
          timeout: 15000
        }
      );

      console.log('✅ Meeting created successfully:', response.data.id);
      return response.data;

    } catch (error) {
      console.error('❌ Failed to create meeting:', error.response?.data || error.message);
      
      if (error.response?.status === 429) {
        throw new Error('Rate limit exceeded. Please try again later.');
      }
      
      throw new Error(`Meeting creation failed: ${error.response?.data?.message || error.message}`);
    }
  }

  // Get meeting details
  async getMeetingDetails(meetingId) {
    try {
      const token = await this.getAccessToken();

      const response = await axios.get(
        `${this.baseURL}/meetings/${meetingId}`,
        {
          headers: {
            Authorization: `Bearer ${token}`
          },
          timeout: 10000
        }
      );

      return response.data;
    } catch (error) {
      console.error('❌ Failed to get meeting details:', error.response?.data || error.message);
      throw new Error(`Failed to get meeting details: ${error.response?.data?.message || error.message}`);
    }
  }

  // Get user info (for testing)
  async getUserInfo() {
    try {
      const token = await this.getAccessToken();

      const response = await axios.get(
        `${this.baseURL}/users/me`,
        {
          headers: {
            Authorization: `Bearer ${token}`
          },
          timeout: 10000
        }
      );

      return response.data;
    } catch (error) {
      console.error('❌ Failed to get user info:', error.response?.data || error.message);
      throw new Error(`Failed to get user info: ${error.response?.data?.message || error.message}`);
    }
  }

  // Health check
  async healthCheck() {
    try {
      await this.getUserInfo();
      return {
        status: 'healthy',
        timestamp: new Date().toISOString(),
        service: 'zoom-api'
      };
    } catch (error) {
      return {
        status: 'unhealthy',
        error: error.message,
        timestamp: new Date().toISOString(),
        service: 'zoom-api'
      };
    }
  }
}

module.exports = new SimpleZoomService();
