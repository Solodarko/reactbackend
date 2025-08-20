const jwt = require('jsonwebtoken');

class TokenDebugger {
  /**
   * Debug a JWT token by extracting its information
   * @param {string} token - The JWT token to debug
   * @returns {Promise<Object>} Debug information about the token
   */
  static async debugToken(token) {
    const debugInfo = {
      token: token,
      tokenLength: token ? token.length : 0,
      tokenPresent: !!token,
      startsWithBearer: token ? token.startsWith('Bearer ') : false,
      tokenFirst20Chars: token ? token.substring(0, 20) + '...' : null,
      decoded: null,
      isValid: false,
      error: null,
      timestamp: new Date().toISOString()
    };

    if (!token) {
      debugInfo.error = 'No token provided';
      return debugInfo;
    }

    try {
      // Try to decode without verification first (to see the payload even if expired)
      const decodedWithoutVerification = jwt.decode(token, { complete: true });
      
      if (decodedWithoutVerification) {
        debugInfo.decoded = {
          header: decodedWithoutVerification.header,
          payload: decodedWithoutVerification.payload,
          signature: decodedWithoutVerification.signature ? 'present' : 'missing'
        };

        // Check if token is expired
        if (decodedWithoutVerification.payload.exp) {
          const now = Math.floor(Date.now() / 1000);
          debugInfo.isExpired = now >= decodedWithoutVerification.payload.exp;
          debugInfo.expiresAt = new Date(decodedWithoutVerification.payload.exp * 1000).toISOString();
        }

        // Check if token is issued in the future
        if (decodedWithoutVerification.payload.iat) {
          const now = Math.floor(Date.now() / 1000);
          debugInfo.issuedInFuture = decodedWithoutVerification.payload.iat > now;
          debugInfo.issuedAt = new Date(decodedWithoutVerification.payload.iat * 1000).toISOString();
        }
      }

      // Now try to verify with secret
      if (process.env.JWT_SECRET) {
        const verified = jwt.verify(token, process.env.JWT_SECRET);
        debugInfo.isValid = true;
        debugInfo.verifiedPayload = verified;
      } else {
        debugInfo.error = 'JWT_SECRET not found in environment variables';
      }

    } catch (error) {
      debugInfo.error = {
        name: error.name,
        message: error.message,
        code: error.code
      };
      
      // Still try to decode without verification to get info
      try {
        const decodedWithoutVerification = jwt.decode(token, { complete: true });
        if (decodedWithoutVerification) {
          debugInfo.decoded = {
            header: decodedWithoutVerification.header,
            payload: decodedWithoutVerification.payload
          };
        }
      } catch (decodeError) {
        debugInfo.error.decodeError = decodeError.message;
      }
    }

    return debugInfo;
  }

  /**
   * Log debug information about a token
   * @param {Object} debugInfo - Debug information from debugToken()
   */
  static logDebugInfo(debugInfo) {
    console.log('🔍 ===== TOKEN DEBUGGER =====');
    console.log('📅 Timestamp:', debugInfo.timestamp);
    console.log('🎫 Token present:', debugInfo.tokenPresent);
    
    if (debugInfo.tokenPresent) {
      console.log('📏 Token length:', debugInfo.tokenLength);
      console.log('🏷️  Starts with Bearer:', debugInfo.startsWithBearer);
      console.log('🔤 First 20 chars:', debugInfo.tokenFirst20Chars);
    }

    if (debugInfo.decoded) {
      console.log('📦 Token Structure:');
      console.log('  📋 Header:', debugInfo.decoded.header);
      console.log('  📄 Payload:', debugInfo.decoded.payload);
      
      if (debugInfo.issuedAt) {
        console.log('  ⏰ Issued at:', debugInfo.issuedAt);
        console.log('  🔮 Issued in future:', debugInfo.issuedInFuture);
      }
      
      if (debugInfo.expiresAt) {
        console.log('  ⏳ Expires at:', debugInfo.expiresAt);
        console.log('  💀 Is expired:', debugInfo.isExpired);
      }
    }

    console.log('✅ Token valid:', debugInfo.isValid);
    
    if (debugInfo.error) {
      console.log('❌ Error:', debugInfo.error);
    }

    if (debugInfo.verifiedPayload) {
      console.log('🔐 Verified payload:', debugInfo.verifiedPayload);
    }
    
    console.log('🔍 ===== END TOKEN DEBUG =====\n');
  }

  /**
   * Quick token validation check
   * @param {string} token - The JWT token to validate
   * @returns {boolean} Whether the token is valid
   */
  static async isValidToken(token) {
    if (!token || !process.env.JWT_SECRET) {
      return false;
    }

    try {
      jwt.verify(token, process.env.JWT_SECRET);
      return true;
    } catch (error) {
      return false;
    }
  }
}

module.exports = TokenDebugger;
