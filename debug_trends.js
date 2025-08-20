const mongoose = require('mongoose');
require('dotenv').config();

const Participant = require('./models/Participant');
const Student = require('./models/Student');

async function debugTrendsError() {
  try {
    console.log('🔍 Connecting to MongoDB...');
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('✅ Connected to MongoDB');

    // Check participants with studentId
    console.log('\n📊 Checking Participant collection...');
    const participants = await Participant.find({ studentId: { $exists: true } }).limit(5);
    console.log('Sample participants with studentId:');
    participants.forEach(p => {
      console.log(`  - ID: ${p._id}, studentId: ${p.studentId} (${typeof p.studentId})`);
    });

    // Get unique studentIds
    const allParticipants = await Participant.find({});
    const studentIds = allParticipants.map(p => p.studentId).filter(Boolean);
    const uniqueStudentIds = [...new Set(studentIds)];
    console.log(`\n🔢 Found ${uniqueStudentIds.length} unique studentIds:`, uniqueStudentIds);

    // Try to find students with these IDs
    console.log('\n🎓 Checking Student collection...');
    const students = await Student.find({ StudentID: { $in: uniqueStudentIds } });
    console.log(`Found ${students.length} matching students in Student collection`);
    
    if (students.length > 0) {
      console.log('Sample students:');
      students.slice(0, 3).forEach(s => {
        console.log(`  - StudentID: ${s.StudentID}, Name: ${s.FirstName} ${s.LastName}`);
      });
    }

    // Check if there are any invalid ObjectId references
    console.log('\n🔍 Looking for potential ObjectId issues...');
    try {
      const testQuery = await Student.find({ StudentID: { $in: [12345] } });
      console.log('Test query with number 12345 works fine:', testQuery.length, 'results');
    } catch (error) {
      console.error('❌ Error with test query:', error.message);
    }

    console.log('\n✅ Debug completed successfully');
    process.exit(0);

  } catch (error) {
    console.error('❌ Debug error:', error);
    process.exit(1);
  }
}

debugTrendsError();
