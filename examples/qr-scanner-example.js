/**
 * Example usage of QR Scanner Location API
 * Demonstrates how to use the coordinates 5.29836N,2.00042W with distance 15.02m
 */

const axios = require('axios');

// Base URL for your backend API
const BASE_URL = 'http://localhost:3000/api/attendance';

// Example QR Scanner data (from your coordinates)
const QR_SCANNER_DATA = {
  coordinates: {
    latitude: '5.29836N',    // or use decimal: 5.29836
    longitude: '2.00042W',   // or use decimal: -2.00042
  },
  distance: 15.02,
  note: 'QR Scanner in user dashboard'
};

// Example functions to interact with the API

/**
 * Record QR scanner location data for a student
 */
async function recordQRScannerLocation(studentId, meetingId = null, userLocation = null) {
  try {
    console.log(`📍 Recording QR scanner location for student ${studentId}...`);
    
    const response = await axios.post(`${BASE_URL}/qr-location`, {
      coordinates: QR_SCANNER_DATA.coordinates,
      distance: QR_SCANNER_DATA.distance,
      studentId: studentId,
      meetingId: meetingId,
      userLocation: userLocation
    });
    
    console.log('✅ QR Scanner location recorded successfully:');
    console.log(`   - Attendance ID: ${response.data.attendanceId}`);
    console.log(`   - Coordinates: ${response.data.location.coordinates.latitude}, ${response.data.location.coordinates.longitude}`);
    console.log(`   - Distance: ${response.data.location.distance}m`);
    console.log(`   - Verification: ${response.data.location.verification.status}`);
    
    return response.data;
    
  } catch (error) {
    console.error('❌ Error recording QR scanner location:', error.response?.data?.error || error.message);
    throw error;
  }
}

/**
 * Get QR scanner location information
 */
async function getQRLocationInfo(studentId = null, dateFrom = null, dateTo = null) {
  try {
    console.log('📊 Getting QR scanner location information...');
    
    const params = {};
    if (studentId) params.studentId = studentId;
    if (dateFrom) params.dateFrom = dateFrom;
    if (dateTo) params.dateTo = dateTo;
    
    const response = await axios.get(`${BASE_URL}/qr-location/info`, { params });
    
    console.log('✅ QR Location Info Retrieved:');
    console.log(`   - Total QR Scans: ${response.data.statistics.totalScans}`);
    console.log(`   - Unique Students: ${response.data.statistics.uniqueStudents}`);
    console.log(`   - Average Distance: ${response.data.statistics.averageDistance}m`);
    console.log(`   - Reference Location: ${response.data.qrScannerReference.coordinates.formatted.latitude}, ${response.data.qrScannerReference.coordinates.formatted.longitude}`);
    
    return response.data;
    
  } catch (error) {
    console.error('❌ Error getting QR location info:', error.response?.data?.error || error.message);
    throw error;
  }
}

/**
 * Validate user location against QR scanner position
 */
async function validateUserLocation(userLat, userLng, maxDistance = 50) {
  try {
    console.log(`🔍 Validating user location (${userLat}, ${userLng}) against QR scanner...`);
    
    const response = await axios.post(`${BASE_URL}/validate-location`, {
      userLocation: {
        lat: userLat,
        lng: userLng,
        accuracy: 10 // GPS accuracy in meters
      },
      qrScannerLocation: {
        latitude: 5.29836,
        longitude: -2.00042
      },
      maxDistance: maxDistance
    });
    
    console.log('✅ Location Validation Result:');
    console.log(`   - Valid: ${response.data.validation.isValid}`);
    console.log(`   - Distance: ${response.data.validation.distance}m`);
    console.log(`   - Max Allowed: ${response.data.validation.maxDistance}m`);
    console.log(`   - Message: ${response.data.validation.message}`);
    
    return response.data;
    
  } catch (error) {
    console.error('❌ Error validating location:', error.response?.data?.error || error.message);
    throw error;
  }
}

/**
 * Get enhanced dashboard with QR location stats
 */
async function getDashboardWithQRStats() {
  try {
    console.log('📊 Getting dashboard with QR location statistics...');
    
    const response = await axios.get(`${BASE_URL}/dashboard`);
    
    console.log('✅ Dashboard Retrieved:');
    console.log(`   - Total Meetings: ${response.data.overallStatistics.totalMeetings}`);
    console.log(`   - Total Participants: ${response.data.overallStatistics.totalParticipants}`);
    
    if (response.data.qrLocationStatistics) {
      console.log('📍 QR Location Statistics:');
      console.log(`   - Total QR Scans: ${response.data.qrLocationStatistics.totalScans}`);
      console.log(`   - Unique Students: ${response.data.qrLocationStatistics.uniqueStudents}`);
      console.log(`   - Average Distance: ${response.data.qrLocationStatistics.averageDistance}m`);
      console.log(`   - Reference: ${response.data.qrLocationStatistics.referenceLocation.coordinates.latitude}, ${response.data.qrLocationStatistics.referenceLocation.coordinates.longitude}`);
    }
    
    return response.data;
    
  } catch (error) {
    console.error('❌ Error getting dashboard:', error.response?.data?.error || error.message);
    throw error;
  }
}

// Example usage
async function runExamples() {
  try {
    console.log('🚀 QR Scanner Location API Examples');
    console.log('=====================================');
    
    // Example 1: Record QR scanner location for a student
    console.log('\n1. Recording QR scanner location...');
    await recordQRScannerLocation(12345, 'meeting-123', {
      lat: 5.29840,  // User's location (slightly different from QR scanner)
      lng: -2.00045,
      accuracy: 5,
      timestamp: new Date().toISOString()
    });
    
    // Example 2: Validate user location
    console.log('\n2. Validating user location...');
    await validateUserLocation(5.29840, -2.00045);  // Within range
    await validateUserLocation(5.30000, -2.00500);  // Possibly out of range
    
    // Example 3: Get QR location info
    console.log('\n3. Getting QR location information...');
    await getQRLocationInfo();
    
    // Example 4: Get enhanced dashboard
    console.log('\n4. Getting dashboard with QR statistics...');
    await getDashboardWithQRStats();
    
    console.log('\n✅ All examples completed successfully!');
    
  } catch (error) {
    console.error('\n❌ Example execution failed:', error.message);
  }
}

// Utility function to convert your coordinate format
function parseYourCoordinates(latStr, lngStr) {
  // Convert "5.29836N" to 5.29836 and "2.00042W" to -2.00042
  const latitude = parseFloat(latStr.replace(/[NSEW]/i, '')) * (latStr.toUpperCase().endsWith('S') ? -1 : 1);
  const longitude = parseFloat(lngStr.replace(/[NSEW]/i, '')) * (lngStr.toUpperCase().endsWith('W') ? -1 : 1);
  
  return { latitude, longitude };
}

// Export functions for use in other modules
module.exports = {
  recordQRScannerLocation,
  getQRLocationInfo,
  validateUserLocation,
  getDashboardWithQRStats,
  parseYourCoordinates,
  QR_SCANNER_DATA
};

// Run examples if this file is executed directly
if (require.main === module) {
  runExamples();
}
