# Zoom OAuth Scopes Issue Fix

## Problem
You're getting this error: `Invalid access token, does not contain scopes:[meeting:read:list_meetings, meeting:read:list_meetings:admin]`

This means your Zoom OAuth app doesn't have the required permissions (scopes) to access meeting data.

## Solution 1: Add Required Scopes to Existing App

1. Go to [Zoom Marketplace](https://marketplace.zoom.us/)
2. Sign in with your Zoom account
3. Go to "Develop" → "Build App" → Find your existing app
4. Click on your app with Client ID: `3O5cCIJR42JAhhmp6RK4g`
5. Go to the **Scopes** tab
6. Add these scopes:

### Required Scopes for Your Backend:
```
✅ meeting:read:meeting              # Get meeting details
✅ meeting:write:meeting             # Create/update meetings
✅ meeting:read:meeting:admin        # Admin access to meetings
✅ meeting:write:meeting:admin       # Admin create/update meetings
✅ meeting:read:list_meetings:admin  # List meetings (admin)
✅ report:read:meeting               # Get meeting reports
✅ user:read:user                    # Get user info
✅ user:read:user:admin             # Admin user access
✅ dashboard:read:list_meetings     # Dashboard meeting data
```

7. Save the changes
8. **Important**: You may need to re-authorize or regenerate your access token

## Solution 2: Create Server-to-Server OAuth App (Recommended)

Server-to-Server OAuth apps have fewer scope restrictions and are better for backend integrations:

### Steps:
1. Go to [Zoom Marketplace](https://marketplace.zoom.us/)
2. Click "Develop" → "Build App"
3. Choose **"Server-to-Server OAuth"**
4. Fill in app details:
   - App Name: "Attendance Tracker Backend"
   - Company Name: Your company
   - Developer Contact: Your email
5. Get the credentials:
   - Account ID
   - Client ID  
   - Client Secret
6. Add these scopes (they're usually pre-approved):
   ```
   meeting:read:meeting
   meeting:write:meeting
   meeting:read:list_meetings
   report:read:meeting
   user:read:user
   ```

### Update Your .env File:
```bash
# Replace with new Server-to-Server OAuth credentials
ZOOM_ACCOUNT_ID=your_new_account_id
ZOOM_CLIENT_ID=your_new_client_id
ZOOM_CLIENT_SECRET=your_new_client_secret
```

## Solution 3: Quick Test Without Scopes

If you want to test immediately, update your code to handle missing scopes gracefully:

```javascript
// In routes/zoom.js - Add this fallback
router.get('/test-minimal', async (req, res) => {
  try {
    const accessToken = await getZoomAccessToken();
    
    // Test with minimal API call that doesn't need scopes
    const userResponse = await axios.get(
      'https://api.zoom.us/v2/users/me',
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
      }
    );
    
    res.json({ 
      success: true,
      message: 'Token works for basic user info',
      user: userResponse.data 
    });
  } catch (error) {
    res.status(500).json({ 
      success: false,
      error: error.message,
      details: error.response?.data
    });
  }
});
```

## Recommended Approach

1. **First**: Try Solution 1 (add scopes to existing app)
2. **If that fails**: Use Solution 2 (create Server-to-Server OAuth app)
3. **For testing**: Use Solution 3 to verify basic connectivity

## Testing Your Fix

After updating scopes, test with:
```bash
curl http://localhost:5000/api/zoom/validate-credentials
```

Or visit: `http://localhost:5173` and try creating a meeting from your frontend.

## Notes
- Server-to-Server OAuth is recommended for production
- Some scopes require Zoom Pro/Business accounts
- Webhook events don't require API scopes (they're push-based)
- Your webhook endpoint will continue working regardless of API scope issues
