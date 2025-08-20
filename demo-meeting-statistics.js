const axios = require('axios');

/**
 * Meeting Participants Tracker Statistics Demo
 * Shows comprehensive meeting statistics exactly like your requested format
 */

const BASE_URL = 'http://localhost:5000/api';
const MEETING_ID = '85233671814'; // Test meeting ID

/**
 * Display meeting statistics in the format you requested
 */
function displayMeetingStatistics(statistics) {
  console.log('\n📊 Meeting Participants Tracker Statistics:');
  console.log('=' .repeat(50));
  
  // Display in the exact format you showed
  console.log('\nObject {');
  console.log(`  totalParticipants: ${statistics.totalParticipants},`);
  console.log(`  presentCount: ${statistics.presentCount},`);
  console.log(`  absentCount: ${statistics.absentCount},`);
  console.log(`  averageAttendance: ${statistics.averageAttendance},`);
  console.log(`  meetingDuration: ${statistics.meetingDuration},`);
  console.log(`  attendanceRate: ${statistics.attendanceRate},`);
  console.log(`  thresholdDuration: ${statistics.thresholdDuration},`);
  console.log(`  threshold: ${statistics.threshold}`);
  console.log('}');

  // Individual property display (as shown in your example)
  console.log('\n📋 Individual Properties:');
  console.log(`absentCount: ${statistics.absentCount}`);
  console.log(`attendanceRate: ${statistics.attendanceRate}`);
  console.log(`averageAttendance: ${statistics.averageAttendance}`);
  console.log(`meetingDuration: ${statistics.meetingDuration}`);
  console.log(`presentCount: ${statistics.presentCount}`);
  console.log(`threshold: ${statistics.threshold}`);
  console.log(`thresholdDuration: ${statistics.thresholdDuration}`);
  console.log(`totalParticipants: ${statistics.totalParticipants}`);

  // Additional comprehensive statistics
  if (statistics.averageDuration !== undefined) {
    console.log('\n🔍 Extended Statistics:');
    console.log(`inProgressCount: ${statistics.inProgressCount}`);
    console.log(`averageDuration: ${statistics.averageDuration} minutes`);
    console.log(`longestSession: ${statistics.longestSession} minutes`);
    console.log(`shortestSession: ${statistics.shortestSession} minutes`);
    console.log(`totalActiveDuration: ${statistics.totalActiveDuration} minutes`);
    console.log(`participationEfficiency: ${statistics.participationEfficiency}%`);
    console.log(`meetingUtilization: ${statistics.meetingUtilization}%`);
    console.log(`authenticatedCount: ${statistics.authenticatedCount}`);
  }
}

/**
 * Get token-based meeting statistics
 */
async function getTokenMeetingStatistics(meetingId, threshold = 85) {
  try {
    console.log(`🔍 Fetching token-based meeting statistics for meeting: ${meetingId}`);
    
    const response = await axios.get(`${BASE_URL}/token-attendance/meeting/${meetingId}?threshold=${threshold}`);
    
    if (response.data.success) {
      console.log('✅ Successfully fetched meeting statistics');
      return response.data.statistics;
    } else {
      console.log('❌ Failed to fetch statistics:', response.data.error);
      return null;
    }
  } catch (error) {
    console.error('❌ Error fetching statistics:', error.message);
    return null;
  }
}

/**
 * Get regular attendance tracker statistics (for comparison)
 */
async function getRegularMeetingStatistics(meetingId) {
  try {
    console.log(`🔍 Fetching regular meeting statistics for meeting: ${meetingId}`);
    
    const response = await axios.get(`${BASE_URL}/attendance-tracker/meeting-stats/${meetingId}`);
    
    if (response.data && response.data.success !== false) {
      console.log('✅ Successfully fetched regular meeting statistics');
      return response.data;
    } else {
      console.log('ℹ️ No regular meeting statistics available');
      return null;
    }
  } catch (error) {
    console.log('ℹ️ Regular statistics not available:', error.message);
    return null;
  }
}

/**
 * Create sample meeting data for demonstration
 */
function createSampleStatistics() {
  return {
    totalParticipants: 0,
    presentCount: 0,
    absentCount: 0,
    averageAttendance: 0,
    meetingDuration: 60,
    attendanceRate: 0,
    thresholdDuration: 51,
    threshold: 85,
    inProgressCount: 0,
    averageDuration: 0,
    longestSession: 0,
    shortestSession: 0,
    totalActiveDuration: 0,
    participationEfficiency: 0,
    meetingUtilization: 0,
    authenticatedCount: 0
  };
}

/**
 * Main demo function
 */
async function main() {
  try {
    console.log('🚀 Meeting Participants Tracker Statistics Demo');
    console.log('================================================');
    
    // Check if server is running
    try {
      await axios.get(`${BASE_URL}/health`);
      console.log('✅ Backend server is running');
    } catch {
      console.error('❌ Backend server is not running. Starting with sample data...');
      const sampleStats = createSampleStatistics();
      displayMeetingStatistics(sampleStats);
      return;
    }

    // Try to get token-based statistics
    console.log('\n📊 Attempting to fetch token-based meeting statistics...');
    const tokenStats = await getTokenMeetingStatistics(MEETING_ID);
    
    if (tokenStats) {
      console.log('\n🎯 Token-Based Meeting Statistics:');
      displayMeetingStatistics(tokenStats);
    }

    // Try to get regular statistics for comparison
    console.log('\n📊 Attempting to fetch regular meeting statistics...');
    const regularStats = await getRegularMeetingStatistics(MEETING_ID);
    
    if (regularStats) {
      console.log('\n🔍 Regular Meeting Statistics (for comparison):');
      displayMeetingStatistics(regularStats);
    }

    // If no data available, show sample structure
    if (!tokenStats && !regularStats) {
      console.log('\n📊 No meeting data found. Showing sample statistics structure:');
      const sampleStats = createSampleStatistics();
      displayMeetingStatistics(sampleStats);
    }

    console.log('\n📋 Integration Notes:');
    console.log('=====================');
    console.log('✅ These statistics can be integrated into any Meeting Participants Tracker');
    console.log('✅ Available via API endpoint: /api/token-attendance/meeting/{meetingId}');
    console.log('✅ Real-time updates via WebSocket events');
    console.log('✅ Compatible with existing attendance tracking systems');
    console.log('✅ Supports custom threshold values (default: 85%)');

    console.log('\n🔧 Usage in Frontend:');
    console.log('```javascript');
    console.log('const response = await fetch("/api/token-attendance/meeting/85233671814?threshold=85");');
    console.log('const { statistics } = await response.json();');
    console.log('');
    console.log('// Use statistics object directly:');
    console.log('console.log(statistics.totalParticipants);');
    console.log('console.log(statistics.attendanceRate);');
    console.log('console.log(statistics.averageAttendance);');
    console.log('```');

  } catch (error) {
    console.error('💥 Demo failed:', error.message);
  }
}

// Run the demo
if (require.main === module) {
  main().catch(console.error);
}

module.exports = {
  displayMeetingStatistics,
  getTokenMeetingStatistics,
  createSampleStatistics
};
