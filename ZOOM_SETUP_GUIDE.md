# Zoom Real-Time Participant Tracking Setup

## 🎯 Why You're Not Seeing Data

Your system is correctly configured, but you need **real Zoom meetings with participants** to see data. Here's how to set it up:

## 📋 Step 1: Verify Zoom App Settings

1. Go to [Zoom App Marketplace](https://marketplace.zoom.us/develop/create)
2. Find your app with these credentials:
   - **Account ID**: `DBxnAr9TTOqdB0g1Gtmohw`
   - **Client ID**: `3O5cCIJR42JAhhmp6RK4g`

3. **Enable Required Scopes:**
   ```
   ✅ meeting:read:admin
   ✅ meeting:read:participant:admin
   ✅ user:read:admin
   ✅ account:read:admin
   ```

## 📡 Step 2: Set Up Webhooks (For Real-Time Tracking)

### Add Webhook URL:
```
https://your-domain.com/api/webhooks/zoom
```

### Subscribe to Events:
```
✅ Meeting Started
✅ Meeting Ended  
✅ Participant Joined
✅ Participant Left
✅ Meeting Participant Joined
✅ Meeting Participant Left
```

### Add Webhook Secret (if required):
```bash
ZOOM_WEBHOOK_SECRET_TOKEN=your_webhook_secret_here
```

## 🧪 Step 3: Test With Real Meeting

### Option A: Join Existing Meeting
1. **Meeting ID**: `83605430356`
2. **Join URL**: https://us05web.zoom.us/j/83605430356?pwd=hcq8p6iyL03yQiTBZV4hmW4blLMva4.1
3. **Password**: `45`
4. **Host Email**: `sollybroderrick2003@gmail.com`

**Steps:**
1. Start meeting as host (`sollybroderrick2003@gmail.com`)
2. Have 2-3 people join as participants
3. Test API: `GET /api/zoom/meeting/83605430356/live-participants`
4. Check dashboard: Select meeting `83605430356`

### Option B: Create New Meeting
```bash
curl -X POST "http://localhost:5000/api/zoom/meetings" \
  -H "Content-Type: application/json" \
  -d '{
    "topic": "Live Participant Tracking Test",
    "start_time": "2025-08-17T22:45:00.000Z",
    "duration": 60,
    "settings": {
      "waiting_room": false,
      "join_before_host": true
    }
  }'
```

## 🎮 Step 4: Test the Dashboard

1. **Start the meeting** (host joins first)
2. **Add participants** (have friends/colleagues join)
3. **Open admin dashboard** → Meeting Participants
4. **Select the active meeting**
5. **Watch real-time updates** as people join/leave

## 📊 Expected Results

Once participants join, you should see:

### API Response:
```json
{
  "success": true,
  "meetingId": "83605430356",
  "participants": [
    {
      "user_id": "16778240",
      "user_name": "John Doe", 
      "status": "in_meeting",
      "join_time": "2025-08-17T22:45:30.000Z",
      "email": "john@example.com"
    }
  ],
  "statistics": {
    "total": 1,
    "present": 1,
    "active": 1
  }
}
```

### Dashboard Display:
```
Meeting Participants (1)
Source: Zoom Live Participants  
Real-time: Connected ✅

┌─────────────┬──────────────┬────────────┬──────────────┐
│ Participant │ Auth Status  │ Join Time  │ Status       │
├─────────────┼──────────────┼────────────┼──────────────┤
│ John Doe    │ Guest        │ 22:45:30   │ In Progress  │
│ john@ex...  │              │            │ Active       │
└─────────────┴──────────────┴────────────┴──────────────┘
```

## 🚨 Troubleshooting

### No Participants Showing:
- ✅ Meeting must be **actively running** (not waiting)
- ✅ Host must have **started** the meeting
- ✅ Participants must be **currently joined**
- ✅ Check Zoom app **permissions**

### API 404 Errors:
```bash
# Test if meeting exists and is active
curl "http://localhost:5000/api/zoom/meeting/MEETING_ID"

# Check meeting status  
curl "http://localhost:5000/api/zoom/meetings"
```

### Real-Time Updates Not Working:
1. **Webhooks not configured** → Set up webhook URL
2. **Events not subscribed** → Enable participant events
3. **Signature verification fails** → Check webhook secret

## 🎉 Success Indicators

You'll know it's working when:
1. ✅ **API returns participant data** instead of 404
2. ✅ **Dashboard shows real participants** instead of empty state
3. ✅ **Real-time updates** when people join/leave
4. ✅ **Statistics update** automatically
5. ✅ **Source shows** "Zoom Live Participants" or "AttendanceTracker"

## 🔧 Quick Test Command

```bash
# Start meeting, have people join, then run:
curl "http://localhost:5000/api/zoom/meeting/83605430356/live-participants"

# If successful, you should see participant data instead of 404
```
