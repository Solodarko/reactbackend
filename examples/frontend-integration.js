/**
 * Complete Frontend Integration Example for User Session Tracking
 * 
 * This file provides comprehensive examples of how to integrate the user session
 * tracking system in your frontend admin dashboard and user interfaces.
 */

// ========================================
// 1. User Registration for Meeting (Student/User Interface)
// ========================================

/**
 * Example: User joins a meeting page and automatically registers for attendance
 */
class UserMeetingInterface {
  constructor(meetingId, authToken) {
    this.meetingId = meetingId;
    this.authToken = authToken;
    this.sessionId = null;
    this.socket = null;
    this.init();
  }

  async init() {
    // Initialize Socket.IO connection
    this.setupSocketConnection();
    
    // Register for meeting attendance
    await this.registerForMeeting();
    
    // Set up page unload handler
    this.setupPageUnloadHandler();
  }

  setupSocketConnection() {
    this.socket = io(window.location.origin, {
      auth: {
        token: this.authToken
      }
    });

    this.socket.on('connect', () => {
      console.log('Connected to real-time updates');
      // Join the meeting room for real-time updates
      this.socket.emit('joinMeeting', this.meetingId);
    });

    this.socket.on('participantJoined', (data) => {
      if (data.type === 'authenticated_user') {
        console.log('Authenticated user joined:', data.user.username);
        this.updateParticipantsList(data);
      }
    });

    this.socket.on('userJoinedMeeting', (data) => {
      console.log(`${data.user.username} joined meeting ${data.meetingId}`);
    });
  }

  async registerForMeeting() {
    try {
      const response = await fetch('/api/user-sessions/join-meeting', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.authToken}`
        },
        body: JSON.stringify({
          meetingId: this.meetingId,
          participantData: {
            device: this.detectDevice(),
            participantName: 'Auto-detected from token'
          }
        })
      });

      const result = await response.json();

      if (result.success) {
        this.sessionId = result.sessionId;
        console.log('Successfully registered for meeting:', result.userData);
        
        // Show success message to user
        this.showNotification('You have been registered for attendance tracking', 'success');
        
        // Store session info
        sessionStorage.setItem('meetingSessionId', this.sessionId);
        sessionStorage.setItem('meetingId', this.meetingId);
        
        // Display user info
        this.displayUserInfo(result.userData);
        
      } else {
        console.error('Failed to register for meeting:', result.message);
        this.showNotification(`Registration failed: ${result.message}`, 'error');
        
        // Handle specific error cases
        if (result.code === 'DUPLICATE_SESSION') {
          this.sessionId = result.existingSessionId;
          this.showNotification('You already have an active session for this meeting', 'info');
        }
      }
    } catch (error) {
      console.error('Error registering for meeting:', error);
      this.showNotification('Failed to register for attendance tracking', 'error');
    }
  }

  async updateActivity(activityData) {
    if (!this.sessionId) return;

    try {
      await fetch('/api/user-sessions/update-activity', {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.authToken}`
        },
        body: JSON.stringify({
          sessionId: this.sessionId,
          activityData: activityData
        })
      });
    } catch (error) {
      console.error('Failed to update activity:', error);
    }
  }

  async leaveMeeting() {
    if (!this.sessionId) return;

    try {
      const response = await fetch('/api/user-sessions/leave-meeting', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.authToken}`
        },
        body: JSON.stringify({
          sessionId: this.sessionId
        })
      });

      const result = await response.json();
      
      if (result.success) {
        console.log('Successfully left meeting. Duration:', result.sessionData.duration, 'minutes');
        this.showNotification(`Session ended. Duration: ${result.sessionData.duration} minutes`, 'info');
      }
    } catch (error) {
      console.error('Error leaving meeting:', error);
    }
  }

  setupPageUnloadHandler() {
    window.addEventListener('beforeunload', () => {
      if (this.sessionId) {
        // Use sendBeacon for reliable delivery on page unload
        navigator.sendBeacon('/api/user-sessions/leave-meeting', JSON.stringify({
          sessionId: this.sessionId
        }));
      }
    });
  }

  detectDevice() {
    const userAgent = navigator.userAgent;
    if (/Mobi|Android/i.test(userAgent)) {
      return 'Mobile';
    } else if (/Tablet|iPad/i.test(userAgent)) {
      return 'Tablet';
    } else {
      return 'Desktop';
    }
  }

  displayUserInfo(userData) {
    const userInfoElement = document.getElementById('user-info');
    if (userInfoElement) {
      userInfoElement.innerHTML = `
        <div class="user-session-info">
          <h3>Attendance Registration</h3>
          <p><strong>Name:</strong> ${userData.user.username}</p>
          <p><strong>Email:</strong> ${userData.user.email}</p>
          <p><strong>Role:</strong> ${userData.user.role}</p>
          ${userData.student ? `
            <p><strong>Student ID:</strong> ${userData.student.studentId}</p>
            <p><strong>Department:</strong> ${userData.student.department}</p>
          ` : ''}
          <p><strong>Join Time:</strong> ${new Date(userData.joinTime).toLocaleString()}</p>
          <p class="status success">✅ Registered for attendance tracking</p>
        </div>
      `;
    }
  }

  showNotification(message, type = 'info') {
    // Implementation depends on your notification system
    console.log(`[${type.toUpperCase()}] ${message}`);
    
    // Example using a simple notification div
    const notification = document.createElement('div');
    notification.className = `notification ${type}`;
    notification.textContent = message;
    document.body.appendChild(notification);
    
    setTimeout(() => {
      notification.remove();
    }, 5000);
  }

  updateParticipantsList(data) {
    // Update UI with new participant information
    console.log('Updating participants list with:', data);
  }
}

// ========================================
// 2. Admin Dashboard Integration
// ========================================

/**
 * Example: Admin dashboard for monitoring authenticated participants
 */
class AdminDashboard {
  constructor(authToken) {
    this.authToken = authToken;
    this.socket = null;
    this.activeMeetings = new Map();
    this.init();
  }

  async init() {
    this.setupSocketConnection();
    await this.loadActiveMeetings();
    this.startAutoRefresh();
  }

  setupSocketConnection() {
    this.socket = io(window.location.origin, {
      auth: {
        token: this.authToken
      }
    });

    this.socket.on('connect', () => {
      console.log('Admin dashboard connected to real-time updates');
    });

    // Listen for user session events
    this.socket.on('userJoinedMeeting', (data) => {
      this.handleUserJoined(data);
    });

    this.socket.on('userLeftMeeting', (data) => {
      this.handleUserLeft(data);
    });

    this.socket.on('participantLinked', (data) => {
      this.handleParticipantLinked(data);
    });

    this.socket.on('attendanceDataFetched', (data) => {
      if (data.type === 'enriched') {
        this.updateMeetingData(data);
      }
    });
  }

  async loadActiveMeetings() {
    try {
      // Get list of active meetings from your meeting management system
      const response = await fetch('/api/meetings/active', {
        headers: {
          'Authorization': `Bearer ${this.authToken}`
        }
      });
      
      const meetings = await response.json();
      
      for (const meeting of meetings) {
        await this.loadMeetingAttendance(meeting.meetingId);
      }
      
    } catch (error) {
      console.error('Error loading active meetings:', error);
    }
  }

  async loadMeetingAttendance(meetingId, enriched = true) {
    try {
      const url = enriched 
        ? `/api/attendance-tracker/attendance/${meetingId}?enriched=true`
        : `/api/attendance-tracker/attendance/${meetingId}`;
      
      const response = await fetch(url, {
        headers: {
          'Authorization': `Bearer ${this.authToken}`
        }
      });

      const attendanceData = await response.json();

      if (attendanceData.success) {
        this.activeMeetings.set(meetingId, attendanceData);
        this.renderMeetingAttendance(meetingId, attendanceData);
      }
    } catch (error) {
      console.error(`Error loading attendance for meeting ${meetingId}:`, error);
    }
  }

  renderMeetingAttendance(meetingId, attendanceData) {
    const container = document.getElementById('meetings-container');
    if (!container) return;

    let meetingElement = document.getElementById(`meeting-${meetingId}`);
    if (!meetingElement) {
      meetingElement = document.createElement('div');
      meetingElement.id = `meeting-${meetingId}`;
      meetingElement.className = 'meeting-attendance';
      container.appendChild(meetingElement);
    }

    const { participants, statistics, authenticationStats } = attendanceData;

    meetingElement.innerHTML = `
      <div class="meeting-header">
        <h3>Meeting: ${meetingId}</h3>
        <div class="meeting-stats">
          <span class="stat">Total: ${statistics.total}</span>
          <span class="stat">Active: ${statistics.active}</span>
          <span class="stat">Present: ${statistics.present}</span>
          ${authenticationStats ? `
            <span class="stat authenticated">Authenticated: ${authenticationStats.totalAuthenticated}</span>
            <span class="stat students">Students: ${authenticationStats.authenticatedStudents}</span>
            <span class="stat admins">Admins: ${authenticationStats.authenticatedAdmins}</span>
          ` : ''}
        </div>
      </div>
      
      <div class="participants-list">
        ${this.renderParticipantsList(participants)}
      </div>
      
      ${authenticationStats ? `
        <div class="auth-breakdown">
          <h4>Authentication Breakdown</h4>
          <div class="auth-stats">
            <div class="auth-stat">
              <span class="label">Authenticated:</span>
              <span class="value">${authenticationStats.totalAuthenticated}</span>
            </div>
            <div class="auth-stat">
              <span class="label">Unauthenticated:</span>
              <span class="value">${authenticationStats.unauthenticatedParticipants}</span>
            </div>
          </div>
        </div>
      ` : ''}
    `;
  }

  renderParticipantsList(participants) {
    return participants.map(participant => {
      const isAuthenticated = participant.isAuthenticated;
      const authUser = participant.authenticatedUser;
      const student = participant.studentInfo;

      return `
        <div class="participant ${isAuthenticated ? 'authenticated' : 'unauthenticated'} ${participant.attendanceStatus.toLowerCase()}">
          <div class="participant-info">
            <div class="participant-name">
              ${participant.participantName}
              ${isAuthenticated ? '<span class="auth-badge">🔐</span>' : ''}
              ${participant.isActive ? '<span class="active-badge">🟢</span>' : '<span class="inactive-badge">🔴</span>'}
            </div>
            
            ${isAuthenticated ? `
              <div class="auth-details">
                <div class="auth-user">
                  <strong>User:</strong> ${authUser.username} (${authUser.role})
                  <br><strong>Email:</strong> ${authUser.email}
                </div>
                ${student ? `
                  <div class="student-info">
                    <strong>Student:</strong> ${student.firstName} ${student.lastName}
                    <br><strong>ID:</strong> ${student.studentId} | <strong>Dept:</strong> ${student.department}
                  </div>
                ` : ''}
              </div>
            ` : `
              <div class="unauth-details">
                <span class="email">${participant.email || 'No email'}</span>
              </div>
            `}
            
            <div class="attendance-details">
              <span class="status ${participant.attendanceStatus.toLowerCase()}">${participant.attendanceStatus}</span>
              <span class="duration">${participant.duration} min</span>
              <span class="join-time">${new Date(participant.joinTime).toLocaleTimeString()}</span>
            </div>
          </div>
          
          ${isAuthenticated && authUser.sessionId ? `
            <div class="participant-actions">
              <button onclick="adminDashboard.linkParticipant('${authUser.sessionId}', '${participant.participantId}')">
                Link with Zoom
              </button>
            </div>
          ` : ''}
        </div>
      `;
    }).join('');
  }

  async linkParticipant(sessionId, participantId) {
    try {
      const response = await fetch('/api/user-sessions/link-zoom-participant', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.authToken}`
        },
        body: JSON.stringify({
          sessionId,
          participantId
        })
      });

      const result = await response.json();
      
      if (result.success) {
        console.log('Successfully linked participant');
        this.showNotification('Participant linked successfully', 'success');
      } else {
        this.showNotification(`Failed to link participant: ${result.message}`, 'error');
      }
    } catch (error) {
      console.error('Error linking participant:', error);
      this.showNotification('Failed to link participant', 'error');
    }
  }

  handleUserJoined(data) {
    console.log(`User ${data.user.username} joined meeting ${data.meetingId}`);
    this.showNotification(`${data.user.username} joined the meeting`, 'info');
    
    // Refresh the meeting data
    this.loadMeetingAttendance(data.meetingId);
  }

  handleUserLeft(data) {
    console.log(`User ${data.user.username} left meeting after ${data.duration} minutes`);
    this.showNotification(`${data.user.username} left (${data.duration}min)`, 'info');
    
    // Refresh the meeting data
    this.loadMeetingAttendance(data.meetingId);
  }

  handleParticipantLinked(data) {
    console.log('Participant linked:', data);
    this.showNotification(`${data.user.username} linked with Zoom participant`, 'success');
    
    // Refresh the meeting data to show the link
    this.loadMeetingAttendance(data.participant.meetingId);
  }

  updateMeetingData(data) {
    if (this.activeMeetings.has(data.meetingId)) {
      this.activeMeetings.set(data.meetingId, data);
      this.renderMeetingAttendance(data.meetingId, data);
    }
  }

  startAutoRefresh() {
    // Refresh meeting data every 30 seconds
    setInterval(() => {
      for (const meetingId of this.activeMeetings.keys()) {
        this.loadMeetingAttendance(meetingId);
      }
    }, 30000);
  }

  async getSessionStatistics() {
    try {
      const response = await fetch('/api/user-sessions/stats', {
        headers: {
          'Authorization': `Bearer ${this.authToken}`
        }
      });

      const stats = await response.json();
      
      if (stats.success) {
        this.displaySessionStatistics(stats.statistics);
      }
    } catch (error) {
      console.error('Error fetching session statistics:', error);
    }
  }

  displaySessionStatistics(stats) {
    const statsContainer = document.getElementById('session-stats');
    if (!statsContainer) return;

    statsContainer.innerHTML = `
      <div class="session-statistics">
        <h3>User Session Statistics</h3>
        <div class="stats-grid">
          <div class="stat-item">
            <span class="stat-label">Active Sessions:</span>
            <span class="stat-value">${stats.totalActiveSessions}</span>
          </div>
          <div class="stat-item">
            <span class="stat-label">Active Users:</span>
            <span class="stat-value">${stats.totalActiveUsers}</span>
          </div>
          <div class="stat-item">
            <span class="stat-label">Active Meetings:</span>
            <span class="stat-value">${stats.totalActiveMeetings}</span>
          </div>
          <div class="stat-item">
            <span class="stat-label">Students with Sessions:</span>
            <span class="stat-value">${stats.studentsWithSessions}</span>
          </div>
        </div>
        
        <div class="role-breakdown">
          <h4>Role Breakdown</h4>
          ${Object.entries(stats.roleBreakdown).map(([role, count]) => `
            <div class="role-stat">
              <span class="role-label">${role}:</span>
              <span class="role-count">${count}</span>
            </div>
          `).join('')}
        </div>
      </div>
    `;
  }

  showNotification(message, type = 'info') {
    // Implementation depends on your notification system
    console.log(`[ADMIN ${type.toUpperCase()}] ${message}`);
  }
}

// ========================================
// 3. Usage Examples
// ========================================

// Initialize user interface when on a meeting page
document.addEventListener('DOMContentLoaded', () => {
  const meetingId = window.location.pathname.match(/\/meeting\/([^\/]+)/)?.[1];
  const authToken = localStorage.getItem('authToken') || getCookie('authToken');
  
  if (meetingId && authToken) {
    // Initialize user meeting interface
    window.userMeetingInterface = new UserMeetingInterface(meetingId, authToken);
  }
});

// Initialize admin dashboard
document.addEventListener('DOMContentLoaded', () => {
  if (window.location.pathname.includes('/admin/dashboard')) {
    const authToken = localStorage.getItem('authToken') || getCookie('authToken');
    
    if (authToken) {
      window.adminDashboard = new AdminDashboard(authToken);
    }
  }
});

// Utility function to get cookie value
function getCookie(name) {
  const value = `; ${document.cookie}`;
  const parts = value.split(`; ${name}=`);
  if (parts.length === 2) return parts.pop().split(';').shift();
}

// ========================================
// 4. CSS Styles (Example)
// ========================================

const exampleCSS = `
/* User Session Tracking Styles */
.user-session-info {
  background: #f0f9ff;
  border: 1px solid #0284c7;
  border-radius: 8px;
  padding: 1rem;
  margin: 1rem 0;
}

.meeting-attendance {
  border: 1px solid #e5e7eb;
  border-radius: 8px;
  margin: 1rem 0;
  padding: 1rem;
}

.meeting-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 1rem;
  padding-bottom: 0.5rem;
  border-bottom: 1px solid #e5e7eb;
}

.meeting-stats {
  display: flex;
  gap: 1rem;
}

.stat {
  padding: 0.25rem 0.5rem;
  background: #f3f4f6;
  border-radius: 4px;
  font-size: 0.875rem;
}

.stat.authenticated {
  background: #dcfce7;
  color: #166534;
}

.participant {
  border: 1px solid #e5e7eb;
  border-radius: 6px;
  padding: 0.75rem;
  margin: 0.5rem 0;
  transition: all 0.2s;
}

.participant.authenticated {
  border-color: #10b981;
  background: #f0fdf4;
}

.participant.unauthenticated {
  border-color: #f59e0b;
  background: #fffbeb;
}

.participant-name {
  font-weight: 600;
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

.auth-badge {
  font-size: 0.75rem;
}

.active-badge, .inactive-badge {
  font-size: 0.75rem;
}

.auth-details {
  margin: 0.5rem 0;
  padding: 0.5rem;
  background: #f8fafc;
  border-radius: 4px;
  font-size: 0.875rem;
}

.attendance-details {
  display: flex;
  gap: 1rem;
  margin-top: 0.5rem;
  font-size: 0.875rem;
}

.status {
  padding: 0.125rem 0.5rem;
  border-radius: 4px;
  font-weight: 500;
}

.status.present {
  background: #dcfce7;
  color: #166534;
}

.status.absent {
  background: #fee2e2;
  color: #991b1b;
}

.status.late {
  background: #fef3c7;
  color: #92400e;
}

.notification {
  position: fixed;
  top: 1rem;
  right: 1rem;
  padding: 0.75rem 1rem;
  border-radius: 6px;
  color: white;
  z-index: 1000;
}

.notification.success {
  background: #10b981;
}

.notification.error {
  background: #ef4444;
}

.notification.info {
  background: #3b82f6;
}
`;

// Export for use
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    UserMeetingInterface,
    AdminDashboard,
    exampleCSS
  };
}
