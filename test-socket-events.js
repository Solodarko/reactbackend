
const io = require('socket.io-client');

const socket = io('http://localhost:5000', {
  transports: ['websocket']
});

socket.on('connect', () => {
  console.log('✅ Connected to Socket.IO server');
});

socket.on('disconnect', () => {
  console.log('❌ Disconnected from Socket.IO server');
});

socket.on('meetingStarted', (data) => {
  console.log('🚀 Received meetingStarted event:');
  console.log(data);
});

socket.on('participantJoined', (data) => {
  console.log('👋 Received participantJoined event:');
  console.log(data);
});

socket.on('participantLeft', (data) => {
  console.log('👋 Received participantLeft event:');
  console.log(data);
});

socket.on('meetingEnded', (data) => {
  console.log('🏁 Received meetingEnded event:');
  console.log(data);
});

console.log('🕒 Waiting for events...');

