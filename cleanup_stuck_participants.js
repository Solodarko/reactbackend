#!/usr/bin/env node

const mongoose = require('mongoose');
require('dotenv').config();

const Participant = require('./models/Participant');

async function cleanupStuckParticipants() {
  try {
    console.log('🧹 Cleaning up stuck participant sessions...\n');

    await mongoose.connect(process.env.MONGODB_URI);
    console.log('✅ Connected to MongoDB\n');

    const now = new Date();
    const threeHoursAgo = new Date(now - 3 * 60 * 60 * 1000); // 3 hours ago

    // Find participants that have been active for more than 3 hours
    const stuckParticipants = await Participant.find({
      isActive: true,
      joinTime: { $lt: threeHoursAgo }
    });

    console.log(`Found ${stuckParticipants.length} stuck participants to clean up:\n`);

    if (stuckParticipants.length === 0) {
      console.log('No stuck participants found. All sessions look normal.');
      return;
    }

    let cleanedCount = 0;

    for (const participant of stuckParticipants) {
      const joinTime = new Date(participant.joinTime);
      const estimatedDuration = Math.round((now - joinTime) / (1000 * 60)); // minutes
      const hoursStuck = Math.round(estimatedDuration / 60 * 10) / 10; // rounded to 1 decimal

      console.log(`🔧 Cleaning up: ${participant.participantName}`);
      console.log(`   Meeting: ${participant.meetingId}`);
      console.log(`   Stuck for: ${hoursStuck} hours (${estimatedDuration} minutes)`);

      // Update the participant to mark as left
      await Participant.findByIdAndUpdate(participant._id, {
        $set: {
          isActive: false,
          leaveTime: now,
          duration: estimatedDuration,
          connectionStatus: 'auto_cleanup',
          lastActivity: now,
          attendanceStatus: estimatedDuration >= 60 ? 'Present' : 'Left Early'
        }
      });

      cleanedCount++;
      console.log(`   ✅ Cleaned up successfully\n`);
    }

    console.log(`\n🎉 Cleanup completed!`);
    console.log(`   Cleaned up: ${cleanedCount} stuck participants`);
    console.log(`   Status: All participants now properly ended\n`);

    // Verify cleanup
    const remainingActive = await Participant.countDocuments({ isActive: true });
    const recentActive = await Participant.countDocuments({
      isActive: true,
      joinTime: { $gte: new Date(now - 2 * 60 * 60 * 1000) } // Last 2 hours
    });

    console.log(`📊 Current Status:`);
    console.log(`   Total active participants: ${remainingActive}`);
    console.log(`   Recent active (last 2h): ${recentActive}`);

    if (remainingActive > 0 && recentActive === remainingActive) {
      console.log(`   ✅ All remaining active participants are recent (within 2 hours)`);
    } else if (remainingActive > recentActive) {
      console.log(`   ⚠️  Warning: ${remainingActive - recentActive} participants still marked active from >2 hours ago`);
    }

  } catch (error) {
    console.error('❌ Error during cleanup:', error.message);
    console.error('Full error:', error);
  } finally {
    await mongoose.disconnect();
    console.log('\n🔌 Disconnected from MongoDB');
    process.exit(0);
  }
}

if (require.main === module) {
  cleanupStuckParticipants();
}

module.exports = cleanupStuckParticipants;
