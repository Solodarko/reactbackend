# User Session Tracking System

This document explains how to use the new user session tracking system that allows authenticated users to register for meeting attendance and tracks their participation with detailed user information.

## Overview

The User Session Tracking system provides:

- **Token-based authentication**: Users authenticate with JWT tokens
- **Real-time session management**: Track when users join/leave meetings
- **Enhanced participant data**: Link Zoom participants with authenticated user accounts
- **Admin dashboard integration**: Display user details (name, email, role) in real-time
- **Automatic student matching**: Link users with student records when possible

## Architecture

### Components

1. **UserSessionManager** (`backend/services/userSessionManager.js`)
   - Manages active user sessions during meetings
   - Verifies JWT tokens and extracts user information
   - Links user sessions with Zoom participant data
   - Handles session lifecycle (join, activity updates, leave)

2. **User Session Routes** (`backend/routes/userSessions.js`)
   - API endpoints for user session management
   - Authentication middleware integration
   - Real-time Socket.IO event broadcasting

3. **Enhanced AttendanceTracker** (`backend/services/attendanceTracker.js`)
   - Integrates with user session manager
   - Provides enriched attendance data with user information
   - Combines Zoom participant data with authenticated user details

4. **Enhanced Participant Model** (`backend/models/Participant.js`)
   - Stores authenticated user details
   - Links with User and Student models
   - Tracks authentication status and session information

## API Endpoints

### User Session Management

#### Register for Meeting Attendance
```http
POST /api/user-sessions/join-meeting
Authorization: Bearer <jwt_token>
Content-Type: application/json

{
  "meetingId": "123456789",
  "participantData": {
    "participantName": "John Doe",
    "device": "Desktop"
  }
}
```

**Response:**
```json
{
  "success": true,
  "message": "Successfully registered for meeting attendance",
  "sessionId": "user123_123456789_1640000000000",
  "userData": {
    "user": {
      "id": "user123",
      "username": "johndoe",
      "email": "john.doe@example.com",
      "role": "user"
    },
    "student": {
      "studentId": 12345,
      "firstName": "John",
      "lastName": "Doe",
      "department": "Computer Science",
      "email": "john.doe@student.edu"
    },
    "meetingId": "123456789",
    "joinTime": "2024-01-16T10:00:00.000Z"
  }
}
```

#### Leave Meeting
```http
POST /api/user-sessions/leave-meeting
Authorization: Bearer <jwt_token>
Content-Type: application/json

{
  "sessionId": "user123_123456789_1640000000000"
}
```

#### Get User's Sessions
```http
GET /api/user-sessions/my-sessions
Authorization: Bearer <jwt_token>
```

#### Get Authenticated Participants for Meeting
```http
GET /api/user-sessions/meeting/123456789/authenticated-participants
Authorization: Bearer <jwt_token>
```

### Enhanced Attendance Tracking

#### Get Enriched Attendance Data
```http
GET /api/attendance-tracker/attendance/123456789?enriched=true
Authorization: Bearer <jwt_token>
```

**Response includes:**
- Regular Zoom participant data
- Authenticated user information (username, email, role)
- Student details when available
- Authentication statistics
- Session activity data

## Usage Examples

### Frontend Integration

#### 1. User Registration for Meeting

```javascript
// When user joins a meeting page, register them for attendance
const registerForMeeting = async (meetingId) => {
  try {
    const token = localStorage.getItem('authToken');
    
    const response = await fetch('/api/user-sessions/join-meeting', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify({
        meetingId: meetingId,
        participantData: {
          participantName: 'Auto-detected from token',
          device: 'Web Browser'
        }
      })
    });
    
    const result = await response.json();
    
    if (result.success) {
      console.log('Registered for meeting:', result.userData);
      // Store session ID for later use
      sessionStorage.setItem('meetingSessionId', result.sessionId);
    }
  } catch (error) {
    console.error('Failed to register for meeting:', error);
  }
};
```

#### 2. Admin Dashboard Integration

```javascript
// Get enriched attendance data for admin dashboard
const fetchEnrichedAttendance = async (meetingId) => {
  try {
    const token = localStorage.getItem('authToken');
    
    const response = await fetch(
      `/api/attendance-tracker/attendance/${meetingId}?enriched=true`,
      {
        headers: {
          'Authorization': `Bearer ${token}`
        }
      }
    );
    
    const data = await response.json();
    
    if (data.success) {
      // Display participants with user authentication info
      data.participants.forEach(participant => {
        console.log({
          name: participant.participantName,
          email: participant.email,
          isAuthenticated: participant.isAuthenticated,
          userRole: participant.authenticatedUser?.role,
          studentInfo: participant.studentInfo,
          attendanceStatus: participant.attendanceStatus
        });
      });
      
      // Show authentication statistics
      console.log('Auth Stats:', data.authenticationStats);
    }
  } catch (error) {
    console.error('Failed to fetch enriched attendance:', error);
  }
};
```

#### 3. Real-time Updates with Socket.IO

```javascript
// Listen for user session events
socket.on('userJoinedMeeting', (data) => {
  console.log(`${data.user.username} joined meeting ${data.meetingId}`);
  updateParticipantsList(data);
});

socket.on('userLeftMeeting', (data) => {
  console.log(`${data.user.username} left after ${data.duration} minutes`);
  updateParticipantsList(data);
});

socket.on('participantLinked', (data) => {
  console.log('User session linked with Zoom participant:', data);
  refreshAttendanceData();
});
```

## Database Schema

### Enhanced Participant Model

```javascript
{
  // Basic participant info
  participantName: String,
  participantId: String,
  zoomUserId: String,
  
  // Link to authenticated user
  userId: ObjectId, // References User collection
  
  // Authenticated user details (cached for performance)
  authenticatedUser: {
    username: String,
    email: String,
    role: String, // 'user' or 'admin'
    joinedViaAuth: Boolean,
    authTokenUsed: Boolean
  },
  
  // Student information
  studentId: Number,
  studentFirstName: String,
  studentLastName: String,
  studentDepartment: String,
  studentEmail: String,
  
  // Meeting and attendance data
  meetingId: String,
  joinTime: Date,
  leaveTime: Date,
  duration: Number,
  attendanceStatus: String,
  isActive: Boolean,
  
  // ... other existing fields
}
```

## Security Considerations

1. **Token Verification**: All endpoints verify JWT tokens before processing
2. **User Authorization**: Users can only access their own session data
3. **Admin Privileges**: Enhanced data requires appropriate permissions
4. **Session Cleanup**: Expired sessions are automatically cleaned up
5. **Rate Limiting**: API endpoints are protected against abuse

## Monitoring and Analytics

### Session Statistics

```javascript
// Get session statistics (admin only)
GET /api/user-sessions/stats
```

Returns:
- Total active sessions
- Active users count
- Active meetings count
- Role breakdown (admin/user)
- Students with sessions
- Cleanup status

### Real-time Monitoring

The system provides real-time updates through Socket.IO events:

- `userJoinedMeeting`: User registered for meeting
- `userLeftMeeting`: User ended session
- `participantLinked`: Session linked with Zoom participant
- `attendanceDataFetched`: Enriched data requested
- `meetingSessionsEnded`: All sessions ended for meeting

## Troubleshooting

### Common Issues

1. **"Invalid or expired token"**
   - Ensure JWT token is valid and not expired
   - Check token format (should include Bearer prefix)

2. **"No active session found"**
   - User hasn't registered for the meeting
   - Session may have expired or been cleaned up

3. **"User not found"**
   - User account doesn't exist in database
   - Token contains invalid user ID

### Debug Mode

Enable debug logging by setting `NODE_ENV=development` to see detailed session management logs.

## Best Practices

1. **Register Early**: Have users register for meeting attendance as soon as they access the meeting page
2. **Handle Offline**: Implement retry logic for network issues
3. **Clean Up**: Always call leave-meeting when users navigate away
4. **Real-time Updates**: Use Socket.IO for immediate feedback
5. **Graceful Degradation**: System works even if users don't authenticate

## Migration Guide

If upgrading from a system without user session tracking:

1. Deploy new backend code
2. Run database migrations to add new fields to Participant model
3. Update frontend to call registration endpoints
4. Test with a small group before full rollout
5. Monitor logs for any integration issues

## Support

For issues or questions about the user session tracking system:

1. Check the logs for detailed error messages
2. Verify JWT token configuration
3. Test endpoints with tools like Postman
4. Review Socket.IO connection status
5. Contact the development team with specific error details
