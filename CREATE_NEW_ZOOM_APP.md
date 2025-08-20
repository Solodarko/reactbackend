# Create New Server-to-Server OAuth Zoom App

## Why Create a New App?
Your current OAuth app might have restrictions on scope additions. Server-to-Server OAuth apps are better for backend integrations and typically have fewer scope limitations.

## Step-by-Step Instructions

### Step 1: Create New App
1. Go to [https://marketplace.zoom.us/](https://marketplace.zoom.us/)
2. Sign in with: `sollybroderrick2003@gmail.com`
3. Click **"Develop"** → **"Build App"**
4. Choose **"Server-to-Server OAuth"** (NOT "OAuth")
5. Click **"Create"**

### Step 2: Basic Information
Fill in the basic app information:
- **App Name**: `Attendance Tracker Backend`
- **Company Name**: `Your Company Name`
- **Developer Contact Information**: `sollybroderrick2003@gmail.com`
- **Short Description**: `Backend service for tracking Zoom meeting attendance`

### Step 3: App Credentials
After creation, you'll see three important credentials:
- **Account ID**: Copy this
- **Client ID**: Copy this  
- **Client Secret**: Copy this

### Step 4: Add Scopes
In the **Scopes** section, add these scopes:
```
✅ meeting:read:list_meetings
✅ meeting:read:meeting
✅ meeting:write:meeting
✅ meeting:read:meeting:admin
✅ meeting:write:meeting:admin
✅ report:read:meeting
✅ user:read:user
```

### Step 5: Activate App
1. Go to **"Activation"** tab
2. Make sure the app is **"Activated"**
3. If not activated, click **"Activate"**

### Step 6: Update Your .env File
Replace your current Zoom credentials in `.env`:

```bash
# OLD CREDENTIALS (backup)
# ZOOM_ACCOUNT_ID_OLD=DBxnAr9TTOqdB0g1Gtmohw
# ZOOM_CLIENT_ID_OLD=3O5cCIJR42JAhhmp6RK4g
# ZOOM_CLIENT_SECRET_OLD=EfSzNreC2fDoZyonDO9627ACXQiaTERD

# NEW SERVER-TO-SERVER OAUTH CREDENTIALS
ZOOM_ACCOUNT_ID=your_new_account_id
ZOOM_CLIENT_ID=your_new_client_id
ZOOM_CLIENT_SECRET=your_new_client_secret
```

### Step 7: Test New App
Run the test script:
```bash
node test-zoom-scopes.js
```

## Benefits of Server-to-Server OAuth
- ✅ Better scope support
- ✅ No user authentication required
- ✅ Designed for backend services
- ✅ More stable for production use
- ✅ Easier scope management

## Keep Your Old App
Don't delete your old app yet - keep it as backup until the new one is working perfectly.
