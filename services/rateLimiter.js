const ErrorHandler = require('./errorHandler');

/**
 * Rate Limiter Service
 * Implements fixed 2-second delays between API calls to comply with Google Maps API rate limits
 * Requirements: 3.1, 6.1
 */

class RateLimiter {
    constructor() {
        this.defaultDelayMs = 1000; // Reduced to 1 second (Google allows up to 1000 requests per second)
        this.adaptiveDelay = 1000; // Start with 1 second
        this.minDelay = 500; // Minimum 0.5 seconds
        this.maxDelay = 3000; // Maximum 3 seconds
        this.consecutiveSuccesses = 0;
        this.consecutiveErrors = 0;
        this.errorHandler = new ErrorHandler();
        this.lastRequestTime = 0;
    }

    /**
     * Implements adaptive delay based on API response patterns
     * @param {number} ms - Delay in milliseconds (optional, uses adaptive delay if not provided)
     * @returns {Promise} - Resolves after the calculated delay
     */
    async delay(ms = null) {
        try {
            const delayTime = ms || this.getAdaptiveDelay();

            // Calculate time since last request
            const timeSinceLastRequest = Date.now() - this.lastRequestTime;
            const actualDelay = Math.max(0, delayTime - timeSinceLastRequest);

            if (actualDelay > 0) {
                this.errorHandler.logRateLimit(actualDelay, `Adaptive rate limiting delay (${this.consecutiveSuccesses} successes, ${this.consecutiveErrors} errors)`);
                await new Promise(resolve => setTimeout(resolve, actualDelay));
            } else {
                console.log(`⚡ No delay needed - ${timeSinceLastRequest}ms since last request`);
            }

            this.lastRequestTime = Date.now();
            return;
        } catch (error) {
            this.errorHandler.logAndContinue(error, {
                operation: 'delay',
                delayMs: ms || this.adaptiveDelay
            });
            // Even if logging fails, still apply the delay
            const fallbackDelay = ms || this.defaultDelayMs;
            await new Promise(resolve => setTimeout(resolve, fallbackDelay));
            this.lastRequestTime = Date.now();
        }
    }

    /**
     * Calculate adaptive delay based on recent API performance
     * @returns {number} Delay in milliseconds
     */
    getAdaptiveDelay() {
        // If we have consecutive successes, gradually reduce delay
        if (this.consecutiveSuccesses >= 5 && this.consecutiveErrors === 0) {
            this.adaptiveDelay = Math.max(this.minDelay, this.adaptiveDelay - 100);
        }
        // If we have errors, increase delay
        else if (this.consecutiveErrors >= 2) {
            this.adaptiveDelay = Math.min(this.maxDelay, this.adaptiveDelay + 500);
        }
        // Reset to default if mixed results
        else if (this.consecutiveSuccesses === 0 && this.consecutiveErrors === 0) {
            this.adaptiveDelay = this.defaultDelayMs;
        }

        return this.adaptiveDelay;
    }

    /**
     * Report API call success to adjust future delays
     */
    reportSuccess() {
        this.consecutiveSuccesses++;
        this.consecutiveErrors = 0;

        if (this.consecutiveSuccesses % 10 === 0) {
            // Removed success log to reduce console spam
            // console.log(`🚀 ${this.consecutiveSuccesses} consecutive API successes - current delay: ${this.adaptiveDelay}ms`);
        }
    }

    /**
     * Report API call error to adjust future delays
     */
    reportError() {
        this.consecutiveErrors++;
        this.consecutiveSuccesses = 0;

        console.log(`⚠️  API error reported - consecutive errors: ${this.consecutiveErrors}, increasing delay to: ${this.getAdaptiveDelay()}ms`);
    }

    /**
     * Wrapper method for Google Maps API calls with automatic rate limiting
     * @param {Function} apiCall - The API call function to execute
     * @param {...any} args - Arguments to pass to the API call
     * @returns {Promise} - Result of the API call after applying delay
     */
    async withDelay(apiCall, ...args) {
        try {
            await this.delay();
            const result = await apiCall(...args);
            return result;
        } catch (error) {
            this.errorHandler.logAndContinue(error, {
                operation: 'withDelay',
                apiCallName: apiCall.name || 'anonymous'
            });
            throw error; // Re-throw to maintain error propagation
        }
    }

    /**
     * Get the current delay setting
     * @returns {number} - Current delay in milliseconds
     */
    getDelayMs() {
        return this.defaultDelayMs;
    }
}

module.exports = RateLimiter;