# System Health Monitoring Documentation

## Overview

The system health monitoring feature provides comprehensive health checking and diagnostics for the Zoom meeting attendance tracking system. It includes real-time health status monitoring, periodic checks, system validation, and detailed reporting capabilities.

## Components

### 1. SystemHealthChecker Service

The `SystemHealthChecker` class (`backend/services/systemHealthChecker.js`) provides:

- **Real-time health monitoring** of critical system components
- **Periodic health checks** with configurable intervals  
- **Comprehensive system validation** with scoring
- **Performance metrics collection**
- **Database connectivity monitoring**
- **JWT token validation**
- **Socket.IO connection testing**

### 2. Health Monitoring Endpoints

The system exposes several health monitoring endpoints:

#### Basic Health Check
```
GET /api/health
```

Returns basic system status including:
- Active meetings and participants count
- Real-time tracking status
- Socket.IO connection info
- User session statistics
- Rate limiter stats
- Request queue stats

**Example Response:**
```json
{
  "status": "healthy",
  "timestamp": "2024-01-15T10:30:00.000Z",
  "activeMeetings": 3,
  "activeParticipants": 25,
  "realTimeTracking": {
    "enabled": true,
    "initialized": true,
    "activeMeetingsTracked": 3
  },
  "socketIO": {
    "connected": 12,
    "transports": ["websocket", "polling"]
  },
  "userSessions": {
    "totalSessions": 25,
    "activeSessions": 20,
    "sessionsByMeeting": {...}
  },
  "rateLimiter": {
    "requestsPerMinute": 45,
    "tokensRemaining": 955
  },
  "requestQueue": {
    "pendingRequests": 2,
    "completedRequests": 1543
  }
}
```

#### Detailed Health Check
```
GET /api/health/detailed
```

Returns comprehensive health status with:
- Component-level health status
- Performance metrics
- Error tracking
- Resource usage statistics

**Example Response:**
```json
{
  "success": true,
  "timestamp": "2024-01-15T10:30:00.000Z",
  "overallStatus": "healthy",
  "components": {
    "database": {
      "status": "healthy",
      "responseTime": 15,
      "connections": 8
    },
    "userSessionManager": {
      "status": "healthy",
      "activeSessions": 20,
      "totalSessions": 25
    },
    "socketIO": {
      "status": "healthy",
      "connectedClients": 12,
      "rooms": 5
    },
    "rateLimiter": {
      "status": "healthy",
      "requestsPerMinute": 45,
      "tokensRemaining": 955
    }
  },
  "performance": {
    "memoryUsage": {
      "used": 125.5,
      "total": 512
    },
    "cpuUsage": 15.3,
    "uptime": 3600
  }
}
```

#### User Session System Validation
```
GET /api/health/validate-user-sessions
```

Performs comprehensive validation of the user session tracking system:

**Example Response:**
```json
{
  "timestamp": "2024-01-15T10:30:00.000Z",
  "summary": {
    "overallStatus": "healthy",
    "validationScore": 95,
    "passedChecks": 19,
    "totalChecks": 20
  },
  "results": [
    {
      "check": "UserSessionManager Initialization",
      "status": "passed",
      "message": "Service initialized successfully"
    },
    {
      "check": "JWT Token Validation",
      "status": "passed",
      "message": "Token validation working correctly"
    },
    {
      "check": "Database Connection",
      "status": "passed",
      "message": "Database connection healthy"
    },
    {
      "check": "Socket.IO Integration",
      "status": "warning",
      "message": "Some connections experiencing delays"
    }
  ],
  "recommendations": [
    "Monitor Socket.IO connection performance",
    "Consider optimizing database queries"
  ]
}
```

### 3. Performance and Control Endpoints

#### Rate Limiter Statistics
```
GET /api/rate-limiter/stats
POST /api/rate-limiter/reset-stats
POST /api/rate-limiter/clear-cache
```

#### Request Queue Statistics
```
GET /api/request-queue/stats
POST /api/request-queue/clear
```

#### Zoom Tracker Status
```
GET /api/zoom/tracker-status
```

### 4. Socket.IO Test Page
```
GET /api/socketio-test
```

Provides an HTML test page for verifying Socket.IO connectivity.

## Periodic Health Checks

The system runs automatic health checks every 60 seconds (configurable) to:

- Monitor component health status
- Track performance metrics
- Detect system issues early
- Generate alerts for critical problems
- Collect usage statistics

### Configuring Check Intervals

Health check intervals can be configured when starting the system:

```javascript
// In server.js
if (systemHealthChecker) {
  console.log('🔄 Starting periodic health checks (every 60 seconds)');
  systemHealthChecker.startPeriodicChecks(60000); // 60 seconds
}
```

## Health Check Categories

### 1. Database Health
- Connection status
- Response times
- Active connections
- Query performance

### 2. User Session Management
- Session lifecycle validation
- JWT token verification
- Session cleanup efficiency
- Real-time synchronization

### 3. Socket.IO Communication
- Connection status
- Room management
- Message delivery
- Client connectivity

### 4. Rate Limiting & Queuing
- Request rate monitoring
- Queue performance
- Token bucket status
- API call success rates

### 5. System Resources
- Memory usage
- CPU utilization
- Disk space
- Network connectivity

## Using the Health Monitoring System

### Frontend Integration

#### Basic Health Status
```javascript
// Check basic system health
fetch('/api/health')
  .then(response => response.json())
  .then(data => {
    console.log('System status:', data.status);
    console.log('Active meetings:', data.activeMeetings);
    console.log('Connected users:', data.socketIO.connected);
  });
```

#### Detailed Health Dashboard
```javascript
// Get comprehensive health data for admin dashboard
async function updateHealthDashboard() {
  try {
    const response = await fetch('/api/health/detailed');
    const healthData = await response.json();
    
    if (healthData.success) {
      updateHealthIndicators(healthData.components);
      updatePerformanceMetrics(healthData.performance);
      displaySystemStatus(healthData.overallStatus);
    }
  } catch (error) {
    console.error('Failed to fetch health data:', error);
    displayHealthError();
  }
}

// Update health dashboard every 30 seconds
setInterval(updateHealthDashboard, 30000);
```

#### User Session Validation
```javascript
// Validate user session system
async function validateUserSessions() {
  try {
    const response = await fetch('/api/health/validate-user-sessions');
    const validation = await response.json();
    
    console.log('Validation score:', validation.summary.validationScore);
    console.log('Passed checks:', validation.summary.passedChecks);
    
    validation.results.forEach(result => {
      console.log(`${result.check}: ${result.status} - ${result.message}`);
    });
    
    if (validation.recommendations?.length > 0) {
      console.log('Recommendations:', validation.recommendations);
    }
  } catch (error) {
    console.error('Validation failed:', error);
  }
}
```

### Admin Dashboard Integration

```javascript
class SystemHealthDashboard {
  constructor() {
    this.healthData = null;
    this.updateInterval = null;
  }

  async initialize() {
    await this.fetchHealthData();
    this.startPeriodicUpdates();
    this.setupSocketListeners();
  }

  async fetchHealthData() {
    try {
      const [basic, detailed, validation] = await Promise.all([
        fetch('/api/health').then(r => r.json()),
        fetch('/api/health/detailed').then(r => r.json()),
        fetch('/api/health/validate-user-sessions').then(r => r.json())
      ]);

      this.healthData = { basic, detailed, validation };
      this.updateUI();
    } catch (error) {
      this.displayError('Failed to fetch health data');
    }
  }

  updateUI() {
    // Update health status indicators
    this.updateStatusIndicators();
    
    // Update performance metrics
    this.updatePerformanceCharts();
    
    // Update validation results
    this.updateValidationStatus();
    
    // Update component status
    this.updateComponentStatus();
  }

  updateStatusIndicators() {
    const { basic, detailed } = this.healthData;
    
    document.getElementById('overall-status').textContent = detailed.overallStatus;
    document.getElementById('active-meetings').textContent = basic.activeMeetings;
    document.getElementById('active-participants').textContent = basic.activeParticipants;
    document.getElementById('connected-clients').textContent = basic.socketIO.connected;
  }

  updatePerformanceCharts() {
    const { performance } = this.healthData.detailed;
    
    // Update memory usage chart
    this.updateMemoryChart(performance.memoryUsage);
    
    // Update CPU usage indicator
    document.getElementById('cpu-usage').textContent = `${performance.cpuUsage}%`;
    
    // Update uptime
    this.updateUptime(performance.uptime);
  }

  updateValidationStatus() {
    const { validation } = this.healthData;
    const validationContainer = document.getElementById('validation-results');
    
    validationContainer.innerHTML = validation.results.map(result => `
      <div class="validation-item ${result.status}">
        <span class="check-name">${result.check}</span>
        <span class="status-badge ${result.status}">${result.status}</span>
        <span class="message">${result.message}</span>
      </div>
    `).join('');
  }

  startPeriodicUpdates() {
    this.updateInterval = setInterval(() => {
      this.fetchHealthData();
    }, 30000); // Update every 30 seconds
  }

  setupSocketListeners() {
    const socket = io();
    
    // Listen for health status updates
    socket.on('healthStatusUpdate', (data) => {
      this.handleHealthUpdate(data);
    });
    
    // Listen for system alerts
    socket.on('systemAlert', (alert) => {
      this.displayAlert(alert);
    });
  }

  displayAlert(alert) {
    const alertContainer = document.getElementById('system-alerts');
    const alertElement = document.createElement('div');
    alertElement.className = `alert ${alert.severity}`;
    alertElement.innerHTML = `
      <strong>${alert.title}</strong>
      <p>${alert.message}</p>
      <small>${new Date(alert.timestamp).toLocaleString()}</small>
    `;
    alertContainer.prepend(alertElement);
  }
}

// Initialize health dashboard
const healthDashboard = new SystemHealthDashboard();
healthDashboard.initialize();
```

## Troubleshooting

### Common Issues

1. **Health Checker Not Initialized**
   - Check server logs for initialization errors
   - Verify all dependencies are properly installed
   - Ensure database connection is established

2. **Periodic Checks Not Running**
   - Check if `systemHealthChecker.startPeriodicChecks()` was called
   - Verify the interval parameter is valid
   - Check for any errors in the health check execution

3. **Validation Failures**
   - Review specific validation results for failing checks
   - Check database connectivity and JWT configuration
   - Verify user session manager is properly initialized

4. **Performance Issues**
   - Monitor memory and CPU usage through health endpoints
   - Check rate limiter and request queue statistics
   - Review Socket.IO connection metrics

### Health Check Debugging

Enable detailed logging for health checks:

```javascript
// In systemHealthChecker.js
const DEBUG = process.env.HEALTH_CHECK_DEBUG === 'true';

if (DEBUG) {
  console.log('Health check details:', healthData);
}
```

### Manual Health Checks

Trigger manual health checks via API:

```bash
# Basic health check
curl http://localhost:5000/api/health

# Detailed health status
curl http://localhost:5000/api/health/detailed

# Validate user sessions
curl http://localhost:5000/api/health/validate-user-sessions

# Check rate limiter stats
curl http://localhost:5000/api/rate-limiter/stats

# Check request queue stats  
curl http://localhost:5000/api/request-queue/stats
```

## Security Considerations

- Health endpoints should be secured in production environments
- Consider rate limiting health check endpoints to prevent abuse
- Sensitive system information should be filtered in production
- Monitor health endpoint access logs for suspicious activity

## Performance Impact

The health monitoring system is designed to have minimal performance impact:

- Periodic checks run in background with low priority
- Health data is cached to reduce database queries
- Validation checks are optimized for speed
- Memory usage is kept minimal through efficient data structures

## Configuration Options

Environment variables for health monitoring:

```bash
# Enable debug logging
HEALTH_CHECK_DEBUG=true

# Health check interval (milliseconds)
HEALTH_CHECK_INTERVAL=60000

# Enable/disable specific health checks
ENABLE_DB_HEALTH_CHECK=true
ENABLE_JWT_VALIDATION=true
ENABLE_SOCKETIO_CHECK=true

# Performance monitoring thresholds
MEMORY_USAGE_THRESHOLD=80
CPU_USAGE_THRESHOLD=75
```

This comprehensive health monitoring system ensures robust operation of your Zoom meeting attendance tracking system with real-time insights, proactive issue detection, and detailed system validation.
