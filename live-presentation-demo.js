const axios = require('axios');
const jwt = require('jsonwebtoken');
const io = require('socket.io-client');

/**
 * LIVE PRESENTATION DEMO SCRIPT
 * Real-time Zoom Meeting Attendance Tracking System
 * 
 * This script creates a live demonstration with simulated participants
 * joining and leaving a meeting to showcase the unified attendance tracking system.
 */

const BASE_URL = 'http://localhost:5000/api';
const MEETING_ID = '85233671814';

// Demo participants with realistic profiles
const demoParticipants = [
  {
    name: 'Alice Johnson',
    email: 'alice.johnson@university.edu',
    role: 'student',
    studentId: 'STU001',
    department: 'Computer Science',
    behavior: 'excellent' // Will attend full meeting
  },
  {
    name: 'Bob Smith',
    email: 'bob.smith@university.edu',
    role: 'student',
    studentId: 'STU002',
    department: 'Engineering',
    behavior: 'good' // Will attend most of meeting
  },
  {
    name: 'Charlie Brown',
    email: 'charlie.brown@university.edu',
    role: 'student',
    studentId: 'STU003',
    department: 'Mathematics',
    behavior: 'poor' // Will leave early
  },
  {
    name: 'Diana Prince',
    email: 'diana.prince@university.edu',
    role: 'student',
    studentId: 'STU004',
    department: 'Physics',
    behavior: 'late_joiner' // Will join late but stay
  },
  {
    name: 'Prof. Wilson',
    email: 'prof.wilson@university.edu',
    role: 'admin',
    department: 'Computer Science',
    behavior: 'host' // Will be present throughout
  }
];

let socket = null;
let activeDemoParticipants = [];
let demoStats = {
  totalJoined: 0,
  currentActive: 0,
  totalLeft: 0
};

/**
 * Create JWT token for demo participant
 */
function createDemoToken(participant) {
  const payload = {
    id: `demo_${participant.studentId || Date.now()}`,
    name: participant.name,
    email: participant.email,
    role: participant.role,
    studentId: participant.studentId,
    department: participant.department,
    iat: Math.floor(Date.now() / 1000),
    exp: Math.floor(Date.now() / 1000) + (60 * 60 * 2) // 2 hours
  };

  const secret = process.env.JWT_SECRET || 'demo_secret_key';
  return jwt.sign(payload, secret);
}

/**
 * Connect to WebSocket for real-time updates
 */
function connectToWebSocket() {
  return new Promise((resolve, reject) => {
    console.log('🔌 Connecting to WebSocket for real-time updates...');
    
    socket = io('http://localhost:5000', {
      transports: ['websocket', 'polling'],
      timeout: 5000
    });

    socket.on('connect', () => {
      console.log('✅ Connected to WebSocket server');
      socket.emit('joinMeeting', MEETING_ID);
      resolve();
    });

    socket.on('connect_error', (error) => {
      console.error('❌ WebSocket connection error:', error.message);
      reject(error);
    });

    socket.on('participantJoined', (data) => {
      console.log(`📡 [REAL-TIME] ${data.participant.displayName} joined the meeting`);
      demoStats.currentActive++;
      displayLiveStats();
    });

    socket.on('participantLeft', (data) => {
      console.log(`📡 [REAL-TIME] ${data.participant.displayName} left the meeting`);
      console.log(`   Final Status: ${data.participant.attendanceStatus} (${data.participant.attendancePercentage}%)`);
      demoStats.currentActive--;
      demoStats.totalLeft++;
      displayLiveStats();
    });

    socket.on('attendance85Update', (data) => {
      if (data.action === 'joined') {
        console.log(`📊 [ATTENDANCE] ${data.participant.displayName} - Status: ${data.participant.attendanceStatus}`);
      } else if (data.action === 'left') {
        console.log(`📊 [ATTENDANCE] ${data.participant.displayName} - Final: ${data.participant.attendanceStatus}`);
      }
    });
  });
}

/**
 * Display live statistics during demo
 */
function displayLiveStats() {
  console.log('\n┌─────────────────────────────────────┐');
  console.log('│         📊 LIVE DEMO STATS          │');
  console.log('├─────────────────────────────────────┤');
  console.log(`│ Total Joined:      ${demoStats.totalJoined.toString().padStart(3)}            │`);
  console.log(`│ Currently Active:  ${demoStats.currentActive.toString().padStart(3)}            │`);
  console.log(`│ Total Left:        ${demoStats.totalLeft.toString().padStart(3)}            │`);
  console.log('└─────────────────────────────────────┘\n');
}

/**
 * Simulate participant joining meeting
 */
async function simulateParticipantJoin(participant) {
  try {
    const token = createDemoToken(participant);
    
    console.log(`👋 [DEMO JOIN] ${participant.name} is joining the meeting...`);

    const response = await axios.post(`${BASE_URL}/attendance-unified/checkin/${MEETING_ID}`, {}, {
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      }
    });

    if (response.data.success) {
      console.log(`✅ [DEMO JOIN] ${participant.name} successfully joined`);
      console.log(`   Status: ${response.data.participant.attendanceStatus}`);
      
      activeDemoParticipants.push({
        participant,
        token,
        joinTime: new Date(),
        status: 'active'
      });
      
      demoStats.totalJoined++;
      return { success: true, token, participant };
    } else {
      console.log(`❌ [DEMO JOIN] Failed: ${response.data.error}`);
      return { success: false, error: response.data.error };
    }

  } catch (error) {
    console.log(`❌ [DEMO JOIN] Error for ${participant.name}: ${error.message}`);
    return { success: false, error: error.message };
  }
}

/**
 * Simulate participant leaving meeting
 */
async function simulateParticipantLeave(participantData) {
  try {
    const { participant, token } = participantData;
    
    console.log(`👋 [DEMO LEAVE] ${participant.name} is leaving the meeting...`);

    const response = await axios.post(`${BASE_URL}/attendance-unified/checkout/${MEETING_ID}`, {}, {
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      }
    });

    if (response.data.success) {
      console.log(`✅ [DEMO LEAVE] ${participant.name} successfully left`);
      console.log(`   Duration: ${response.data.duration} minutes`);
      console.log(`   Attendance: ${response.data.percentage}%`);
      console.log(`   Status: ${response.data.status}`);
      console.log(`   Meets 85% Threshold: ${response.data.meetsThreshold ? '✅ YES' : '❌ NO'}`);
      
      // Remove from active participants
      const index = activeDemoParticipants.findIndex(p => p.participant.email === participant.email);
      if (index > -1) {
        activeDemoParticipants[index].status = 'left';
      }
      
      return { success: true, response: response.data };
    } else {
      console.log(`❌ [DEMO LEAVE] Failed: ${response.data.error}`);
      return { success: false, error: response.data.error };
    }

  } catch (error) {
    console.log(`❌ [DEMO LEAVE] Error for ${participant.name}: ${error.message}`);
    return { success: false, error: error.message };
  }
}

/**
 * Get current attendance data
 */
async function getCurrentAttendanceData() {
  try {
    console.log('\n📊 [DEMO DATA] Fetching current attendance data...');

    const response = await axios.get(`${BASE_URL}/attendance-unified/meeting/${MEETING_ID}?threshold=85`);

    if (response.data.success) {
      const { participants, statistics } = response.data;

      console.log('\n🎯 UNIFIED ATTENDANCE TRACKING RESULTS');
      console.log('═'.repeat(80));
      
      console.log('\n📈 Meeting Statistics:');
      console.log(`   📊 Total Participants: ${statistics.totalParticipants}`);
      console.log(`   ✅ Present (≥85%): ${statistics.presentCount}`);
      console.log(`   ❌ Absent (<85%): ${statistics.absentCount}`);
      console.log(`   🔄 In Progress: ${statistics.inProgressCount}`);
      console.log(`   🔐 Authenticated: ${statistics.authenticatedCount}`);
      console.log(`   📊 Attendance Rate: ${statistics.attendanceRate}%`);
      console.log(`   ⏱️ Average Duration: ${statistics.averageDuration} min`);

      console.log('\n👥 Participant Attendance Table:');
      console.log('┌─────────────────────┬──────────────────────────┬─────────┬────────────┬─────────────┬────────────┐');
      console.log('│ Name                │ Email                    │ Duration│ Percentage │ Status      │ Source     │');
      console.log('├─────────────────────┼──────────────────────────┼─────────┼────────────┼─────────────┼────────────┤');

      participants.forEach(participant => {
        const name = truncateString(participant.displayName, 19);
        const email = truncateString(participant.email, 24);
        const duration = `${participant.duration} min`.padEnd(7);
        const percentage = `${participant.attendancePercentage}%`.padEnd(10);
        const status = getStatusDisplay(participant.attendanceStatus, 11);
        const source = participant.source === 'jwt_token' ? 'Token     ' : 'Webhook   ';

        console.log(`│ ${name.padEnd(19)} │ ${email.padEnd(24)} │ ${duration} │ ${percentage} │ ${status} │ ${source} │`);
      });

      console.log('└─────────────────────┴──────────────────────────┴─────────┴────────────┴─────────────┴────────────┘');

      return { success: true, participants, statistics };
    } else {
      console.log('❌ Failed to get attendance data:', response.data.error);
      return { success: false, error: response.data.error };
    }

  } catch (error) {
    console.log('❌ Error getting attendance data:', error.message);
    return { success: false, error: error.message };
  }
}

/**
 * Clear meeting data for fresh demo
 */
async function clearMeetingData() {
  try {
    console.log('🗑️ [DEMO SETUP] Clearing previous meeting data...');
    
    const response = await axios.delete(`${BASE_URL}/attendance-unified/meeting/${MEETING_ID}/clear`);
    
    if (response.data.success) {
      console.log(`✅ [DEMO SETUP] Cleared ${response.data.deletedCount} participants`);
    } else {
      console.log('⚠️ [DEMO SETUP] No data to clear');
    }
    
    // Reset demo stats
    demoStats = {
      totalJoined: 0,
      currentActive: 0,
      totalLeft: 0
    };
    activeDemoParticipants = [];
    
  } catch (error) {
    console.log('⚠️ [DEMO SETUP] Error clearing data:', error.message);
  }
}

/**
 * Simulate realistic meeting behavior based on participant profiles
 */
async function simulateRealisticMeetingFlow() {
  console.log('\n🎭 SIMULATING REALISTIC MEETING FLOW');
  console.log('═'.repeat(60));
  
  // Phase 1: Initial participants join (0-30 seconds)
  console.log('\n📅 Phase 1: Meeting Start - Initial participants joining...');
  
  const initialParticipants = demoParticipants.filter(p => 
    ['excellent', 'good', 'poor', 'host'].includes(p.behavior)
  );
  
  for (const participant of initialParticipants) {
    await simulateParticipantJoin(participant);
    await sleep(Math.random() * 3000 + 2000); // Random delay 2-5 seconds
  }
  
  await getCurrentAttendanceData();
  await sleep(5000);
  
  // Phase 2: Poor attendee leaves early (simulating 20 minutes into meeting)
  console.log('\n📅 Phase 2: Early departures...');
  const poorAttendee = activeDemoParticipants.find(p => p.participant.behavior === 'poor');
  if (poorAttendee) {
    console.log(`⚠️ [DEMO] Simulating early departure (${poorAttendee.participant.name} attending only 20 minutes)...`);
    await simulateParticipantLeave(poorAttendee);
  }
  
  await sleep(3000);
  
  // Phase 3: Late joiner arrives
  console.log('\n📅 Phase 3: Late arrivals...');
  const lateJoiner = demoParticipants.find(p => p.behavior === 'late_joiner');
  if (lateJoiner) {
    console.log(`🕐 [DEMO] Simulating late arrival (${lateJoiner.name} joining 25 minutes late)...`);
    await simulateParticipantJoin(lateJoiner);
  }
  
  await getCurrentAttendanceData();
  await sleep(5000);
  
  // Phase 4: Meeting conclusion - remaining participants leave
  console.log('\n📅 Phase 4: Meeting conclusion - participants leaving...');
  const stillActive = activeDemoParticipants.filter(p => p.status === 'active');
  
  // Good and excellent attendees stay for full meeting
  for (const participantData of stillActive) {
    if (['excellent', 'good', 'host', 'late_joiner'].includes(participantData.participant.behavior)) {
      console.log(`✅ [DEMO] ${participantData.participant.name} completing full attendance...`);
      await simulateParticipantLeave(participantData);
      await sleep(2000);
    }
  }
  
  console.log('\n📅 Phase 5: Final attendance report...');
  await getCurrentAttendanceData();
}

/**
 * Run interactive demo with user prompts
 */
async function runInteractiveDemo() {
  console.log('\n🎮 INTERACTIVE DEMO MODE');
  console.log('═'.repeat(50));
  console.log('Press ENTER to advance through each step of the demo...\n');
  
  await waitForEnter('Press ENTER to start the meeting demo...');
  
  // Step 1: Clear data
  await clearMeetingData();
  await waitForEnter('Press ENTER to begin participant joining...');
  
  // Step 2: Participants join one by one
  for (const participant of demoParticipants) {
    if (participant.behavior !== 'late_joiner') {
      await waitForEnter(`Press ENTER for ${participant.name} to join...`);
      await simulateParticipantJoin(participant);
    }
  }
  
  await waitForEnter('Press ENTER to view current attendance...');
  await getCurrentAttendanceData();
  
  // Step 3: Early departure
  await waitForEnter('Press ENTER to simulate early departure...');
  const poorAttendee = activeDemoParticipants.find(p => p.participant.behavior === 'poor');
  if (poorAttendee) {
    await simulateParticipantLeave(poorAttendee);
  }
  
  // Step 4: Late joiner
  await waitForEnter('Press ENTER for late joiner to arrive...');
  const lateJoiner = demoParticipants.find(p => p.behavior === 'late_joiner');
  if (lateJoiner) {
    await simulateParticipantJoin(lateJoiner);
  }
  
  await waitForEnter('Press ENTER to view updated attendance...');
  await getCurrentAttendanceData();
  
  // Step 5: Meeting ends
  await waitForEnter('Press ENTER to end the meeting (all participants leave)...');
  const stillActive = activeDemoParticipants.filter(p => p.status === 'active');
  for (const participantData of stillActive) {
    await simulateParticipantLeave(participantData);
  }
  
  await waitForEnter('Press ENTER to view final attendance report...');
  await getCurrentAttendanceData();
}

/**
 * Wait for user to press ENTER
 */
function waitForEnter(prompt) {
  return new Promise((resolve) => {
    const readline = require('readline');
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout
    });
    
    rl.question(prompt, () => {
      rl.close();
      resolve();
    });
  });
}

/**
 * Check server health before starting demo
 */
async function checkServerHealth() {
  try {
    const response = await axios.get(`${BASE_URL}/attendance-unified/health`);
    if (response.data.success) {
      console.log('✅ Server health check passed');
      return true;
    }
  } catch (error) {
    console.error('❌ Server health check failed:', error.message);
    console.error('   Please ensure the backend server is running (npm start)');
    return false;
  }
}

/**
 * Utility functions
 */
function truncateString(str, maxLength) {
  if (!str) return 'N/A';
  return str.length > maxLength ? str.substring(0, maxLength - 3) + '...' : str;
}

function getStatusDisplay(status, width = 11) {
  const displays = {
    'Present': '✅ Present ',
    'Absent': '❌ Absent  ',
    'In Progress': '🔄 Progress',
    'Unknown': '❓ Unknown '
  };
  const display = displays[status] || status;
  return display.padEnd(width);
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Display usage instructions
 */
function displayUsageInstructions() {
  console.log('\n🎯 PRESENTATION DEMO USAGE');
  console.log('═'.repeat(50));
  console.log('This demo script offers multiple modes:');
  console.log('');
  console.log('1. 📺 Full Auto Demo:    node live-presentation-demo.js auto');
  console.log('2. 🎮 Interactive Demo:  node live-presentation-demo.js interactive');
  console.log('3. 🧹 Clear Data Only:   node live-presentation-demo.js clear');
  console.log('');
  console.log('For your presentation, use Interactive Mode for full control!');
  console.log('');
}

/**
 * Main demo function
 */
async function main() {
  const mode = process.argv[2] || 'auto';
  
  console.log('🎬 UNIFIED ATTENDANCE TRACKING SYSTEM');
  console.log('🎯 LIVE PRESENTATION DEMO');
  console.log('═'.repeat(60));
  console.log(`📅 Meeting ID: ${MEETING_ID}`);
  console.log(`🎭 Demo Mode: ${mode.toUpperCase()}`);
  console.log('═'.repeat(60));
  
  // Check server health
  const serverOk = await checkServerHealth();
  if (!serverOk) {
    console.log('\n🚨 Cannot proceed - server not accessible');
    return;
  }
  
  // Connect to WebSocket
  try {
    await connectToWebSocket();
  } catch (error) {
    console.log('⚠️ WebSocket connection failed, continuing without real-time updates');
  }
  
  switch (mode.toLowerCase()) {
    case 'auto':
      await clearMeetingData();
      await sleep(2000);
      await simulateRealisticMeetingFlow();
      break;
      
    case 'interactive':
      await runInteractiveDemo();
      break;
      
    case 'clear':
      await clearMeetingData();
      console.log('✅ Meeting data cleared');
      break;
      
    default:
      displayUsageInstructions();
      break;
  }
  
  if (socket) {
    socket.disconnect();
    console.log('🔌 WebSocket disconnected');
  }
  
  console.log('\n🎬 Demo completed successfully!');
  console.log('\n📊 Key Features Demonstrated:');
  console.log('✅ Real-time participant tracking');
  console.log('✅ JWT token-based authentication');
  console.log('✅ 85% attendance threshold calculation');
  console.log('✅ WebSocket live updates');
  console.log('✅ Comprehensive attendance statistics');
  console.log('✅ Multiple participant behavior patterns');
  
  process.exit(0);
}

// Handle process termination gracefully
process.on('SIGINT', () => {
  console.log('\n\n👋 Demo interrupted by user');
  if (socket) {
    socket.disconnect();
  }
  process.exit(0);
});

if (require.main === module) {
  main().catch(error => {
    console.error('💥 Demo failed:', error.message);
    process.exit(1);
  });
}

module.exports = {
  simulateParticipantJoin,
  simulateParticipantLeave,
  getCurrentAttendanceData,
  clearMeetingData
};
