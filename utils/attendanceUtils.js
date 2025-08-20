/**
 * Backend Attendance Utility Functions
 * Mirrors frontend utilities for consistent calculations
 */

/**
 * Calculate session duration from join and leave times
 * @param {string|Date} joinTime - Session start time
 * @param {string|Date|null} leaveTime - Session end time (null if ongoing)
 * @returns {number} Session duration in minutes
 */
const calculateSessionDuration = (joinTime, leaveTime = null) => {
  try {
    const start = new Date(joinTime);
    const end = leaveTime ? new Date(leaveTime) : new Date();
    
    if (isNaN(start.getTime())) return 0;
    if (leaveTime && isNaN(end.getTime())) return 0;
    
    const durationMs = end.getTime() - start.getTime();
    return Math.max(Math.round(durationMs / (1000 * 60)), 0); // Convert to minutes
  } catch (error) {
    console.error('Error calculating session duration:', error);
    return 0;
  }
};

/**
 * Calculate total duration from multiple sessions
 * @param {Array} sessions - Array of session objects with joinTime and leaveTime
 * @returns {number} Total duration across all sessions in minutes
 */
const calculateTotalSessionDuration = (sessions = []) => {
  if (!Array.isArray(sessions) || sessions.length === 0) {
    return 0;
  }
  
  return sessions.reduce((total, session) => {
    const sessionDuration = calculateSessionDuration(
      session.joinTime || session.join_time, 
      session.leaveTime || session.leave_time
    );
    return total + sessionDuration;
  }, 0);
};

/**
 * Calculate meeting duration from start and end times or from meeting data
 * @param {Object} meetingInfo - Meeting information
 * @returns {number} Meeting duration in minutes
 */
const calculateMeetingDurationFromInfo = (meetingInfo = {}) => {
  try {
    // Priority order: explicit duration > calculated from start/end > fallback calculation
    if (meetingInfo.duration && typeof meetingInfo.duration === 'number') {
      return meetingInfo.duration;
    }
    
    if (meetingInfo.startTime && meetingInfo.endTime) {
      return calculateMeetingDuration(meetingInfo.startTime, meetingInfo.endTime);
    }
    
    if (meetingInfo.started_at && meetingInfo.ended_at) {
      return calculateMeetingDuration(meetingInfo.started_at, meetingInfo.ended_at);
    }
    
    // Fallback: if we only have start time, assume meeting is ongoing
    if (meetingInfo.startTime || meetingInfo.started_at) {
      return calculateMeetingDuration(meetingInfo.startTime || meetingInfo.started_at, null);
    }
    
    return 0;
  } catch (error) {
    console.error('Error calculating meeting duration from info:', error);
    return 0;
  }
};

/**
 * Calculate meeting duration from start and end times
 * @param {string|Date} startTime - Meeting start time
 * @param {string|Date} endTime - Meeting end time (optional, uses current time if not provided)
 * @returns {number} Duration in minutes
 */
const calculateMeetingDuration = (startTime, endTime = null) => {
  try {
    const start = new Date(startTime);
    const end = endTime ? new Date(endTime) : new Date();
    
    if (isNaN(start.getTime())) return 0;
    if (endTime && isNaN(end.getTime())) return 0;
    
    const durationMs = end.getTime() - start.getTime();
    return Math.max(Math.round(durationMs / (1000 * 60)), 0); // Convert to minutes
  } catch (error) {
    console.error('Error calculating meeting duration:', error);
    return 0;
  }
};

/**
 * Calculate session-based attendance percentage
 * @param {number} totalSessionDuration - Total duration across all participant sessions
 * @param {number} meetingDuration - Total meeting duration
 * @param {boolean} hasActiveSessions - Whether participant has any active sessions
 * @returns {number} Attendance percentage (0-100)
 */
const calculateSessionBasedAttendancePercentage = (totalSessionDuration, meetingDuration, hasActiveSessions = false) => {
  // Handle edge cases
  if (!totalSessionDuration && !hasActiveSessions) return 0;
  if (!meetingDuration || meetingDuration <= 0) return hasActiveSessions ? 100 : 0;
  
  // If participant has active sessions but no recorded duration yet, return 100%
  if (hasActiveSessions && (!totalSessionDuration || totalSessionDuration <= 0)) {
    return 100;
  }
  
  // Calculate percentage, cap at 100%
  const percentage = Math.min(Math.round((totalSessionDuration / meetingDuration) * 100), 100);
  
  return Math.max(percentage, 0);
};

/**
 * Determine attendance status based on session-based percentage and threshold
 * @param {number} attendancePercentage - Session-based attendance percentage (0-100)
 * @param {boolean} hasActiveSessions - Whether participant has any active sessions
 * @param {number} totalDuration - Total session duration in minutes
 * @param {number} threshold - Attendance threshold percentage (default 85%)
 * @returns {string} Status: 'Present', 'In Progress', 'Absent'
 */
const determineSessionBasedAttendanceStatus = (attendancePercentage, hasActiveSessions = false, totalDuration = 0, threshold = 85) => {
  // If currently active (in meeting)
  if (hasActiveSessions) {
    return 'In Progress';
  }
  
  // If no duration recorded, consider absent
  if (!totalDuration || totalDuration <= 0) {
    return 'Absent';
  }
  
  // Apply threshold-based determination
  if (attendancePercentage >= threshold) {
    return 'Present';
  } else {
    return 'Absent';
  }
};

/**
 * Process participant sessions and calculate comprehensive attendance data
 * @param {Object} participant - Participant data with sessions
 * @param {Object} meetingInfo - Meeting information
 * @param {number} attendanceThreshold - Attendance threshold percentage (default 85%)
 * @returns {Object} Enhanced participant data with session-based calculations
 */
const calculateSessionBasedParticipantAttendance = (participant, meetingInfo = {}, attendanceThreshold = 85) => {
  try {
    // Extract sessions from participant data
    let sessions = [];
    
    if (participant.sessions && Array.isArray(participant.sessions)) {
      // Use provided sessions array
      sessions = participant.sessions;
    } else if (participant.joinTime || participant.join_time) {
      // Create single session from join/leave times
      sessions = [{
        joinTime: participant.joinTime || participant.join_time,
        leaveTime: participant.leaveTime || participant.leave_time,
        isActive: participant.isActive
      }];
    }
    
    // Calculate total session duration
    const totalSessionDuration = calculateTotalSessionDuration(sessions);
    
    // Calculate meeting duration
    const meetingDuration = calculateMeetingDurationFromInfo(meetingInfo);
    
    // Check if participant has any active sessions
    const hasActiveSessions = sessions.some(session => 
      session.isActive || (!session.leaveTime && !session.leave_time)
    );
    
    // Calculate session-based attendance percentage
    const attendancePercentage = calculateSessionBasedAttendancePercentage(
      totalSessionDuration, 
      meetingDuration, 
      hasActiveSessions
    );
    
    // Determine attendance status
    const attendanceStatus = determineSessionBasedAttendanceStatus(
      attendancePercentage, 
      hasActiveSessions, 
      totalSessionDuration,
      attendanceThreshold
    );
    
    return {
      ...participant,
      sessions,
      totalSessionDuration,
      duration: totalSessionDuration, // Backward compatibility
      attendancePercentage,
      attendanceStatus,
      isActive: hasActiveSessions,
      meetingDuration,
      sessionCount: sessions.length
    };
  } catch (error) {
    console.error('Error calculating session-based participant attendance:', error);
    
    // Return original participant with default values
    return {
      ...participant,
      sessions: [],
      totalSessionDuration: 0,
      duration: 0,
      attendancePercentage: 0,
      attendanceStatus: 'Unknown',
      isActive: false,
      meetingDuration: 0,
      sessionCount: 0
    };
  }
};

/**
 * Get attendance status color (for backend logging/reporting)
 * @param {string} status - Attendance status
 * @returns {string} Color name
 */
const getAttendanceStatusColor = (status) => {
  switch (status?.toLowerCase()) {
    case 'present':
      return 'green';
    case 'in progress':
      return 'blue';
    case 'absent':
      return 'red';
    default:
      return 'gray';
  }
};

/**
 * Format attendance percentage for display
 * @param {number} percentage - Percentage value
 * @returns {string} Formatted percentage string
 */
const formatAttendancePercentage = (percentage) => {
  if (typeof percentage !== 'number' || isNaN(percentage)) {
    return '0%';
  }
  return `${Math.round(percentage)}%`;
};

/**
 * Calculate attendance statistics for a meeting based on participants array
 * @param {Array} participants - Array of participant data with attendance info
 * @returns {Object} Attendance statistics
 */
const calculateMeetingAttendanceStats = (participants = []) => {
  try {
    const total = participants.length;
    
    if (total === 0) {
      return {
        total: 0,
        present: 0,
        absent: 0,
        inProgress: 0,
        averagePercentage: 0,
        threshold: 85
      };
    }
    
    let present = 0;
    let absent = 0;
    let inProgress = 0;
    let totalPercentage = 0;
    
    participants.forEach(participant => {
      const status = participant.attendanceStatus?.toLowerCase();
      const percentage = participant.attendancePercentage || 0;
      
      totalPercentage += percentage;
      
      switch (status) {
        case 'present':
          present++;
          break;
        case 'in progress':
          inProgress++;
          break;
        default:
          absent++;
          break;
      }
    });
    
    return {
      total,
      present,
      absent,
      inProgress,
      averagePercentage: Math.round(totalPercentage / total),
      presentPercentage: Math.round((present / total) * 100),
      absentPercentage: Math.round((absent / total) * 100),
      inProgressPercentage: Math.round((inProgress / total) * 100)
    };
  } catch (error) {
    console.error('Error calculating meeting attendance stats:', error);
    return {
      total: 0,
      present: 0,
      absent: 0,
      inProgress: 0,
      averagePercentage: 0,
      presentPercentage: 0,
      absentPercentage: 0,
      inProgressPercentage: 0
    };
  }
};

/**
 * Validate session data
 * @param {Object} sessionData - Session data to validate
 * @returns {Object} Validation result
 */
const validateSessionData = (sessionData) => {
  const errors = [];
  
  if (!sessionData.participantId) {
    errors.push('participantId is required');
  }
  
  if (!sessionData.meetingId) {
    errors.push('meetingId is required');
  }
  
  if (!sessionData.joinTime) {
    errors.push('joinTime is required');
  } else {
    const joinTime = new Date(sessionData.joinTime);
    if (isNaN(joinTime.getTime())) {
      errors.push('joinTime must be a valid date');
    }
  }
  
  if (sessionData.leaveTime) {
    const leaveTime = new Date(sessionData.leaveTime);
    if (isNaN(leaveTime.getTime())) {
      errors.push('leaveTime must be a valid date');
    } else if (sessionData.joinTime) {
      const joinTime = new Date(sessionData.joinTime);
      if (leaveTime <= joinTime) {
        errors.push('leaveTime must be after joinTime');
      }
    }
  }
  
  return {
    isValid: errors.length === 0,
    errors
  };
};

module.exports = {
  calculateSessionDuration,
  calculateTotalSessionDuration,
  calculateMeetingDurationFromInfo,
  calculateMeetingDuration,
  calculateSessionBasedAttendancePercentage,
  determineSessionBasedAttendanceStatus,
  calculateSessionBasedParticipantAttendance,
  getAttendanceStatusColor,
  formatAttendancePercentage,
  calculateMeetingAttendanceStats,
  validateSessionData
};
