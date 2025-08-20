#!/usr/bin/env node

const mongoose = require('mongoose');
require('dotenv').config();

const Participant = require('./models/Participant');

async function checkActiveParticipants() {
  try {
    console.log('🔍 Checking active participants for issues...\n');

    // Connect to MongoDB
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('✅ Connected to MongoDB\n');

    // Get all active participants
    const activeParticipants = await Participant.find({ isActive: true })
      .sort({ joinTime: -1 })
      .select('participantName meetingId joinTime leaveTime duration connectionStatus lastActivity createdAt');

    console.log(`Found ${activeParticipants.length} active participants:\n`);

    if (activeParticipants.length === 0) {
      console.log('No active participants found.');
      return;
    }

    const now = new Date();
    activeParticipants.forEach((p, i) => {
      const joinTime = p.joinTime ? new Date(p.joinTime) : null;
      const lastActivity = p.lastActivity ? new Date(p.lastActivity) : null;
      
      // Calculate how long they've been "active"
      const minutesActive = joinTime ? Math.round((now - joinTime) / (1000 * 60)) : 0;
      const minutesSinceActivity = lastActivity ? Math.round((now - lastActivity) / (1000 * 60)) : 0;
      
      console.log(`${i + 1}. ${p.participantName || 'Unknown'}`);
      console.log(`   Meeting: ${p.meetingId}`);
      console.log(`   Joined: ${joinTime ? joinTime.toISOString() : 'Unknown'} (${minutesActive} min ago)`);
      console.log(`   Last Activity: ${lastActivity ? lastActivity.toISOString() : 'Never'} (${minutesSinceActivity} min ago)`);
      console.log(`   Status: ${p.connectionStatus || 'unknown'}`);
      console.log(`   Leave Time: ${p.leaveTime || 'Still active'}`);
      console.log(`   Duration: ${p.duration || 'Not set'} min`);
      
      // Flag potential issues
      if (minutesActive > 180) { // 3+ hours
        console.log(`   ⚠️  ISSUE: Active for ${minutesActive} minutes - likely stuck`);
      }
      if (minutesSinceActivity > 60 && p.connectionStatus === 'joined') { // 1+ hour no activity
        console.log(`   ⚠️  ISSUE: No activity for ${minutesSinceActivity} minutes`);
      }
      
      console.log('');
    });

    // Check for meetings that should have ended
    console.log('🔍 Checking for meetings that should have ended...\n');
    const activeByMeeting = {};
    activeParticipants.forEach(p => {
      if (!activeByMeeting[p.meetingId]) {
        activeByMeeting[p.meetingId] = [];
      }
      activeByMeeting[p.meetingId].push(p);
    });

    for (const [meetingId, participants] of Object.entries(activeByMeeting)) {
      const oldestJoin = Math.min(...participants.map(p => p.joinTime ? new Date(p.joinTime) : new Date()));
      const minutesSinceStart = Math.round((now - oldestJoin) / (1000 * 60));
      
      console.log(`Meeting: ${meetingId}`);
      console.log(`   Active participants: ${participants.length}`);
      console.log(`   Oldest join: ${minutesSinceStart} minutes ago`);
      
      if (minutesSinceStart > 180) { // 3+ hours
        console.log(`   ⚠️  ISSUE: Meeting has been active for ${minutesSinceStart} minutes`);
        console.log(`   💡 SUGGESTION: Consider ending these participant sessions`);
      }
      console.log('');
    }

    // Provide cleanup suggestions
    const oldActiveParticipants = activeParticipants.filter(p => {
      const joinTime = p.joinTime ? new Date(p.joinTime) : new Date();
      const minutesActive = Math.round((now - joinTime) / (1000 * 60));
      return minutesActive > 180; // 3+ hours
    });

    if (oldActiveParticipants.length > 0) {
      console.log(`\n🧹 CLEANUP SUGGESTIONS:`);
      console.log(`Found ${oldActiveParticipants.length} participants that may be stuck.\n`);
      
      console.log(`To clean up these stuck participants, you can run:`);
      console.log(`\nmanual cleanup in MongoDB:\n`);
      
      oldActiveParticipants.forEach(p => {
        const joinTime = p.joinTime ? new Date(p.joinTime) : new Date();
        const estimatedDuration = Math.round((now - joinTime) / (1000 * 60));
        
        console.log(`db.participants.updateOne(`);
        console.log(`  { _id: ObjectId("${p._id}") },`);
        console.log(`  {`);
        console.log(`    $set: {`);
        console.log(`      isActive: false,`);
        console.log(`      leaveTime: new Date(),`);
        console.log(`      duration: ${estimatedDuration},`);
        console.log(`      connectionStatus: "force_ended",`);
        console.log(`      lastActivity: new Date()`);
        console.log(`    }`);
        console.log(`  }`);
        console.log(`)\n`);
      });
    }

  } catch (error) {
    console.error('❌ Error:', error.message);
    console.error('Full error:', error);
  } finally {
    await mongoose.disconnect();
    console.log('🔌 Disconnected from MongoDB');
    process.exit(0);
  }
}

// Run if called directly
if (require.main === module) {
  checkActiveParticipants();
}

module.exports = checkActiveParticipants;
