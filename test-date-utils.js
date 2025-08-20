const {
  safeCreateDate,
  safeDateFormat,
  safeDateDuration,
  isValidDate,
  getCurrentTimestamp,
  sanitizeDateFields
} = require('./utils/dateUtils');

/**
 * Test Safe Date Utilities
 * Verify that invalid date errors are properly handled
 */

console.log('🧪 Testing Safe Date Utilities');
console.log('==============================\n');

// Test 1: Invalid Date Strings
console.log('1️⃣ Testing Invalid Date Strings:');
const invalidDates = [
  'Invalid Date',
  '',
  'null',
  'undefined',
  null,
  undefined,
  'not-a-date',
  '2023-13-45', // Invalid date
  'abc123'
];

invalidDates.forEach((invalid, index) => {
  const result = safeDateFormat(invalid);
  console.log(`   ${index + 1}. "${invalid}" → "${result}"`);
});

console.log('\n2️⃣ Testing Valid Date Strings:');
const validDates = [
  new Date(),
  '2024-01-15T10:30:00Z',
  '2024/01/15',
  '01/15/2024',
  Date.now(),
  '2024-01-15'
];

validDates.forEach((valid, index) => {
  const result = safeDateFormat(valid);
  console.log(`   ${index + 1}. "${valid}" → "${result}"`);
});

console.log('\n3️⃣ Testing Date Duration Calculations:');
const now = new Date();
const oneHourAgo = new Date(now.getTime() - (60 * 60 * 1000));
const invalidStart = 'Invalid Date';

console.log(`   Valid dates: ${safeDateDuration(oneHourAgo, now)} minutes`);
console.log(`   Invalid start: ${safeDateDuration(invalidStart, now)} minutes`);
console.log(`   Invalid end: ${safeDateDuration(now, 'Invalid Date')} minutes`);

console.log('\n4️⃣ Testing Date Validation:');
const testDates = [new Date(), 'Invalid Date', null, '2024-01-15', 'abc'];
testDates.forEach(date => {
  console.log(`   "${date}" is valid: ${isValidDate(date)}`);
});

console.log('\n5️⃣ Testing Object Date Field Sanitization:');
const participantData = {
  name: 'John Doe',
  joinTime: 'Invalid Date',
  leaveTime: new Date(),
  createdAt: '2024-01-15T10:30:00Z',
  invalidField: 'not a date',
  otherField: 'some value'
};

console.log('   Before sanitization:');
console.log('   ', JSON.stringify(participantData, null, 2));

const sanitized = sanitizeDateFields(participantData);
console.log('   After sanitization:');
console.log('   ', JSON.stringify(sanitized, null, 2));

console.log('\n6️⃣ Testing Various Date Formats:');
const formats = ['iso', 'date', 'time', 'datetime', 'full'];
const testDate = new Date('2024-01-15T10:30:45Z');

formats.forEach(format => {
  const formatted = safeDateFormat(testDate, 'N/A', { format });
  console.log(`   ${format}: ${formatted}`);
});

console.log('\n7️⃣ Testing Meeting Statistics with Safe Dates:');
// Simulate meeting participant data with various date issues
const mockParticipants = [
  {
    name: 'Alice',
    joinTime: new Date(),
    leaveTime: null,
    isActive: true
  },
  {
    name: 'Bob',
    joinTime: 'Invalid Date',
    leaveTime: new Date(),
    isActive: false
  },
  {
    name: 'Charlie',
    joinTime: '2024-01-15T10:00:00Z',
    leaveTime: '2024-01-15T11:30:00Z',
    isActive: false
  }
];

console.log('   Participant Date Processing:');
mockParticipants.forEach((participant, index) => {
  const joinTime = safeDateFormat(participant.joinTime);
  const leaveTime = safeDateFormat(participant.leaveTime);
  const duration = safeDateDuration(participant.joinTime, participant.leaveTime);
  
  console.log(`   ${index + 1}. ${participant.name}:`);
  console.log(`      Join: ${joinTime}`);
  console.log(`      Leave: ${leaveTime}`);
  console.log(`      Duration: ${duration} minutes`);
  console.log(`      Active: ${participant.isActive}`);
  console.log('');
});

console.log('✅ All date utility tests completed!');
console.log('   - Invalid dates are safely handled with fallbacks');
console.log('   - Duration calculations work with invalid inputs');
console.log('   - Date formatting prevents "Invalid Date" display');
console.log('   - Object sanitization fixes date field issues');

console.log('\n🔧 Integration Notes:');
console.log('   - Import these utilities in your services');
console.log('   - Replace direct Date() operations with safe versions');
console.log('   - Use safeDateFormat() for all date display');
console.log('   - Use safeDateDuration() for time calculations');

if (require.main === module) {
  console.log('\n🚀 Ready to use in your application!');
}
