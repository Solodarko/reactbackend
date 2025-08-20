/**
 * Date Utility Functions with Safe Error Handling
 * Prevents "Invalid Date" errors throughout the application
 */

/**
 * Safely create a Date object with validation
 * @param {string|Date|number} dateInput - Date input to validate
 * @returns {Date|null} Valid Date object or null if invalid
 */
const safeCreateDate = (dateInput) => {
  if (!dateInput) return null;
  
  try {
    let date;
    
    // Handle different input types
    if (dateInput instanceof Date) {
      date = dateInput;
    } else if (typeof dateInput === 'string') {
      // Handle common invalid string formats
      if (dateInput.toLowerCase() === 'invalid date' || 
          dateInput.trim() === '' || 
          dateInput === 'null' || 
          dateInput === 'undefined') {
        return null;
      }
      date = new Date(dateInput);
    } else if (typeof dateInput === 'number') {
      date = new Date(dateInput);
    } else {
      return null;
    }
    
    // Check if the date is valid
    if (isNaN(date.getTime())) {
      console.warn(`⚠️ Invalid date input: ${dateInput}`);
      return null;
    }
    
    return date;
  } catch (error) {
    console.error('❌ Error creating date:', error.message, 'Input:', dateInput);
    return null;
  }
};

/**
 * Safe date formatting with fallback options
 * @param {string|Date|number} dateInput - Date to format
 * @param {string} fallback - Fallback string if date is invalid (default: 'N/A')
 * @param {Object} options - Formatting options
 * @returns {string} Formatted date string or fallback
 */
const safeDateFormat = (dateInput, fallback = 'N/A', options = {}) => {
  try {
    const date = safeCreateDate(dateInput);
    if (!date) return fallback;
    
    const {
      locale = 'en-US',
      timeZone = 'UTC',
      format = 'full' // 'full', 'date', 'time', 'datetime', 'iso'
    } = options;
    
    switch (format) {
      case 'iso':
        return date.toISOString();
      case 'date':
        return date.toLocaleDateString(locale, { timeZone });
      case 'time':
        return date.toLocaleTimeString(locale, { timeZone });
      case 'datetime':
        return date.toLocaleString(locale, { timeZone });
      case 'full':
      default:
        return date.toLocaleString(locale, {
          timeZone,
          year: 'numeric',
          month: '2-digit',
          day: '2-digit',
          hour: '2-digit',
          minute: '2-digit',
          second: '2-digit'
        });
    }
  } catch (error) {
    console.error('❌ Error formatting date:', error.message, 'Input:', dateInput);
    return fallback;
  }
};

/**
 * Safely format date for display in tables/UI
 * @param {string|Date|number} dateInput - Date to format
 * @param {string} fallback - Fallback string
 * @returns {string} User-friendly formatted date
 */
const formatDateForDisplay = (dateInput, fallback = '-') => {
  return safeDateFormat(dateInput, fallback, {
    format: 'datetime',
    locale: 'en-US'
  });
};

/**
 * Safely format time only
 * @param {string|Date|number} dateInput - Date to format
 * @param {string} fallback - Fallback string
 * @returns {string} Formatted time string
 */
const formatTimeForDisplay = (dateInput, fallback = '-') => {
  return safeDateFormat(dateInput, fallback, {
    format: 'time',
    locale: 'en-US'
  });
};

/**
 * Calculate duration between two dates safely
 * @param {string|Date|number} startDate - Start date
 * @param {string|Date|number} endDate - End date (optional, uses current time)
 * @returns {number} Duration in minutes, or 0 if invalid
 */
const safeDateDuration = (startDate, endDate = null) => {
  try {
    const start = safeCreateDate(startDate);
    if (!start) return 0;
    
    const end = endDate ? safeCreateDate(endDate) : new Date();
    if (!end) return 0;
    
    const durationMs = end.getTime() - start.getTime();
    return Math.max(Math.round(durationMs / (1000 * 60)), 0);
  } catch (error) {
    console.error('❌ Error calculating date duration:', error.message);
    return 0;
  }
};

/**
 * Check if a date is valid
 * @param {any} dateInput - Input to check
 * @returns {boolean} True if valid date
 */
const isValidDate = (dateInput) => {
  const date = safeCreateDate(dateInput);
  return date !== null;
};

/**
 * Safe date comparison
 * @param {string|Date|number} date1 - First date
 * @param {string|Date|number} date2 - Second date
 * @returns {number} -1 if date1 < date2, 0 if equal, 1 if date1 > date2, null if invalid
 */
const safeDateCompare = (date1, date2) => {
  try {
    const d1 = safeCreateDate(date1);
    const d2 = safeCreateDate(date2);
    
    if (!d1 || !d2) return null;
    
    const time1 = d1.getTime();
    const time2 = d2.getTime();
    
    if (time1 < time2) return -1;
    if (time1 > time2) return 1;
    return 0;
  } catch (error) {
    console.error('❌ Error comparing dates:', error.message);
    return null;
  }
};

/**
 * Get current timestamp safely
 * @returns {Date} Current date
 */
const getCurrentTimestamp = () => {
  return new Date();
};

/**
 * Parse various date formats safely
 * @param {any} input - Input to parse
 * @returns {Date|null} Parsed date or null
 */
const parseDate = (input) => {
  if (!input) return null;
  
  try {
    // Handle different input formats
    if (typeof input === 'string') {
      // Remove extra whitespace
      input = input.trim();
      
      // Handle common problematic formats
      if (input.match(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{3})?Z?$/)) {
        // ISO format
        return safeCreateDate(input);
      }
      
      if (input.match(/^\d{2}\/\d{2}\/\d{4}$/)) {
        // MM/DD/YYYY format
        return safeCreateDate(input);
      }
      
      if (input.match(/^\d{4}-\d{2}-\d{2}$/)) {
        // YYYY-MM-DD format
        return safeCreateDate(input);
      }
    }
    
    // Fall back to safe creation
    return safeCreateDate(input);
  } catch (error) {
    console.error('❌ Error parsing date:', error.message, 'Input:', input);
    return null;
  }
};

/**
 * Format date for MongoDB queries
 * @param {any} dateInput - Date input
 * @returns {Date|null} MongoDB-compatible date
 */
const formatForMongoDB = (dateInput) => {
  const date = safeCreateDate(dateInput);
  return date;
};

/**
 * Create a date range safely
 * @param {any} startInput - Start date input
 * @param {any} endInput - End date input
 * @returns {Object} Object with start and end dates
 */
const createDateRange = (startInput, endInput = null) => {
  const start = safeCreateDate(startInput);
  const end = endInput ? safeCreateDate(endInput) : new Date();
  
  return {
    start: start,
    end: end,
    isValid: start !== null && end !== null
  };
};

/**
 * Ensure date fields in objects are properly formatted
 * @param {Object} obj - Object with potential date fields
 * @param {Array} dateFields - Array of field names that should be dates
 * @returns {Object} Object with safely formatted dates
 */
const sanitizeDateFields = (obj, dateFields = ['joinTime', 'leaveTime', 'createdAt', 'updatedAt', 'startTime', 'endTime']) => {
  if (!obj || typeof obj !== 'object') return obj;
  
  const sanitized = { ...obj };
  
  dateFields.forEach(field => {
    if (sanitized[field]) {
      const safeDate = safeCreateDate(sanitized[field]);
      sanitized[field] = safeDate;
    }
  });
  
  return sanitized;
};

module.exports = {
  safeCreateDate,
  safeDateFormat,
  formatDateForDisplay,
  formatTimeForDisplay,
  safeDateDuration,
  isValidDate,
  safeDateCompare,
  getCurrentTimestamp,
  parseDate,
  formatForMongoDB,
  createDateRange,
  sanitizeDateFields
};
