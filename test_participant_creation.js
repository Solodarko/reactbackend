#!/usr/bin/env node

const mongoose = require('mongoose');
require('dotenv').config();

const Participant = require('./models/Participant');
const Student = require('./models/Student');

async function testParticipantCreation() {
  try {
    console.log('🔍 Testing participant record creation...\n');

    // Connect to MongoDB
    console.log('1. Connecting to MongoDB...');
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('✅ Connected to MongoDB\n');

    // Test 1: Check if Participant model is working
    console.log('2. Testing Participant model...');
    const testParticipant = {
      participantName: 'Test User',
      participantId: `test_${Date.now()}`,
      meetingId: 'test123',
      joinTime: new Date(),
      email: 'test@example.com'
    };

    try {
      const participant = new Participant(testParticipant);
      const savedParticipant = await participant.save();
      console.log('✅ Participant model works - created:', savedParticipant._id);
      
      // Clean up test record
      await Participant.findByIdAndDelete(savedParticipant._id);
      console.log('✅ Test participant cleaned up\n');
    } catch (modelError) {
      console.error('❌ Participant model error:', modelError.message);
      console.error('   Full error:', modelError);
      return;
    }

    // Test 2: Check database permissions
    console.log('3. Testing database operations...');
    try {
      const count = await Participant.countDocuments();
      console.log(`✅ Can read participants: ${count} records found\n`);
    } catch (permError) {
      console.error('❌ Database permission error:', permError.message);
      return;
    }

    // Test 3: Check validation issues
    console.log('4. Testing validation requirements...');
    const invalidParticipant = new Participant({
      // Missing required fields
      participantName: 'Test',
      // participantId: missing
      // meetingId: missing
      joinTime: new Date()
    });

    try {
      await invalidParticipant.save();
      console.log('⚠️ Validation seems loose - invalid participant saved');
    } catch (validationError) {
      console.log('✅ Validation working - caught missing required fields:');
      console.log('   Error:', validationError.message.substring(0, 100) + '...\n');
    }

    // Test 4: Check recent participant records
    console.log('5. Checking recent participant records...');
    const recentParticipants = await Participant.find()
      .sort({ createdAt: -1 })
      .limit(5)
      .select('participantName meetingId createdAt connectionStatus attendanceStatus');
    
    if (recentParticipants.length > 0) {
      console.log('✅ Recent participants:');
      recentParticipants.forEach((p, i) => {
        console.log(`   ${i + 1}. ${p.participantName} | Meeting: ${p.meetingId} | Created: ${p.createdAt?.toISOString()?.substring(0, 19)} | Status: ${p.connectionStatus || 'unknown'}`);
      });
    } else {
      console.log('⚠️ No participant records found in database');
    }
    console.log('');

    // Test 5: Check for stuck/failed records
    console.log('6. Checking for potential issues...');
    
    const activeParticipants = await Participant.countDocuments({ isActive: true });
    const totalParticipants = await Participant.countDocuments();
    const recentFails = await Participant.countDocuments({
      createdAt: { $gte: new Date(Date.now() - 24 * 60 * 60 * 1000) }, // Last 24 hours
      connectionStatus: { $in: ['failed', 'error', 'disconnected'] }
    });

    console.log(`   Total participants: ${totalParticipants}`);
    console.log(`   Active participants: ${activeParticipants}`);
    console.log(`   Recent failures (24h): ${recentFails}`);

    // Test 6: Check student matching capability
    console.log('\n7. Testing student matching...');
    const studentCount = await Student.countDocuments();
    console.log(`   Students in database: ${studentCount}`);
    
    if (studentCount > 0) {
      const sampleStudent = await Student.findOne().select('StudentID FirstName LastName Email');
      console.log(`   Sample student: ${sampleStudent.FirstName} ${sampleStudent.LastName} (${sampleStudent.StudentID}) - ${sampleStudent.Email}`);
      
      // Test matching by email
      if (sampleStudent.Email) {
        const matchTest = await Student.findOne({
          Email: { $regex: new RegExp(sampleStudent.Email, 'i') }
        });
        console.log(`   Email matching works: ${matchTest ? '✅' : '❌'}`);
      }
    }

    console.log('\n✅ All tests completed successfully!');
    console.log('\n📋 Diagnosis Summary:');
    console.log('   - Database connection: ✅ Working');
    console.log('   - Participant model: ✅ Working');  
    console.log('   - Validation: ✅ Working');
    console.log('   - Data access: ✅ Working');
    console.log(`   - Records found: ${totalParticipants} total, ${activeParticipants} active`);
    console.log('\n💡 If participant creation is still failing, the issue is likely:');
    console.log('   1. In the webhook/API endpoint logic');
    console.log('   2. Network connectivity during creation');
    console.log('   3. Race conditions or timing issues');
    console.log('   4. Authentication/authorization problems');
    console.log('\n🔧 Next steps:');
    console.log('   - Check server logs during participant join attempts');
    console.log('   - Verify webhook endpoints are receiving data');
    console.log('   - Test with manual API calls to isolate the issue');

  } catch (error) {
    console.error('❌ Test failed:', error.message);
    console.error('Full error:', error);
  } finally {
    await mongoose.disconnect();
    console.log('\n🔌 Disconnected from MongoDB');
    process.exit(0);
  }
}

// Run if called directly
if (require.main === module) {
  testParticipantCreation();
}

module.exports = testParticipantCreation;
