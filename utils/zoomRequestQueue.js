/**
 * ZoomRequestQueue - Manages a queue of Zoom API requests to prevent rate limiting
 * 
 * This class provides a queue-based approach to handling Zoom API requests,
 * ensuring that requests are processed in a controlled manner to avoid hitting rate limits.
 */

const rateLimiter = require('./rateLimiter');

class ZoomRequestQueue {
  constructor(options = {}) {
    this.queue = [];
    this.isProcessing = false;
    this.concurrentLimit = options.concurrentLimit || 1;
    this.activeRequests = 0;
    this.defaultTimeout = options.defaultTimeout || 15000;
    this.defaultRetryCount = options.defaultRetryCount || 3;
    this.defaultPriority = 5; // Medium priority (1-10 scale, 1 being highest)
    
    // Categories for different rate limits
    this.categoryIntervals = {
      // Per-user limits
      meeting: 1000,      // 1 request per second
      report: 2000,       // 1 request per 2 seconds
      webinar: 1000,      // 1 request per second
      user: 1000,         // 1 request per second
      default: 500        // Default interval between requests
    };
    
    // Track last request time by category
    this.lastRequestTime = {
      meeting: 0,
      report: 0,
      webinar: 0,
      user: 0,
      default: 0
    };
    
    this.stats = {
      totalQueued: 0,
      totalProcessed: 0,
      totalErrors: 0,
      avgWaitTime: 0,
      totalWaitTime: 0,
      maxQueueLength: 0,
      rateLimitedRequests: 0,
      lastReset: new Date()
    };
    
    // Process queue periodically
    setInterval(() => {
      if (this.queue.length > 0 && !this.isProcessing) {
        this.processQueue();
      }
    }, 200);
  }
  
  /**
   * Add a request to the queue
   * @param {Function} requestFn - Function that returns a promise (the API call)
   * @param {Object} options - Request options
   * @returns {Promise} - Promise that resolves with the API response
   */
  async enqueue(requestFn, options = {}) {
    const {
      category = 'default',
      priority = this.defaultPriority,
      timeout = this.defaultTimeout,
      retryCount = this.defaultRetryCount,
      skipQueue = false,
      cacheKey = null,
      cacheTTL = 300, // 5 minutes
      isReportsCall = category === 'report',
      enableCache = true,
      identifier = `req-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`
    } = options;
    
    // Update stats
    this.stats.totalQueued++;
    this.stats.maxQueueLength = Math.max(this.stats.maxQueueLength, this.queue.length + 1);
    
    // If cache is enabled and we have a cache key, check the cache first
    if (enableCache && cacheKey) {
      try {
        // Use the rateLimiter's cache
        const cachedResult = await this.checkCache(cacheKey, cacheTTL);
        if (cachedResult) {
          return cachedResult;
        }
      } catch (error) {
        console.warn(`Cache check failed for ${identifier}:`, error.message);
      }
    }
    
    // Skip queue for high priority or if requested
    if (skipQueue || priority === 1) {
      try {
        // Still respect rate limits
        await this.waitForRateLimit(category);
        
        // Execute directly
        const result = await this.executeRequest(requestFn, {
          category,
          timeout,
          retryCount,
          cacheKey,
          cacheTTL,
          isReportsCall,
          enableCache,
          identifier
        });
        
        this.stats.totalProcessed++;
        return result;
      } catch (error) {
        this.stats.totalErrors++;
        throw error;
      }
    }
    
    // Create promise to return to caller
    return new Promise((resolve, reject) => {
      // Queue time tracking
      const queuedAt = Date.now();
      
      // Add to queue
      this.queue.push({
        requestFn,
        category,
        priority,
        timeout,
        retryCount,
        cacheKey,
        cacheTTL,
        isReportsCall,
        enableCache,
        identifier,
        queuedAt,
        resolve,
        reject
      });
      
      // Sort queue by priority
      this.queue.sort((a, b) => a.priority - b.priority);
      
      // Start processing if not already processing
      if (!this.isProcessing && this.activeRequests < this.concurrentLimit) {
        this.processQueue();
      }
      
      // Log queue status
      console.log(`📋 Request queued (${identifier}): ${this.queue.length} items in queue, ${this.activeRequests} active`);
    });
  }
  
  /**
   * Process the next items in the queue
   */
  async processQueue() {
    // If already processing or queue empty, do nothing
    if (this.isProcessing || this.queue.length === 0 || this.activeRequests >= this.concurrentLimit) {
      return;
    }
    
    this.isProcessing = true;
    
    try {
      // Process up to concurrentLimit requests at once
      const availableSlots = this.concurrentLimit - this.activeRequests;
      const itemsToProcess = Math.min(availableSlots, this.queue.length);
      
      if (itemsToProcess <= 0) {
        this.isProcessing = false;
        return;
      }
      
      // Process multiple items concurrently
      const processingItems = [];
      
      for (let i = 0; i < itemsToProcess; i++) {
        const item = this.queue.shift();
        if (item) {
          processingItems.push(this.processItem(item));
        }
      }
      
      // Wait for all to complete
      await Promise.all(processingItems);
      
    } catch (error) {
      console.error('Queue processing error:', error);
    } finally {
      this.isProcessing = false;
      
      // If there are more items and slots available, continue processing
      if (this.queue.length > 0 && this.activeRequests < this.concurrentLimit) {
        setImmediate(() => this.processQueue());
      }
    }
  }
  
  /**
   * Process a single queue item
   * @param {Object} item - Queue item
   */
  async processItem(item) {
    const {
      requestFn,
      category,
      timeout,
      retryCount,
      cacheKey,
      cacheTTL,
      isReportsCall,
      enableCache,
      identifier,
      queuedAt,
      resolve,
      reject
    } = item;
    
    this.activeRequests++;
    
    try {
      // Calculate wait time
      const waitTime = Date.now() - queuedAt;
      this.stats.totalWaitTime += waitTime;
      this.stats.avgWaitTime = this.stats.totalWaitTime / this.stats.totalProcessed;
      
      console.log(`⏳ Processing queued request (${identifier}): waited ${waitTime}ms`);
      
      // Wait for rate limit
      await this.waitForRateLimit(category);
      
      // Execute the request
      const result = await this.executeRequest(requestFn, {
        category,
        timeout,
        retryCount,
        cacheKey,
        cacheTTL,
        isReportsCall,
        enableCache,
        identifier
      });
      
      // Update stats
      this.stats.totalProcessed++;
      
      // Resolve the promise
      resolve(result);
      
    } catch (error) {
      // Update stats
      this.stats.totalErrors++;
      
      if (error.response?.status === 429) {
        this.stats.rateLimitedRequests++;
      }
      
      // Reject the promise
      reject(error);
      
    } finally {
      this.activeRequests--;
      
      // Try to process more from queue
      if (this.queue.length > 0 && !this.isProcessing && this.activeRequests < this.concurrentLimit) {
        setImmediate(() => this.processQueue());
      }
    }
  }
  
  /**
   * Wait for rate limit to expire
   * @param {string} category - API category
   * @returns {Promise} - Promise that resolves when it's safe to make the request
   */
  async waitForRateLimit(category) {
    const now = Date.now();
    const interval = this.categoryIntervals[category] || this.categoryIntervals.default;
    const lastRequest = this.lastRequestTime[category] || 0;
    const timeSinceLastRequest = now - lastRequest;
    
    if (timeSinceLastRequest < interval) {
      const delay = interval - timeSinceLastRequest;
      console.log(`⏱️ Rate limit wait for ${category}: ${delay}ms`);
      await new Promise(resolve => setTimeout(resolve, delay));
    }
    
    this.lastRequestTime[category] = Date.now();
  }
  
  /**
   * Execute the API request with timeout and retries
   * @param {Function} requestFn - Function that returns a promise (the API call)
   * @param {Object} options - Request options
   * @returns {Promise} - Promise that resolves with the API response
   */
  async executeRequest(requestFn, options) {
    const {
      category,
      timeout,
      retryCount,
      cacheKey,
      cacheTTL,
      isReportsCall,
      enableCache,
      identifier
    } = options;
    
    // Execute with rateLimiter to get additional retries and backoff
    try {
      const result = await rateLimiter.executeApiCall(
        requestFn,
        `${category}-${identifier}`,
        {
          cacheKey,
          cacheTTL,
          isReportsCall,
          retryCount,
          enableCache
        }
      );
      
      // Store in cache if enabled
      if (enableCache && cacheKey && result) {
        this.cacheResult(cacheKey, result, cacheTTL);
      }
      
      return result;
    } catch (error) {
      console.error(`❌ Request failed (${identifier}):`, error.message);
      throw error;
    }
  }
  
  /**
   * Check the cache for a result
   * @param {string} key - Cache key
   * @param {number} ttl - Time to live in seconds
   * @returns {Promise} - Promise that resolves with the cached result or null
   */
  async checkCache(key, ttl) {
    // This method uses the rateLimiter's cache
    try {
      const cachedResponse = rateLimiter.responseCache.get(key);
      if (cachedResponse && (Date.now() - cachedResponse.timestamp < ttl * 1000)) {
        console.log(`📦 Cache hit for ${key}`);
        return cachedResponse.data;
      }
    } catch (error) {
      console.warn(`Cache check error for ${key}:`, error);
    }
    return null;
  }
  
  /**
   * Cache a result
   * @param {string} key - Cache key
   * @param {*} result - Result to cache
   * @param {number} ttl - Time to live in seconds
   */
  cacheResult(key, result, ttl) {
    // This method uses the rateLimiter's cache
    try {
      rateLimiter.responseCache.set(key, {
        data: result,
        timestamp: Date.now(),
        ttl
      });
      console.log(`💾 Cached result for ${key} (${ttl}s)`);
    } catch (error) {
      console.warn(`Cache set error for ${key}:`, error);
    }
  }
  
  /**
   * Get queue statistics
   * @returns {Object} - Queue statistics
   */
  getStats() {
    return {
      ...this.stats,
      currentQueueLength: this.queue.length,
      activeRequests: this.activeRequests,
      timestamp: new Date().toISOString()
    };
  }
  
  /**
   * Reset queue statistics
   */
  resetStats() {
    this.stats = {
      totalQueued: 0,
      totalProcessed: 0,
      totalErrors: 0,
      avgWaitTime: 0,
      totalWaitTime: 0,
      maxQueueLength: 0,
      rateLimitedRequests: 0,
      lastReset: new Date()
    };
  }
  
  /**
   * Get current queue items
   * @returns {Array} - Array of queue items
   */
  getQueueItems() {
    return this.queue.map(item => ({
      category: item.category,
      priority: item.priority,
      identifier: item.identifier,
      queuedAt: item.queuedAt,
      waitTime: Date.now() - item.queuedAt
    }));
  }
}

// Export singleton instance
const zoomRequestQueue = new ZoomRequestQueue();
module.exports = zoomRequestQueue;
