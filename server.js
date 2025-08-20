require('dotenv').config();
const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const cron = require('node-cron');
const moment = require('moment');
const axios = require('axios');
const mongoose = require('mongoose');
const connectDB = require('./config/db');
const rateLimiter = require('./utils/rateLimiter');
const zoomRequestQueue = require('./utils/zoomRequestQueue');
const SystemHealthChecker = require('./services/systemHealthChecker');
// Essential routes only
const authRoutes = require('./routes/auth');
const tokenTestRoutes = require('./routes/tokenTest');
const StudentRoutes = require('./routes/Student');
const meetingsRoutes = require('./routes/meetings');
const { router: userSessionRoutes, userSessionManager } = require('./routes/userSessions');
const zoomRoutes = require('./routes/zoom');
const attendanceTracker85Routes = require('./routes/attendanceTracker85');
const zoomDurationAttendanceRoutes = require('./routes/zoomDurationAttendance');
const zoomClearRoutes = require('./routes/zoomClear');

// Unified Attendance Tracking System (replaces all old attendance systems)
const { router: unifiedAttendanceRoutes, initializeUnifiedTracker } = require('./routes/unifiedAttendance');
const qrAttendanceRoutes = require('./routes/qrAttendance');

const app = express();
const server = http.createServer(app);

// Trust proxy for deployment platforms (Heroku, Railway, etc.)
if (process.env.NODE_ENV === 'production' && process.env.TRUST_PROXY) {
  app.set('trust proxy', 1);
}

// Security headers middleware
app.use((req, res, next) => {
  // Security headers
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  
  if (process.env.NODE_ENV === 'production') {
    res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  }
  
  next();
});

// Middleware
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(cookieParser()); // Add cookie parser middleware

// Get allowed origins from environment variables
const getAllowedOrigins = () => {
  const origins = [];
  
  // Add main frontend URL
  if (process.env.FRONTEND_URL) {
    origins.push(process.env.FRONTEND_URL);
  }
  
  // Add additional origins from ALLOWED_ORIGINS
  if (process.env.ALLOWED_ORIGINS) {
    const additionalOrigins = process.env.ALLOWED_ORIGINS.split(',').map(origin => origin.trim());
    origins.push(...additionalOrigins);
  }
  
  // Add development origins if in development
  if (process.env.NODE_ENV !== 'production') {
    origins.push(
      'http://localhost:5173',
      'http://127.0.0.1:5173',
      'http://localhost:3000',
      'http://localhost:4173'
    );
  }
  
  return origins.filter(Boolean);
};

const allowedOrigins = getAllowedOrigins();
console.log('🌐 Allowed CORS Origins:', allowedOrigins);

// CORS Options - Production-ready configuration
const corsOptions = {
  origin: function (origin, callback) {
    // Allow requests with no origin (mobile apps, Postman, etc.) only in development
    if (!origin && process.env.NODE_ENV !== 'production') {
      console.log('🌐 CORS: Allowing request with no origin (development)');
      return callback(null, true);
    }
    
    // Check if origin is allowed
    if (allowedOrigins.includes(origin)) {
      console.log(`✅ CORS allowed for origin: ${origin}`);
      callback(null, true);
    } else {
      console.log(`❌ CORS blocked for origin: ${origin}`);
      console.log(`Allowed origins: ${allowedOrigins.join(', ')}`);
      
      // In production, strictly enforce CORS
      if (process.env.NODE_ENV === 'production') {
        callback(new Error('Not allowed by CORS'));
      } else {
        // In development, allow but log warning
        console.log('⚠️ Development mode: Allowing blocked origin');
        callback(null, true);
      }
    }
  },
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS', 'HEAD', 'PATCH'],
  allowedHeaders: [
    'Content-Type', 
    'Authorization', 
    'Accept', 
    'Origin', 
    'X-Requested-With',
    'Cache-Control',
    'Pragma',
    'Expires',
    'If-Modified-Since',
    'If-None-Match',
    'X-CSRF-Token',
    'Accept-Language',
    'Accept-Encoding'
  ],
  exposedHeaders: ['Set-Cookie', 'Content-Length', 'Content-Type', 'Authorization'],
  credentials: true,
  optionsSuccessStatus: 200,
  preflightContinue: false
};

app.use(cors(corsOptions));

// Enable pre-flight requests for all routes
app.options('*', cors(corsOptions));

// Additional security headers
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Credentials', 'true');
  res.header('Access-Control-Expose-Headers', 'Set-Cookie');
  next();
});

// Connect to MongoDB
connectDB();

// Function to get OAuth access token for Zoom API with rate limiting
const getZoomAccessToken = async () => {
  return await rateLimiter.getAccessToken(async () => {
    const response = await axios.post(
      `https://zoom.us/oauth/token?grant_type=account_credentials&account_id=${process.env.ZOOM_ACCOUNT_ID}`,
      {},
      {
        headers: {
          Authorization: `Basic ${Buffer.from(`${process.env.ZOOM_CLIENT_ID}:${process.env.ZOOM_CLIENT_SECRET}`).toString('base64')}`,
          'Content-Type': 'application/x-www-form-urlencoded'
        },
        timeout: 30000 // 30 second timeout
      }
    );
    return response.data.access_token;
  });
};

// Global state for real-time tracking
const globalState = {
  activeMeetings: new Map(),
  activeParticipants: new Map(),
  notifications: [],
  meetingAnalytics: {
    totalMeetings: 0,
    activeNow: 0,
    totalParticipants: 0
  },
  joinTracking: []
};

// Socket.IO setup with enhanced configuration for WebSocket connections
const io = socketIo(server, {
  cors: {
    origin: [
      process.env.FRONTEND_URL || "http://localhost:5173",
      "http://localhost:5173",
      "http://127.0.0.1:5173",
      "http://localhost:3000",
      "*" // Allow all origins for development - remove in production
    ],
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    credentials: true,
    allowedHeaders: ["Content-Type", "Authorization", "Accept", "Origin", "X-Requested-With"]
  },
  // Enhanced Socket.IO options
  transports: ['websocket', 'polling'], // Enable both transports
  allowEIO3: true, // Allow Engine.IO v3 clients
  pingTimeout: 60000, // 60 seconds
  pingInterval: 25000, // 25 seconds
  upgradeTimeout: 10000, // 10 seconds
  maxHttpBufferSize: 1e6, // 1MB
  allowRequest: (req, callback) => {
    // Allow all connections for now - add authentication logic here if needed
    callback(null, true);
  }
});

// Make io and globalState accessible to routes
app.set('io', io);
app.set('globalState', globalState);

// Make io and app globally accessible for health checker
global.io = io;
global.app = app;

// Socket.IO connection handling with enhanced error handling
io.on('connection', (socket) => {
  console.log(`🔗 User connected: ${socket.id} from ${socket.handshake.address}`);
  
  // Send current state to newly connected client
  socket.emit('initialState', {
    activeMeetings: Array.from(globalState.activeMeetings.values()),
    activeParticipants: Array.from(globalState.activeParticipants.values()),
    meetingAnalytics: globalState.meetingAnalytics,
    recentNotifications: globalState.notifications.slice(-10)
  });

  // Handle connection errors
  socket.on('error', (error) => {
    console.error(`❌ Socket error for ${socket.id}:`, error);
  });
  
  // Handle connect errors
  socket.on('connect_error', (error) => {
    console.error(`❌ Socket connection error for ${socket.id}:`, error);
  });

  // Handle joining a meeting room
  socket.on('joinMeeting', (meetingId) => {
    socket.join(`meeting_${meetingId}`);
    console.log(`👥 User ${socket.id} joined meeting room: ${meetingId}`);
    
    // Notify others in the meeting
    socket.to(`meeting_${meetingId}`).emit('userJoinedRoom', {
      userId: socket.id,
      timestamp: new Date().toISOString()
    });
  });

  // Handle leaving a meeting room
  socket.on('leaveMeeting', (meetingId) => {
    socket.leave(`meeting_${meetingId}`);
    console.log(`👋 User ${socket.id} left meeting room: ${meetingId}`);
    
    // Notify others in the meeting
    socket.to(`meeting_${meetingId}`).emit('userLeftRoom', {
      userId: socket.id,
      timestamp: new Date().toISOString()
    });
  });

  // Handle participant status updates
  socket.on('participantUpdate', (data) => {
    const { meetingId, participantData } = data;
    
    // Update global state
    globalState.activeParticipants.set(participantData.id, {
      ...participantData,
      lastUpdate: new Date().toISOString()
    });
    
    // Broadcast to all clients in the meeting
    io.to(`meeting_${meetingId}`).emit('participantStatusUpdate', {
      participant: participantData,
      timestamp: new Date().toISOString()
    });
    
    // Send notification
    const notification = {
      id: Date.now(),
      type: 'participant_update',
      title: 'Participant Update',
      message: `${participantData.name} status: ${participantData.attendanceStatus}`,
      timestamp: new Date().toISOString(),
      meetingId
    };
    
    addNotification(notification);
    io.emit('notification', notification);
  });

  // Handle meeting events
  socket.on('meetingEvent', (data) => {
    const { meetingId, eventType, eventData } = data;
    
    // Broadcast meeting events
    io.to(`meeting_${meetingId}`).emit('meetingEventUpdate', {
      eventType,
      eventData,
      timestamp: new Date().toISOString()
    });
    
    // Create notification for important events
    if (['meeting_started', 'meeting_ended', 'participant_joined', 'participant_left'].includes(eventType)) {
      const notification = {
        id: Date.now(),
        type: 'meeting_event',
        title: getEventTitle(eventType),
        message: getEventMessage(eventType, eventData),
        timestamp: new Date().toISOString(),
        meetingId
      };
      
      addNotification(notification);
      io.emit('notification', notification);
    }
  });

  // Handle real-time analytics requests
  socket.on('getAnalytics', (meetingId) => {
    const analytics = generateMeetingAnalytics(meetingId);
    socket.emit('analyticsUpdate', analytics);
  });

  // 85% Attendance Tracker WebSocket Handlers
  socket.on('subscribe85AttendanceTracker', (data) => {
    const { meetingId, options } = data;
    console.log(`📊 Client ${socket.id} subscribing to 85% attendance tracker for meeting ${meetingId}`);
    
    try {
      // Subscribe client to attendance tracker updates
      global.attendanceTracker85WS.subscribeClient(socket, meetingId);
      
      // Start tracking if not already started
      global.attendanceTracker85WS.startTracking(io, meetingId, options?.interval || 10000);
      
      // Send initial data
      global.attendanceTracker85WS.getAttendanceData(meetingId, options)
        .then(initialData => {
          socket.emit('attendance85Initial', {
            meetingId,
            data: initialData,
            timestamp: new Date().toISOString()
          });
        })
        .catch(error => {
          socket.emit('attendance85Error', {
            meetingId,
            error: error.message,
            timestamp: new Date().toISOString()
          });
        });
      
      // Confirm subscription
      socket.emit('attendance85Subscribed', {
        meetingId,
        message: '85% attendance tracker subscription successful',
        timestamp: new Date().toISOString()
      });
      
    } catch (error) {
      console.error(`❌ Error subscribing to 85% attendance tracker:`, error);
      socket.emit('attendance85Error', {
        meetingId,
        error: error.message,
        timestamp: new Date().toISOString()
      });
    }
  });

  socket.on('unsubscribe85AttendanceTracker', (data) => {
    const { meetingId } = data;
    console.log(`📊 Client ${socket.id} unsubscribing from 85% attendance tracker for meeting ${meetingId}`);
    
    try {
      // Unsubscribe client from attendance tracker updates
      global.attendanceTracker85WS.unsubscribeClient(socket, meetingId);
      
      // Confirm unsubscription
      socket.emit('attendance85Unsubscribed', {
        meetingId,
        message: '85% attendance tracker unsubscribed successfully',
        timestamp: new Date().toISOString()
      });
      
    } catch (error) {
      console.error(`❌ Error unsubscribing from 85% attendance tracker:`, error);
      socket.emit('attendance85Error', {
        meetingId,
        error: error.message,
        timestamp: new Date().toISOString()
      });
    }
  });

  socket.on('get85AttendanceStatus', (data) => {
    const { meetingId } = data;
    
    try {
      const status = global.attendanceTracker85WS.getTrackingStatus();
      socket.emit('attendance85Status', {
        meetingId,
        status,
        isTracked: status.activeMeetings.includes(meetingId),
        timestamp: new Date().toISOString()
      });
      
    } catch (error) {
      console.error(`❌ Error getting 85% attendance status:`, error);
      socket.emit('attendance85Error', {
        meetingId,
        error: error.message,
        timestamp: new Date().toISOString()
      });
    }
  });

  // Handle disconnection
  socket.on('disconnect', () => {
    console.log(`❌ User disconnected: ${socket.id}`);
    
    // Clean up any 85% attendance tracker subscriptions
    try {
      const trackingStatus = global.attendanceTracker85WS.getTrackingStatus();
      trackingStatus.activeMeetings.forEach(meetingId => {
        global.attendanceTracker85WS.unsubscribeClient(socket, meetingId);
      });
    } catch (error) {
      console.warn('Warning: Error cleaning up 85% attendance subscriptions:', error);
    }
  });
});

// Helper functions
function addNotification(notification) {
  globalState.notifications.push(notification);
  // Keep only last 100 notifications
  if (globalState.notifications.length > 100) {
    globalState.notifications = globalState.notifications.slice(-100);
  }
}

function getEventTitle(eventType) {
  const titles = {
    'meeting_started': '🎥 Meeting Started',
    'meeting_ended': '🔚 Meeting Ended',
    'participant_joined': '👋 Participant Joined',
    'participant_left': '👋 Participant Left'
  };
  return titles[eventType] || '📋 Meeting Update';
}

function getEventMessage(eventType, eventData) {
  switch (eventType) {
    case 'meeting_started':
      return `Meeting "${eventData.topic}" has started`;
    case 'meeting_ended':
      return `Meeting "${eventData.topic}" has ended`;
    case 'participant_joined':
      return `${eventData.name} joined the meeting`;
    case 'participant_left':
      return `${eventData.name} left the meeting`;
    default:
      return 'Meeting event occurred';
  }
}

function generateMeetingAnalytics(meetingId) {
  const meeting = globalState.activeMeetings.get(meetingId);
  if (!meeting) return null;
  
  const participants = Array.from(globalState.activeParticipants.values())
    .filter(p => p.meetingId === meetingId);
  
  return {
    meetingId,
    totalParticipants: participants.length,
    activeParticipants: participants.filter(p => p.isActive).length,
    attendanceRate: participants.length > 0 
      ? Math.round((participants.filter(p => p.attendancePercentage >= 75).length / participants.length) * 100)
      : 0,
    averageDuration: participants.length > 0
      ? Math.round(participants.reduce((sum, p) => sum + (p.duration || 0), 0) / participants.length)
      : 0,
    lastUpdate: new Date().toISOString()
  };
}

// Scheduled cleanup tasks
cron.schedule('0 * * * *', async () => {
  // Clean up stale data every hour
  const cutoffTime = moment().subtract(1, 'hour').toISOString();
  
  // Clean up stale participant data
  for (const [key, participant] of globalState.activeParticipants.entries()) {
    if (participant.lastUpdate < cutoffTime) {
      globalState.activeParticipants.delete(key);
    }
  }
  
  // Clean up old notifications (keep last 100)
  if (globalState.notifications.length > 100) {
    globalState.notifications = globalState.notifications.slice(-100);
  }
  
  console.log(`🧹 Cleaned up stale data. Active participants: ${globalState.activeParticipants.size}, Notifications: ${globalState.notifications.length}`);
});

// Essential Routes Only
app.use('/api/auth', authRoutes);
app.use('/api/token-test', tokenTestRoutes);
app.use('/stu', StudentRoutes);
app.use('/api/students', StudentRoutes); // API consistency endpoint
app.use('/api/meetings', meetingsRoutes);
app.use('/api/user-sessions', userSessionRoutes);
app.use('/api/zoom', zoomRoutes);
app.use('/api/zoom', zoomClearRoutes);
app.use('/api/zoom', attendanceTracker85Routes);
app.use('/api/attendance-tracker', zoomDurationAttendanceRoutes);
console.log('🔧 Zoom routes mounted at /api/zoom');
console.log('🧹 Zoom Clear routes mounted at /api/zoom');
console.log('📊 85% Attendance Tracker routes mounted at /api/zoom');
console.log('📈 Zoom Duration Attendance routes mounted at /api/attendance-tracker');

// Unified Attendance Tracking System (replaces all old attendance systems)
app.use('/api/attendance-unified', unifiedAttendanceRoutes);

// QR Code Attendance System
app.use('/api/qr-attendance', qrAttendanceRoutes);
console.log('📱 QR Attendance routes mounted at /api/qr-attendance');

// Initialize unified attendance tracker with socket.io
initializeUnifiedTracker(io);

// Initialize System Health Checker
let systemHealthChecker = null;

async function initializeSystemHealthChecker() {
  try {
    console.log('🏥 Initializing System Health Checker...');
    systemHealthChecker = new SystemHealthChecker();
    
    // Make health checker accessible globally
    app.set('systemHealthChecker', systemHealthChecker);
    global.systemHealthChecker = systemHealthChecker;
    
    console.log('✅ System Health Checker initialized successfully');
  } catch (error) {
    console.error('❌ Failed to initialize System Health Checker:', error);
    console.log('⚠️ Server will continue without system health monitoring');
  }
}

// Basic health check endpoint
app.get('/api/health', (req, res) => {
  const userSessionStats = userSessionManager ? userSessionManager.getSessionStats() : null;
  
  res.json({ 
    status: 'healthy', 
    timestamp: new Date().toISOString(),
    activeMeetings: globalState.activeMeetings.size,
    activeParticipants: globalState.activeParticipants.size,
    unifiedAttendanceTracking: {
      enabled: true,
      description: 'Unified attendance tracking system active'
    },
    socketIO: {
      connected: io.engine.clientsCount,
      transports: ['websocket', 'polling']
    },
    userSessions: userSessionStats,
    rateLimiter: rateLimiter.getStats(),
    requestQueue: zoomRequestQueue.getStats()
  });
});

// Comprehensive health check endpoint
app.get('/api/health/detailed', async (req, res) => {
  try {
    if (systemHealthChecker) {
      const healthStatus = systemHealthChecker.getHealthStatus();
      res.json({
        success: true,
        ...healthStatus,
        userSessions: userSessionManager ? userSessionManager.getSessionStats() : null
      });
    } else {
      res.json({
        success: false,
        message: 'System health checker not initialized',
        timestamp: new Date().toISOString()
      });
    }
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

// User session system validation endpoint
app.get('/api/health/validate-user-sessions', async (req, res) => {
  try {
    if (systemHealthChecker) {
      const validation = await systemHealthChecker.validateUserSessionSystem();
      res.json(validation);
    } else {
      res.json({
        timestamp: new Date(),
        summary: {
          overallStatus: 'error',
          validationScore: 0,
          passedChecks: 0,
          totalChecks: 1
        },
        results: [{
          check: 'System Health Checker',
          status: 'failed',
          message: 'System health checker not initialized'
        }]
      });
    }
  } catch (error) {
    res.status(500).json({
      timestamp: new Date(),
      summary: {
        overallStatus: 'error',
        validationScore: 0,
        error: error.message
      },
      results: [{
        check: 'Validation Execution',
        status: 'error',
        message: error.message
      }]
    });
  }
});

// Rate limiter statistics endpoint
app.get('/api/rate-limiter/stats', (req, res) => {
  try {
    const stats = rateLimiter.getStats();
    res.json({
      success: true,
      stats,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

// Request queue statistics endpoint
app.get('/api/request-queue/stats', (req, res) => {
  try {
    const stats = zoomRequestQueue.getStats();
    res.json({
      success: true,
      stats,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

// Request queue control endpoints
app.post('/api/request-queue/clear', (req, res) => {
  try {
    zoomRequestQueue.clear();
    res.json({
      success: true,
      message: 'Request queue cleared',
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

// Rate limiter control endpoints
app.post('/api/rate-limiter/reset-stats', (req, res) => {
  try {
    rateLimiter.resetStats();
    res.json({
      success: true,
      message: 'Rate limiter statistics reset',
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

app.post('/api/rate-limiter/clear-cache', (req, res) => {
  try {
    rateLimiter.clearCaches();
    res.json({
      success: true,
      message: 'Rate limiter caches cleared',
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

// Socket.IO test endpoint
app.get('/api/socketio-test', (req, res) => {
  res.send(`
    <!DOCTYPE html>
    <html>
    <head>
      <title>Socket.IO Test</title>
      <script src="https://cdn.socket.io/4.7.4/socket.io.min.js"></script>
    </head>
    <body>
      <h1>Socket.IO Connection Test</h1>
      <div id="status">Connecting...</div>
      <div id="messages"></div>
      
      <script>
        const socket = io('http://localhost:5000', {
          transports: ['websocket', 'polling'],
          timeout: 5000
        });
        
        const statusDiv = document.getElementById('status');
        const messagesDiv = document.getElementById('messages');
        
        function addMessage(msg) {
          const p = document.createElement('p');
          p.textContent = new Date().toLocaleTimeString() + ': ' + msg;
          messagesDiv.appendChild(p);
        }
        
        socket.on('connect', () => {
          statusDiv.innerHTML = '✅ Connected to Socket.IO server!';
          statusDiv.style.color = 'green';
          addMessage('Connected with ID: ' + socket.id);
        });
        
        socket.on('disconnect', () => {
          statusDiv.innerHTML = '❌ Disconnected from Socket.IO server';
          statusDiv.style.color = 'red';
          addMessage('Disconnected');
        });
        
        socket.on('connect_error', (error) => {
          statusDiv.innerHTML = '❌ Connection Error: ' + error.message;
          statusDiv.style.color = 'red';
          addMessage('Connection error: ' + error.message);
        });
        
        socket.on('initialState', (data) => {
          addMessage('Received initial state with ' + data.activeMeetings.length + ' meetings');
        });
      </script>
    </body>
    </html>
  `);
});

// Export globalState for use in routes
module.exports = { globalState };

// Start server
const PORT = process.env.PORT || 5000;
server.listen(PORT, async () => {
  console.log(`🚀 Server running on port ${PORT}`);
  console.log(`🔗 Socket.IO enabled for real-time communication`);
  console.log(`🌐 CORS enabled for: ${process.env.FRONTEND_URL}`);
  console.log(`🎯 Unified Attendance Tracking System initialized`);
  
  // Initialize system health checker
  await initializeSystemHealthChecker();
  
  // Start periodic health checks if system health checker is initialized
  if (systemHealthChecker) {
    console.log('🔄 Starting periodic health checks (every 60 seconds)');
    systemHealthChecker.startPeriodicChecks(60000); // 60 seconds
  }
  
  console.log('✅ Server startup complete - ready to handle requests');
});

// Graceful shutdown handlers
process.on('SIGTERM', async () => {
  console.log('🔄 Received SIGTERM signal. Graceful shutdown...');
  server.close(async () => {
    console.log('🔚 HTTP server closed.');
    try {
      await mongoose.connection.close();
      console.log('🔒 MongoDB connection closed.');
    } catch (error) {
      console.error('❌ Error closing MongoDB connection:', error.message);
    }
    process.exit(0);
  });
});

process.on('SIGINT', async () => {
  console.log('🔄 Received SIGINT signal. Graceful shutdown...');
  server.close(async () => {
    console.log('🔚 HTTP server closed.');
    try {
      await mongoose.connection.close();
      console.log('🔒 MongoDB connection closed.');
    } catch (error) {
      console.error('❌ Error closing MongoDB connection:', error.message);
    }
    process.exit(0);
  });
});

// Handle unhandled promise rejections
process.on('unhandledRejection', (reason, promise) => {
  console.error('❌ Unhandled Rejection at:', promise, 'reason:', reason);
  // Application specific logging, throwing an error, or other logic here
});

// Handle uncaught exceptions
process.on('uncaughtException', (error) => {
  console.error('❌ Uncaught Exception thrown:', error);
  process.exit(1);
});

console.log('🛡️ Process handlers registered for graceful shutdown');
// QR Token Test Routes
const qrTokenTestRoutes = require('./routes/qrTokenTest');
app.use('/api/qr-token-test', qrTokenTestRoutes);
console.log('🔬 QR Token Test routes mounted at /api/qr-token-test');
