# Enhanced Zoom Webhook Participant Tracking 📡

This document outlines the comprehensive webhook implementation for tracking meeting participants with real-time notifications and database persistence.

## Overview

The webhook system now tracks all major meeting and participant events, providing real-time updates and maintaining persistent records of all participant activities.

## Supported Webhook Events

### Meeting Events
- ✅ `meeting.started` - Meeting begins
- ✅ `meeting.ended` - Meeting concludes  
- ✅ `meeting.recording_started` - Recording begins
- ✅ `meeting.recording_stopped` - Recording ends
- ✅ `meeting.sharing_started` - Screen sharing begins
- ✅ `meeting.sharing_ended` - Screen sharing ends

### Participant Events
- ✅ `meeting.participant_joined` - Participant enters meeting
- ✅ `meeting.participant_left` - Participant leaves meeting
- ✅ `meeting.participant_updated` - Participant status changes (audio/video)
- ✅ `meeting.participant_waiting_for_host` - Participant in waiting room
- ✅ `meeting.participant_admitted` - Participant admitted from waiting room
- ✅ `meeting.participant_put_in_waiting_room` - Participant moved to waiting room

## Features

### 🎯 Comprehensive Tracking
- **Real-time participant monitoring** with join/leave timestamps
- **Student identification** via email matching
- **Duration calculation** for attendance tracking
- **Status updates** (audio, video, screen sharing)
- **Connection status** tracking (joined, left, reconnected, waiting)

### 🔔 Real-time Notifications
- **Socket.IO events** for live dashboard updates
- **Notification system** with categorized alerts
- **Room-based broadcasts** for meeting-specific updates
- **Global state management** for active participants

### 💾 Database Persistence
- **Participant records** with comprehensive metadata
- **Student matching** using email addresses
- **Session tracking** with multiple join/leave cycles
- **Automatic attendance generation** when meetings end

## Webhook Event Handlers

### Meeting Started Handler
```javascript
async function handleMeetingStarted(payload, io, globalState)
```
- Updates global meeting state
- Creates notification for meeting start
- Broadcasts to all connected clients

### Meeting Ended Handler
```javascript
async function handleMeetingEnded(payload, io, globalState)
```
- Removes meeting from active state
- Auto-generates attendance records
- Notifies clients of meeting conclusion

### Participant Joined Handler
```javascript
async function handleParticipantJoined(payload, io, globalState)
```
- Creates comprehensive participant record
- Attempts student matching via email
- Saves to database and updates global state
- Broadcasts join event to clients

### Participant Left Handler
```javascript
async function handleParticipantLeft(payload, io, globalState)
```
- Calculates session duration
- Updates participant status
- Determines attendance status
- Broadcasts leave event with duration

### Participant Updated Handler
```javascript
async function handleParticipantUpdated(payload, io, globalState)
```
- Updates audio/video status
- Tracks screen sharing state
- Updates last activity timestamp
- Broadcasts status changes

### Waiting Room Handlers
```javascript
async function handleParticipantWaitingRoom(payload, io, globalState)
async function handleParticipantAdmitted(payload, io, globalState)  
async function handleParticipantPutInWaitingRoom(payload, io, globalState)
```
- Tracks waiting room interactions
- Creates/updates participant records
- Notifies host of waiting participants
- Manages admission workflow

### Screen Sharing Handlers
```javascript
async function handleSharingStarted(payload, io, globalState)
async function handleSharingEnded(payload, io, globalState)
```
- Tracks screen sharing events
- Updates participant sharing status
- Notifies all meeting participants
- Records sharing activity

### Recording Handlers
```javascript
async function handleRecordingStarted(payload, io, globalState)
async function handleRecordingStopped(payload, io, globalState)
```
- Tracks recording state changes
- Updates meeting metadata
- Notifies participants of recording status
- Maintains recording timeline

## Real-time Event Broadcasting

### Socket.IO Events Emitted

#### Global Events
- `notification` - System-wide notifications
- `zoomWebhook` - Raw webhook data for debugging
- `participantUpdate` - Participant state changes

#### Meeting-specific Events (room-based)
- `participantJoined` - New participant joined
- `participantLeft` - Participant left with duration
- `participantStatusUpdate` - Audio/video changes
- `participantWaiting` - Participant in waiting room
- `participantAdmitted` - Participant admitted
- `participantMovedToWaitingRoom` - Moved to waiting room
- `sharingStarted` / `sharingEnded` - Screen sharing events
- `recordingStarted` / `recordingStopped` - Recording events

## Database Schema

### Participant Model
```javascript
{
  participantName: String,
  participantId: String,
  zoomUserId: String,
  email: String,
  meetingId: String,
  meetingTopic: String,
  joinTime: Date,
  leaveTime: Date,
  duration: Number, // minutes
  isActive: Boolean,
  connectionStatus: String, // 'joined', 'left', 'reconnected', 'admitted', 'in_waiting_room'
  audioStatus: Boolean,
  videoStatus: Boolean,
  sharingScreen: Boolean,
  handRaised: Boolean,
  attendanceStatus: String, // 'Present', 'Late', 'Left Early', 'Absent'
  userType: String, // 'student', 'instructor', 'guest'
  device: String,
  lastActivity: Date,
  
  // Student matching fields
  studentId: String,
  studentFirstName: String,
  studentLastName: String,
  studentDepartment: String,
  studentEmail: String,
  
  // Session tracking
  sessions: [{
    joinTime: Date,
    leaveTime: Date,
    duration: Number,
    reason: String
  }]
}
```

## Webhook Configuration

### Required Zoom App Scopes
- `meeting:read:meeting` - Read meeting information
- `meeting:read:participant` - Read participant data
- `user:read:user` - Read user information

### Event Subscriptions
Enable the following events in your Zoom App:
- Meeting Started
- Meeting Ended  
- Participant Joined Meeting
- Participant Left Meeting
- Participant Updated
- Participant Waiting for Host
- Participant Admitted
- Participant Put in Waiting Room
- Meeting Sharing Started
- Meeting Sharing Ended
- Recording Started
- Recording Stopped

### Webhook URL
Set your webhook endpoint to:
```
https://your-domain.com/api/zoom/webhook
```

## Usage Examples

### Setting up Webhook Monitoring
```javascript
// Client-side Socket.IO connection
const socket = io('https://your-server.com');

// Listen for participant events
socket.on('participantJoined', (data) => {
  console.log('New participant:', data.participant.name);
  updateParticipantList(data.participant);
});

socket.on('participantLeft', (data) => {
  console.log('Participant left:', data.participant.name, 'Duration:', data.participant.duration);
  updateParticipantStatus(data.participant);
});

socket.on('notification', (notification) => {
  showNotification(notification);
});
```

### Joining Meeting Room for Specific Updates
```javascript
// Join specific meeting room for targeted updates
socket.emit('join-meeting', { meetingId: '123456789' });

// Listen for meeting-specific events
socket.on('participantStatusUpdate', (data) => {
  updateParticipantStatus(data.participant);
});

socket.on('sharingStarted', (data) => {
  showSharingIndicator(data.participant.name);
});
```

### Fetching Live Participant Data
```javascript
// Get comprehensive participant data
fetch('/api/zoom/meeting/123456789/live-participants')
  .then(response => response.json())
  .then(data => {
    console.log('Participants:', data.participants);
    console.log('Statistics:', data.statistics);
  });
```

## Error Handling

The webhook system includes comprehensive error handling:
- **Database failures** are logged but don't prevent webhook processing
- **Student matching errors** are caught and logged as warnings
- **Unhandled webhook events** are logged for debugging
- **Socket.IO broadcast failures** are caught silently

## Monitoring and Debugging

### Health Check Endpoint
```
GET /api/zoom/health
```
Returns webhook system health status.

### Webhook Logs
All webhook events are logged with:
- Event type
- Processing status
- Error details (if any)
- Performance metrics

### Testing Webhook Events
Use Zoom's webhook testing tools or manually trigger events:
1. Join/leave meetings to test participant events
2. Start/stop recording to test recording events
3. Share screen to test sharing events
4. Use waiting room to test admission workflow

## Security Considerations

- **Webhook validation** - Verify webhook signatures (implement as needed)
- **Rate limiting** - Handle high-frequency webhook events
- **Data sanitization** - Clean participant data before storage
- **CORS protection** - Secure Socket.IO connections
- **Authentication** - Protect webhook endpoints appropriately

## Performance Optimization

- **Batch processing** for multiple participant updates
- **Database indexing** on frequently queried fields
- **Memory-efficient global state** management
- **Socket.IO room management** for scalability

## Future Enhancements

- [ ] Webhook signature validation
- [ ] Advanced participant analytics
- [ ] Meeting quality metrics
- [ ] Breakout room tracking
- [ ] Poll and Q&A event tracking
- [ ] Chat message monitoring
- [ ] Reaction tracking

## Troubleshooting

### Common Issues
1. **Webhooks not received** - Check Zoom app configuration
2. **Participant not matched** - Verify student email addresses
3. **Duplicate notifications** - Check for multiple webhook subscriptions
4. **Missing events** - Ensure all required scopes are granted

### Debug Mode
Enable debug logging by setting:
```
DEBUG=zoom:webhook
```

This comprehensive webhook system provides complete visibility into meeting activities and ensures accurate participant tracking with real-time updates.
