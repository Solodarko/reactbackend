# 🎯 Zoom Attendance Tracking Setup Guide

This guide walks you through setting up the comprehensive webhook-based Zoom attendance tracking system.

## 📋 Table of Contents

1. [Prerequisites](#prerequisites)
2. [Zoom App Configuration](#zoom-app-configuration)
3. [Environment Setup](#environment-setup)
4. [Webhook Configuration](#webhook-configuration)
5. [Testing the System](#testing-the-system)
6. [Usage Guide](#usage-guide)
7. [Troubleshooting](#troubleshooting)

## Prerequisites

### 🔧 System Requirements

- Node.js 14+ with npm
- MongoDB database
- Zoom Pro/Business account
- Public URL for webhook endpoints (ngrok for development)

### 📦 Dependencies

Ensure these packages are installed (already in package.json):
```bash
npm install axios crypto mongoose moment node-cron
```

## Zoom App Configuration

### 1. Create a Server-to-Server OAuth App

1. Go to [Zoom Marketplace](https://marketplace.zoom.us/)
2. Sign in with your Zoom account
3. Navigate to "Develop" → "Build App"
4. Select **"Server-to-Server OAuth"**
5. Fill in the app details:
   ```
   App Name: Attendance Tracker Backend
   Company Name: Your Organization
   Developer Contact: your-email@example.com
   ```

### 2. Configure Scopes

Add these essential scopes:

**Meeting Management:**
```
meeting:read:meeting
meeting:write:meeting
meeting:read:list_meetings
meeting:read:list_meetings:admin
```

**Reports (for reconciliation):**
```
report:read:meeting
report:read:list_meetings
```

**User Information:**
```
user:read:user
user:read:user:admin
```

### 3. Enable Event Subscriptions

1. In your Zoom app, go to **"Event Subscriptions"**
2. Enable Event Subscriptions
3. Add your webhook endpoint URL:
   ```
   https://yourdomain.com/api/zoom/webhooks
   ```
   
   For development with ngrok:
   ```
   https://abc123.ngrok.io/api/zoom/webhooks
   ```

4. Subscribe to these events:
   ```
   ✅ Meeting Participant Joined (meeting.participant_joined)
   ✅ Meeting Participant Left (meeting.participant_left)
   ✅ Meeting Ended (meeting.ended)
   ```

5. Set your webhook secret token (keep this secure!)

### 4. Get Your Credentials

Copy these values from your Zoom app:
- Account ID
- Client ID
- Client Secret
- Webhook Secret Token

## Environment Setup

### 1. Update Your .env File

Add these variables to your `.env` file:

```bash
# Zoom OAuth Credentials
ZOOM_ACCOUNT_ID=your_zoom_account_id_here
ZOOM_CLIENT_ID=your_zoom_client_id_here
ZOOM_CLIENT_SECRET=your_zoom_client_secret_here

# Webhook Security
ZOOM_WEBHOOK_SECRET_TOKEN=your_webhook_secret_token_here

# Database
MONGO_URI=your_mongodb_connection_string

# Server Configuration
PORT=5000
FRONTEND_URL=http://localhost:5173
```

### 2. Database Models

The system includes these new models:
- **ZoomAttendance** - Primary attendance tracking with webhook events
- **ZoomMeeting** - Enhanced with reconciliation status
- **Student** - For participant matching

Models are auto-created when the server starts.

## Webhook Configuration

### 1. Webhook URL Validation

Your webhook URL must respond to Zoom's validation challenge:

1. Start your server: `npm run dev`
2. Expose it publicly with ngrok: `ngrok http 5000`
3. Use the ngrok URL in your Zoom app webhook configuration
4. Zoom will send a validation request automatically

### 2. Webhook Security

The system implements HMAC signature verification for all incoming webhooks:
- Verifies the `X-Zm-Signature` header
- Validates request timestamps to prevent replay attacks
- Ensures webhook authenticity

### 3. Event Processing Flow

```
Zoom Meeting Event
       ↓
Webhook Validation (HMAC)
       ↓
Event Processing (participant joined/left/meeting ended)
       ↓
Database Storage (ZoomAttendance collection)
       ↓
Real-time Broadcast (Socket.IO)
       ↓
Student Matching (automatic)
       ↓
Reconciliation Queue (for meeting ended events)
```

## Testing the System

### 1. Health Check

First, verify your system is running:
```bash
curl http://localhost:5000/api/health
```

### 2. Webhook Configuration Test

Check webhook configuration:
```bash
curl http://localhost:5000/api/zoom/webhook-config
```

### 3. Run Comprehensive Tests

Use the built-in test suite:
```bash
node tests/attendanceTrackingTest.js
```

This tests:
- ✅ Webhook configuration and validation
- ✅ Event simulation (join/leave/meeting end)
- ✅ Attendance data retrieval
- ✅ Reconciliation queue processing
- ✅ Report generation
- ✅ CSV export functionality

### 4. Test Webhook Events Manually

Simulate webhook events:
```bash
# Test participant joined
curl -X POST http://localhost:5000/api/zoom/test-webhook \
  -H "Content-Type: application/json" \
  -d '{"eventType": "meeting.participant_joined", "meetingId": "test123"}'

# Test participant left
curl -X POST http://localhost:5000/api/zoom/test-webhook \
  -H "Content-Type: application/json" \
  -d '{"eventType": "meeting.participant_left", "meetingId": "test123"}'

# Test meeting ended
curl -X POST http://localhost:5000/api/zoom/test-webhook \
  -H "Content-Type: application/json" \
  -d '{"eventType": "meeting.ended", "meetingId": "test123"}'
```

## Usage Guide

### 1. Real-time Attendance Tracking

Once configured, the system automatically:
- 🎯 Captures participant join/leave events in real-time
- 📊 Calculates attendance duration and status
- 👥 Matches participants with students in your database
- 📡 Broadcasts updates via Socket.IO for live dashboards

### 2. Get Meeting Attendance

Retrieve attendance data for any meeting:
```bash
# JSON format
curl http://localhost:5000/api/zoom/attendance/MEETING_ID

# CSV export
curl "http://localhost:5000/api/zoom/attendance/MEETING_ID?format=csv"
```

### 3. Manual Reconciliation

Force reconciliation for a specific meeting:
```bash
curl -X POST http://localhost:5000/api/zoom/reconcile/MEETING_ID
```

### 4. Generate Reports

Get comprehensive attendance reports:
```bash
# Webhook-based report (recommended)
curl "http://localhost:5000/api/attendance-reports/meeting/MEETING_ID?source=webhook"

# CSV export
curl "http://localhost:5000/api/attendance-reports/meeting/MEETING_ID?format=csv"
```

### 5. View Webhook Events

See all webhook events for a meeting:
```bash
curl http://localhost:5000/api/zoom/webhook-events/MEETING_ID
```

### 6. Monitor System Status

Check system health and statistics:
```bash
# Overall system health
curl http://localhost:5000/api/health

# Webhook system status
curl http://localhost:5000/api/zoom/webhook-status

# Reconciliation statistics
curl http://localhost:5000/api/zoom/reconciliation-stats

# Reconciliation queue status
curl http://localhost:5000/api/zoom/reconciliation-queue
```

## Troubleshooting

### Common Issues

#### 1. Webhook Validation Fails
```
Error: "Invalid webhook signature"
```
**Solution:**
- Verify `ZOOM_WEBHOOK_SECRET_TOKEN` matches your Zoom app
- Check that webhook URL is publicly accessible
- Ensure HTTPS is used in production

#### 2. Missing Environment Variables
```
Error: "ZOOM_ACCOUNT_ID not configured"
```
**Solution:**
- Double-check all required environment variables are set
- Restart your server after updating `.env`
- Use the configuration test: `GET /api/zoom/webhook-config`

#### 3. Database Connection Issues
```
Error: "ZoomAttendance is not defined"
```
**Solution:**
- Verify MongoDB connection string is correct
- Check database connectivity: `npm run test-db`
- Ensure all models are properly imported

#### 4. Webhook Events Not Processing
```
Warning: "No attendance data found"
```
**Solution:**
- Check webhook endpoint is reachable from Zoom
- Verify event subscriptions are enabled in your Zoom app
- Test with simulated events: `POST /api/zoom/test-webhook`

#### 5. Rate Limiting Issues
```
Error: "Too many requests"
```
**Solution:**
- The system has built-in rate limiting and queuing
- Check rate limiter stats: `GET /api/rate-limiter/stats`
- Adjust reconciliation frequency if needed

### Debug Commands

Enable detailed logging:
```bash
# View webhook events for a meeting
curl http://localhost:5000/api/zoom/webhook-events/MEETING_ID

# Check reconciliation queue
curl http://localhost:5000/api/zoom/reconciliation-queue

# Get system statistics
curl http://localhost:5000/api/zoom/reconciliation-stats
```

### Webhook Event Flow Debugging

1. **Check Webhook Configuration:**
   ```bash
   curl http://localhost:5000/api/zoom/webhook-config
   ```

2. **Verify System Status:**
   ```bash
   curl http://localhost:5000/api/zoom/webhook-status
   ```

3. **Simulate Events:**
   ```bash
   curl -X POST http://localhost:5000/api/zoom/test-webhook \
     -H "Content-Type: application/json" \
     -d '{"eventType": "meeting.participant_joined", "meetingId": "test"}'
   ```

4. **Check Results:**
   ```bash
   curl http://localhost:5000/api/zoom/attendance/test
   ```

## Production Considerations

### Security
- ✅ Use HTTPS for all webhook endpoints
- ✅ Implement proper HMAC signature verification
- ✅ Validate webhook timestamps to prevent replay attacks
- ✅ Use environment variables for all secrets

### Scalability
- ✅ Built-in rate limiting and request queuing
- ✅ MongoDB indexes for optimal query performance  
- ✅ Efficient webhook event processing with deduplication
- ✅ Real-time updates via Socket.IO

### Monitoring
- ✅ Comprehensive health check endpoints
- ✅ Detailed logging and error tracking
- ✅ Queue monitoring and statistics
- ✅ Reconciliation success/failure tracking

### Data Integrity
- ✅ Webhook events stored with full audit trail
- ✅ Automatic reconciliation with Zoom's API data
- ✅ Student matching with multiple fallback strategies
- ✅ Duplicate event prevention and data validation

## Support

For issues or questions:
1. Run the test suite: `node tests/attendanceTrackingTest.js`
2. Check system health: `GET /api/health`
3. Review webhook configuration: `GET /api/zoom/webhook-config`
4. Examine recent webhook events: `GET /api/zoom/webhook-events/MEETING_ID`

The system provides comprehensive logging and monitoring to help diagnose and resolve issues quickly.
