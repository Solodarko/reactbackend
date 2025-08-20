/**
 * Location utilities for QR scanner coordinate handling
 * Handles GPS coordinates, distance calculations, and location validation
 */

/**
 * Convert coordinates from string format to decimal degrees
 * @param {string} coordinate - Coordinate in format like "5.29836N" or "2.00042W"
 * @returns {number} - Decimal degree coordinate
 */
function parseCoordinate(coordinate) {
  if (!coordinate) return null;
  
  const match = coordinate.match(/^(-?\d+\.?\d*)[NSEW]?$/i);
  if (!match) return null;
  
  let value = parseFloat(match[1]);
  const direction = coordinate.slice(-1).toUpperCase();
  
  // Convert to negative if South or West
  if (direction === 'S' || direction === 'W') {
    value = -Math.abs(value);
  }
  
  return value;
}

/**
 * Calculate distance between two GPS coordinates using Haversine formula
 * @param {number} lat1 - Latitude of first point
 * @param {number} lon1 - Longitude of first point
 * @param {number} lat2 - Latitude of second point
 * @param {number} lon2 - Longitude of second point
 * @returns {number} - Distance in meters
 */
function calculateDistance(lat1, lon1, lat2, lon2) {
  const R = 6371000; // Earth's radius in meters
  const φ1 = lat1 * Math.PI / 180;
  const φ2 = lat2 * Math.PI / 180;
  const Δφ = (lat2 - lat1) * Math.PI / 180;
  const Δλ = (lon2 - lon1) * Math.PI / 180;

  const a = Math.sin(Δφ / 2) * Math.sin(Δφ / 2) +
          Math.cos(φ1) * Math.cos(φ2) *
          Math.sin(Δλ / 2) * Math.sin(Δλ / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

  return R * c; // Distance in meters
}

/**
 * Validate GPS coordinates
 * @param {number} latitude - Latitude value
 * @param {number} longitude - Longitude value
 * @returns {object} - Validation result with isValid boolean and message
 */
function validateCoordinates(latitude, longitude) {
  const result = {
    isValid: true,
    message: 'Valid coordinates'
  };

  if (typeof latitude !== 'number' || typeof longitude !== 'number') {
    result.isValid = false;
    result.message = 'Coordinates must be numbers';
    return result;
  }

  if (latitude < -90 || latitude > 90) {
    result.isValid = false;
    result.message = 'Latitude must be between -90 and 90 degrees';
    return result;
  }

  if (longitude < -180 || longitude > 180) {
    result.isValid = false;
    result.message = 'Longitude must be between -180 and 180 degrees';
    return result;
  }

  return result;
}

/**
 * Format coordinates for display
 * @param {number} latitude - Latitude value
 * @param {number} longitude - Longitude value
 * @returns {object} - Formatted coordinates
 */
function formatCoordinates(latitude, longitude) {
  const latDirection = latitude >= 0 ? 'N' : 'S';
  const lonDirection = longitude >= 0 ? 'E' : 'W';
  
  return {
    latitude: `${Math.abs(latitude).toFixed(5)}${latDirection}`,
    longitude: `${Math.abs(longitude).toFixed(5)}${lonDirection}`,
    decimal: {
      latitude: latitude,
      longitude: longitude
    }
  };
}

/**
 * Check if location is within allowed radius
 * @param {object} scannerLocation - QR scanner location {lat, lng}
 * @param {object} userLocation - User's current location {lat, lng}
 * @param {number} maxDistance - Maximum allowed distance in meters
 * @returns {object} - Validation result with distance and isWithinRange
 */
function validateLocationProximity(scannerLocation, userLocation, maxDistance = 50) {
  const distance = calculateDistance(
    scannerLocation.lat,
    scannerLocation.lng,
    userLocation.lat,
    userLocation.lng
  );

  return {
    distance: Math.round(distance * 100) / 100, // Round to 2 decimal places
    maxDistance,
    isWithinRange: distance <= maxDistance,
    message: distance <= maxDistance 
      ? `Location verified - within ${distance.toFixed(2)}m of QR scanner`
      : `Location too far - ${distance.toFixed(2)}m from QR scanner (max: ${maxDistance}m)`
  };
}

/**
 * Create location metadata for attendance record
 * @param {object} qrScannerData - QR scanner data with coordinates and distance
 * @param {object} userLocation - User's location data (optional)
 * @returns {object} - Location metadata object
 */
function createLocationMetadata(qrScannerData, userLocation = null) {
  const metadata = {
    qrScanner: {
      coordinates: {
        latitude: qrScannerData.latitude || null,
        longitude: qrScannerData.longitude || null,
        formatted: qrScannerData.latitude && qrScannerData.longitude 
          ? formatCoordinates(qrScannerData.latitude, qrScannerData.longitude)
          : null
      },
      distance: qrScannerData.distance || null,
      timestamp: qrScannerData.timestamp || new Date().toISOString()
    },
    verification: {
      method: 'qr_scanner',
      status: 'verified',
      timestamp: new Date().toISOString()
    }
  };

  if (userLocation) {
    metadata.user = {
      coordinates: {
        latitude: userLocation.lat,
        longitude: userLocation.lng,
        formatted: formatCoordinates(userLocation.lat, userLocation.lng)
      },
      accuracy: userLocation.accuracy || null,
      timestamp: userLocation.timestamp || new Date().toISOString()
    };

    // Calculate proximity if both locations are available
    if (qrScannerData.latitude && qrScannerData.longitude) {
      const proximity = validateLocationProximity(
        { lat: qrScannerData.latitude, lng: qrScannerData.longitude },
        { lat: userLocation.lat, lng: userLocation.lng }
      );
      
      metadata.verification = {
        ...metadata.verification,
        proximity,
        status: proximity.isWithinRange ? 'verified' : 'location_mismatch'
      };
    }
  }

  return metadata;
}

module.exports = {
  parseCoordinate,
  calculateDistance,
  validateCoordinates,
  formatCoordinates,
  validateLocationProximity,
  createLocationMetadata
};
