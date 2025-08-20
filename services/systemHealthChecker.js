const mongoose = require('mongoose');
const User = require('../models/User');
const Student = require('../models/Student');
const Participant = require('../models/Participant');

class SystemHealthChecker {
  constructor() {
    this.healthChecks = new Map();
    this.lastHealthCheck = null;
    this.healthCheckInterval = 60000; // 1 minute
    this.periodicCheckInterval = null;
    this.init();
  }

  /**
   * Initialize the health checker
   */
  init() {
    console.log('🏥 Initializing System Health Checker...');
    
    // Don't start automatic periodic checks here - let server.js control it via startPeriodicChecks()
    // This prevents duplicate intervals
    
    console.log('✅ System Health Checker initialized');
  }

  /**
   * Check database connection health
   */
  async checkDatabaseConnection() {
    const checkName = 'database_connection';
    try {
      const dbState = mongoose.connection.readyState;
      const states = {
        0: 'disconnected',
        1: 'connected',
        2: 'connecting',
        3: 'disconnecting'
      };

      if (dbState === 1) {
        // Test actual database operation
        await User.findOne().limit(1).lean();
        
        this.healthChecks.set(checkName, {
          status: 'healthy',
          message: 'Database connection is active and responsive',
          state: states[dbState],
          lastChecked: new Date()
        });
        return true;
      } else {
        this.healthChecks.set(checkName, {
          status: 'unhealthy',
          message: `Database connection state: ${states[dbState]}`,
          state: states[dbState],
          lastChecked: new Date()
        });
        return false;
      }
    } catch (error) {
      this.healthChecks.set(checkName, {
        status: 'error',
        message: `Database error: ${error.message}`,
        error: error.message,
        lastChecked: new Date()
      });
      return false;
    }
  }

  /**
   * Check user session manager health
   */
  async checkUserSessionManager() {
    const checkName = 'user_session_manager';
    try {
      const userSessionManager = global.userSessionManager;
      
      if (!userSessionManager) {
        this.healthChecks.set(checkName, {
          status: 'unhealthy',
          message: 'UserSessionManager not initialized',
          lastChecked: new Date()
        });
        return false;
      }

      // Check if the session manager is functioning
      const stats = userSessionManager.getSessionStats();
      
      if (stats && typeof stats === 'object') {
        this.healthChecks.set(checkName, {
          status: 'healthy',
          message: 'UserSessionManager is functioning properly',
          stats: {
            totalActiveSessions: stats.totalActiveSessions,
            totalActiveUsers: stats.totalActiveUsers,
            totalActiveMeetings: stats.totalActiveMeetings
          },
          lastChecked: new Date()
        });
        return true;
      } else {
        this.healthChecks.set(checkName, {
          status: 'unhealthy',
          message: 'UserSessionManager not returning valid statistics',
          lastChecked: new Date()
        });
        return false;
      }
    } catch (error) {
      this.healthChecks.set(checkName, {
        status: 'error',
        message: `UserSessionManager error: ${error.message}`,
        error: error.message,
        lastChecked: new Date()
      });
      return false;
    }
  }

  /**
   * Check JWT token validation
   */
  async checkJWTValidation() {
    const checkName = 'jwt_validation';
    try {
      if (!process.env.JWT_SECRET) {
        this.healthChecks.set(checkName, {
          status: 'error',
          message: 'JWT_SECRET environment variable not set',
          lastChecked: new Date()
        });
        return false;
      }

      // Test JWT validation with userSessionManager
      const userSessionManager = global.userSessionManager;
      if (userSessionManager) {
        // Test with invalid token
        const result = userSessionManager.verifyToken('invalid_token');
        if (result === null) {
          this.healthChecks.set(checkName, {
            status: 'healthy',
            message: 'JWT validation is working correctly',
            lastChecked: new Date()
          });
          return true;
        }
      }

      this.healthChecks.set(checkName, {
        status: 'unhealthy',
        message: 'JWT validation not functioning properly',
        lastChecked: new Date()
      });
      return false;
    } catch (error) {
      this.healthChecks.set(checkName, {
        status: 'error',
        message: `JWT validation error: ${error.message}`,
        error: error.message,
        lastChecked: new Date()
      });
      return false;
    }
  }

  /**
   * Check data model integrity
   */
  async checkDataModelIntegrity() {
    const checkName = 'data_model_integrity';
    try {
      const checks = [];

      // Check User model
      try {
        const userCount = await User.countDocuments();
        checks.push({
          model: 'User',
          status: 'healthy',
          count: userCount
        });
      } catch (error) {
        checks.push({
          model: 'User',
          status: 'error',
          error: error.message
        });
      }

      // Check Student model
      try {
        const studentCount = await Student.countDocuments();
        checks.push({
          model: 'Student',
          status: 'healthy',
          count: studentCount
        });
      } catch (error) {
        checks.push({
          model: 'Student',
          status: 'error',
          error: error.message
        });
      }

      // Check Participant model with new authenticatedUser field
      try {
        const participantCount = await Participant.countDocuments();
        const authenticatedCount = await Participant.countDocuments({
          'authenticatedUser.joinedViaAuth': true
        });
        checks.push({
          model: 'Participant',
          status: 'healthy',
          count: participantCount,
          authenticatedParticipants: authenticatedCount
        });
      } catch (error) {
        checks.push({
          model: 'Participant',
          status: 'error',
          error: error.message
        });
      }

      const hasErrors = checks.some(check => check.status === 'error');
      
      this.healthChecks.set(checkName, {
        status: hasErrors ? 'error' : 'healthy',
        message: hasErrors ? 'Some data models have issues' : 'All data models are accessible',
        modelChecks: checks,
        lastChecked: new Date()
      });

      return !hasErrors;
    } catch (error) {
      this.healthChecks.set(checkName, {
        status: 'error',
        message: `Data model integrity check failed: ${error.message}`,
        error: error.message,
        lastChecked: new Date()
      });
      return false;
    }
  }

  /**
   * Check Socket.IO functionality
   */
  async checkSocketIO() {
    const checkName = 'socket_io';
    try {
      // Check if Socket.IO is available via global object
      // This avoids circular dependency with server.js
      if (global.io) {
        this.healthChecks.set(checkName, {
          status: 'healthy',
          message: 'Socket.IO is initialized and available',
          connectedClients: global.io.engine ? global.io.engine.clientsCount : 0,
          lastChecked: new Date()
        });
        return true;
      } else {
        // Fallback to app io
        const app = global.app;
        if (app && app.get('io')) {
          const io = app.get('io');
          this.healthChecks.set(checkName, {
            status: 'healthy',
            message: 'Socket.IO is initialized and available via app',
            connectedClients: io.engine ? io.engine.clientsCount : 0,
            lastChecked: new Date()
          });
          return true;
        } else {
          this.healthChecks.set(checkName, {
            status: 'unhealthy',
            message: 'Socket.IO not initialized or not accessible',
            lastChecked: new Date()
          });
          return false;
        }
      }
    } catch (error) {
      this.healthChecks.set(checkName, {
        status: 'error',
        message: `Socket.IO check error: ${error.message}`,
        error: error.message,
        lastChecked: new Date()
      });
      return false;
    }
  }

  /**
   * Check system memory and performance
   */
  async checkSystemResources() {
    const checkName = 'system_resources';
    try {
      const memoryUsage = process.memoryUsage();
      const uptime = process.uptime();

      // Convert bytes to MB
      const memoryInMB = {
        rss: Math.round(memoryUsage.rss / 1024 / 1024),
        heapTotal: Math.round(memoryUsage.heapTotal / 1024 / 1024),
        heapUsed: Math.round(memoryUsage.heapUsed / 1024 / 1024),
        external: Math.round(memoryUsage.external / 1024 / 1024)
      };

      // Basic health thresholds
      const heapUsagePercentage = (memoryInMB.heapUsed / memoryInMB.heapTotal) * 100;
      const isHealthy = heapUsagePercentage < 90; // Consider unhealthy if heap usage > 90%

      this.healthChecks.set(checkName, {
        status: isHealthy ? 'healthy' : 'warning',
        message: isHealthy ? 'System resources are within normal limits' : 'High memory usage detected',
        memoryUsage: memoryInMB,
        heapUsagePercentage: Math.round(heapUsagePercentage),
        uptimeHours: Math.round(uptime / 3600),
        lastChecked: new Date()
      });

      return isHealthy;
    } catch (error) {
      this.healthChecks.set(checkName, {
        status: 'error',
        message: `System resources check error: ${error.message}`,
        error: error.message,
        lastChecked: new Date()
      });
      return false;
    }
  }

  /**
   * Run all health checks
   */
  async runHealthChecks() {
    console.log('🔍 Running system health checks...');
    
    const startTime = Date.now();
    
    try {
      const results = await Promise.allSettled([
        this.checkDatabaseConnection(),
        this.checkUserSessionManager(),
        this.checkJWTValidation(),
        this.checkDataModelIntegrity(),
        this.checkSocketIO(),
        this.checkSystemResources()
      ]);

      const healthyCount = results.filter(r => r.status === 'fulfilled' && r.value === true).length;
      const totalChecks = results.length;

      this.lastHealthCheck = {
        timestamp: new Date(),
        overallHealth: healthyCount === totalChecks ? 'healthy' : 'degraded',
        healthyChecks: healthyCount,
        totalChecks: totalChecks,
        checkDuration: Date.now() - startTime
      };

      console.log(`✅ Health check completed: ${healthyCount}/${totalChecks} checks passed`);
    } catch (error) {
      console.error('❌ Health check execution failed:', error.message);
      this.lastHealthCheck = {
        timestamp: new Date(),
        overallHealth: 'error',
        error: error.message,
        checkDuration: Date.now() - startTime
      };
    }
  }

  /**
   * Get current health status
   */
  getHealthStatus() {
    const healthChecks = Object.fromEntries(this.healthChecks);
    
    return {
      overallHealth: this.lastHealthCheck?.overallHealth || 'unknown',
      lastHealthCheck: this.lastHealthCheck,
      checks: healthChecks,
      summary: {
        totalChecks: this.healthChecks.size,
        healthyChecks: Array.from(this.healthChecks.values()).filter(c => c.status === 'healthy').length,
        unhealthyChecks: Array.from(this.healthChecks.values()).filter(c => c.status === 'unhealthy').length,
        errorChecks: Array.from(this.healthChecks.values()).filter(c => c.status === 'error').length
      }
    };
  }

  /**
   * Start periodic health checks with custom interval
   * @param {number} interval - Check interval in milliseconds
   */
  startPeriodicChecks(interval = 60000) {
    // Clear existing interval if any
    if (this.periodicCheckInterval) {
      clearInterval(this.periodicCheckInterval);
    }
    
    // Update interval
    this.healthCheckInterval = interval;
    
    // Start new periodic checks
    this.periodicCheckInterval = setInterval(() => {
      this.runHealthChecks();
    }, this.healthCheckInterval);
    
    console.log(`🔄 Periodic health checks started with ${interval / 1000} second interval`);
    
    // Run initial health check
    this.runHealthChecks();
  }

  /**
   * Stop periodic health checks
   */
  stopPeriodicChecks() {
    if (this.periodicCheckInterval) {
      clearInterval(this.periodicCheckInterval);
      this.periodicCheckInterval = null;
      console.log('⏹️ Periodic health checks stopped');
    }
  }

  /**
   * Validate user session tracking system integrity
   */
  async validateUserSessionSystem() {
    const validation = {
      timestamp: new Date(),
      results: []
    };

    try {
      // Check if UserSessionManager is properly initialized
      const userSessionManager = global.userSessionManager;
      if (userSessionManager) {
        validation.results.push({
          check: 'UserSessionManager Initialization',
          status: 'passed',
          message: 'UserSessionManager is properly initialized'
        });

        // Test token verification
        const testResult = userSessionManager.verifyToken('test_invalid_token');
        if (testResult === null) {
          validation.results.push({
            check: 'Token Verification',
            status: 'passed',
            message: 'Token verification correctly rejects invalid tokens'
          });
        } else {
          validation.results.push({
            check: 'Token Verification',
            status: 'failed',
            message: 'Token verification not working correctly'
          });
        }

        // Test session statistics
        const stats = userSessionManager.getSessionStats();
        if (stats && typeof stats.totalActiveSessions === 'number') {
          validation.results.push({
            check: 'Session Statistics',
            status: 'passed',
            message: 'Session statistics are working correctly'
          });
        } else {
          validation.results.push({
            check: 'Session Statistics',
            status: 'failed',
            message: 'Session statistics not returning valid data'
          });
        }
      } else {
        validation.results.push({
          check: 'UserSessionManager Initialization',
          status: 'failed',
          message: 'UserSessionManager is not initialized'
        });
      }

      // Check database models
      const participantModel = await Participant.findOne({}).lean();
      if (participantModel) {
        if (participantModel.authenticatedUser !== undefined) {
          validation.results.push({
            check: 'Participant Model Schema',
            status: 'passed',
            message: 'Participant model includes authenticatedUser field'
          });
        } else {
          validation.results.push({
            check: 'Participant Model Schema',
            status: 'warning',
            message: 'Participant model missing authenticatedUser field (may be empty)'
          });
        }
      }

      // Check environment variables
      if (process.env.JWT_SECRET) {
        validation.results.push({
          check: 'JWT Secret Configuration',
          status: 'passed',
          message: 'JWT_SECRET is configured'
        });
      } else {
        validation.results.push({
          check: 'JWT Secret Configuration',
          status: 'failed',
          message: 'JWT_SECRET environment variable is missing'
        });
      }

    } catch (error) {
      validation.results.push({
        check: 'System Validation',
        status: 'error',
        message: error.message
      });
    }

    const passed = validation.results.filter(r => r.status === 'passed').length;
    const total = validation.results.length;
    
    validation.summary = {
      overallStatus: passed === total ? 'valid' : 'issues_detected',
      passedChecks: passed,
      totalChecks: total,
      validationScore: Math.round((passed / total) * 100)
    };

    return validation;
  }
}

module.exports = SystemHealthChecker;
