// Simple Rate Limiter without external dependencies for temporary use
class ZoomApiRateLimiter {
  constructor() {
    // Simple cache implementation
    this.tokenCache = new Map();
    this.responseCache = new Map();
    this.lastTokenRequest = 0;
    this.lastApiCall = 0;
    
    // Track API call statistics
    this.stats = {
      totalCalls: 0,
      rateLimitedCalls: 0,
      cachedResponses: 0,
      errors: 0,
      lastReset: new Date()
    };
    
    // Clean up cache periodically
    setInterval(() => this.cleanupCache(), 300000); // Clean every 5 minutes
  }
  
  cleanupCache() {
    const now = Date.now();
    // Remove expired token cache entries (older than 55 minutes)
    for (const [key, value] of this.tokenCache.entries()) {
      if (now - value.timestamp > 3300000) {
        this.tokenCache.delete(key);
      }
    }
    // Remove expired response cache entries (older than 5 minutes)
    for (const [key, value] of this.responseCache.entries()) {
      if (now - value.timestamp > 300000) {
        this.responseCache.delete(key);
      }
    }
  }

  /**
   * Execute an API call with rate limiting
   * @param {Function} apiCall - The API call function
   * @param {string} endpoint - The endpoint being called (for caching)
   * @param {Object} options - Options for the request
   * @returns {Promise} - The API response
   */
  async executeApiCall(apiCall, endpoint, options = {}) {
    const { 
      cacheKey, 
      cacheTTL = 300, 
      isReportsCall = false, 
      retryCount = 3,
      enableCache = true 
    } = options;
    
    // Check cache first
    if (enableCache && cacheKey) {
      const cachedResponse = this.responseCache.get(cacheKey);
      if (cachedResponse && (Date.now() - cachedResponse.timestamp < cacheTTL * 1000)) {
        this.stats.cachedResponses++;
        console.log(`📦 Cache hit for ${endpoint}`);
        return cachedResponse.data;
      }
    }
    
    // Simple rate limiting - wait between calls
    const now = Date.now();
    const minInterval = isReportsCall ? 1000 : 100; // 1s for reports, 100ms for API
    const timeSinceLastCall = now - this.lastApiCall;
    
    if (timeSinceLastCall < minInterval) {
      await this.sleep(minInterval - timeSinceLastCall);
    }
    
    this.lastApiCall = Date.now();
    
    try {
      const result = await this.executeWithRetry(apiCall, retryCount, endpoint);
      
      // Cache successful responses
      if (enableCache && cacheKey && result) {
        this.responseCache.set(cacheKey, { data: result, timestamp: Date.now() });
        console.log(`💾 Cached response for ${endpoint}`);
      }
      
      this.stats.totalCalls++;
      return result;
      
    } catch (error) {
      this.stats.errors++;
      console.error(`❌ API call failed for ${endpoint}:`, error.message);
      throw error;
    }
  }

  /**
   * Execute API call with exponential backoff retry
   * @param {Function} apiCall - The API call function
   * @param {number} maxRetries - Maximum number of retries
   * @param {string} endpoint - Endpoint name for logging
   * @returns {Promise} - The API response
   */
  async executeWithRetry(apiCall, maxRetries, endpoint) {
    let lastError;
    
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        const result = await apiCall();
        
        if (attempt > 0) {
          console.log(`✅ API call succeeded on attempt ${attempt + 1} for ${endpoint}`);
        }
        
        return result;
        
      } catch (error) {
        lastError = error;
        
        // Check if it's a rate limit error
        if (error.response?.status === 429) {
          this.stats.rateLimitedCalls++;
          
          const retryAfter = error.response.headers['retry-after'];
          const backoffDelay = retryAfter 
            ? parseInt(retryAfter) * 1000 
            : Math.min(1000 * Math.pow(2, attempt), 30000); // Exponential backoff, max 30s
          
          console.warn(`🚦 Rate limited on ${endpoint}, attempt ${attempt + 1}/${maxRetries + 1}. Waiting ${backoffDelay}ms`);
          
          if (attempt < maxRetries) {
            await this.sleep(backoffDelay);
            continue;
          }
        }
        
        // For non-rate-limit errors, only retry network errors
        if (attempt < maxRetries && this.isRetryableError(error)) {
          const backoffDelay = Math.min(500 * Math.pow(2, attempt), 5000); // Faster backoff for network errors
          console.warn(`🔄 Retrying ${endpoint} after ${backoffDelay}ms (attempt ${attempt + 1}/${maxRetries + 1})`);
          await this.sleep(backoffDelay);
          continue;
        }
        
        // No more retries
        break;
      }
    }
    
    throw lastError;
  }

  /**
   * Get or cache access token with rate limiting
   * @param {Function} tokenGenerator - Function to generate new token
   * @returns {Promise<string>} - Access token
   */
  async getAccessToken(tokenGenerator) {
    // Check cache first
    const cachedToken = this.tokenCache.get('zoom_access_token');
    if (cachedToken && (Date.now() - cachedToken.timestamp < 3300000)) {
      console.log('🎟️ Using cached access token');
      return cachedToken.token;
    }
    
    // Simple rate limiting for token requests (minimum 1 minute between requests)
    const now = Date.now();
    const timeSinceLastToken = now - this.lastTokenRequest;
    if (timeSinceLastToken < 60000) {
      await this.sleep(60000 - timeSinceLastToken);
    }
    
    this.lastTokenRequest = Date.now();
    
    // Generate new token
    try {
      console.log('🔄 Generating new access token...');
      const token = await tokenGenerator();
      
      // Cache the token
      this.tokenCache.set('zoom_access_token', { token, timestamp: Date.now() });
      console.log('✅ New access token generated and cached');
      
      return token;
      
    } catch (error) {
      console.error('❌ Failed to generate access token:', error.message);
      throw error;
    }
  }

  /**
   * Check if error is retryable
   * @param {Error} error - The error to check
   * @returns {boolean} - Whether the error is retryable
   */
  isRetryableError(error) {
    // Retry on network errors, timeouts, and some server errors
    const retryableErrors = [
      'ECONNRESET',
      'ETIMEDOUT',
      'ENOTFOUND',
      'ECONNREFUSED'
    ];
    
    const retryableStatusCodes = [408, 429, 500, 502, 503, 504];
    
    return (
      retryableErrors.includes(error.code) ||
      retryableStatusCodes.includes(error.response?.status) ||
      error.message.includes('timeout')
    );
  }

  /**
   * Sleep for specified milliseconds
   * @param {number} ms - Milliseconds to sleep
   * @returns {Promise} - Promise that resolves after sleep
   */
  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Get current statistics
   * @returns {Object} - Rate limiter statistics
   */
  getStats() {
    return {
      ...this.stats,
      cacheStats: {
        tokens: this.tokenCache.size,
        responses: this.responseCache.size
      }
    };
  }

  /**
   * Reset statistics
   */
  resetStats() {
    this.stats = {
      totalCalls: 0,
      rateLimitedCalls: 0,
      cachedResponses: 0,
      errors: 0,
      lastReset: new Date()
    };
  }

  /**
   * Clear all caches
   */
  clearCaches() {
    this.tokenCache.clear();
    this.responseCache.clear();
    console.log('🧹 All caches cleared');
  }
}

// Export singleton instance
const rateLimiter = new ZoomApiRateLimiter();
module.exports = rateLimiter;
