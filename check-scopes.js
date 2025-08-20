require('dotenv').config();
const axios = require('axios');

const ZOOM_ACCOUNT_ID = process.env.ZOOM_ACCOUNT_ID;
const ZOOM_CLIENT_ID = process.env.ZOOM_CLIENT_ID;
const ZOOM_CLIENT_SECRET = process.env.ZOOM_CLIENT_SECRET;

const getZoomAccessToken = async () => {
  try {
    console.log('Getting access token...');
    const response = await axios.post(
      `https://zoom.us/oauth/token?grant_type=account_credentials&account_id=${ZOOM_ACCOUNT_ID}`,
      {},
      {
        headers: {
          Authorization: `Basic ${Buffer.from(`${ZOOM_CLIENT_ID}:${ZOOM_CLIENT_SECRET}`).toString('base64')}`,
          'Content-Type': 'application/x-www-form-urlencoded'
        },
      }
    );
    console.log('Access token obtained successfully');
    console.log('Token details:', {
      access_token: response.data.access_token ? 'Present' : 'Missing',
      token_type: response.data.token_type,
      expires_in: response.data.expires_in,
      scope: response.data.scope
    });
    return response.data.access_token;
  } catch (error) {
    console.error('Error getting Zoom access token:', error.response ? error.response.data : error.message);
    throw error;
  }
};

const testUserInfo = async () => {
  try {
    const accessToken = await getZoomAccessToken();
    console.log('Testing user info endpoint...');
    
    const userResponse = await axios.get(
      'https://api.zoom.us/v2/users/me',
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
      }
    );

    console.log('User info retrieved successfully:', {
      id: userResponse.data.id,
      email: userResponse.data.email,
      first_name: userResponse.data.first_name,
      last_name: userResponse.data.last_name,
      account_id: userResponse.data.account_id
    });
  } catch (error) {
    console.error('Error getting user info:', error.response ? error.response.data : error.message);
  }
};

testUserInfo();
