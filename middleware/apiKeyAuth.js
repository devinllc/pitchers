const ApiKey = require('../models/ApiKey');
const DatabaseService = require('../services/database');

class ApiKeyAuthMiddleware {
    constructor() {
        this.dbService = new DatabaseService();
        this.apiKeyModel = new ApiKey(this.dbService);
        this.rateLimitStore = new Map(); // In-memory rate limit store
    }

    // Main API key authentication middleware
    authenticate() {
        return async (req, res, next) => {
            try {
                const apiKey = this.extractApiKey(req);

                if (!apiKey) {
                    return res.status(401).json({
                        error: 'Authentication required',
                        message: 'API key is required. Include it in Authorization header as "Bearer your-api-key" or as x-api-key header'
                    });
                }

                // Validate API key
                const keyData = await this.apiKeyModel.validateApiKey(apiKey);

                if (!keyData) {
                    return res.status(401).json({
                        error: 'Invalid API key',
                        message: 'The provided API key is invalid, expired, or inactive'
                    });
                }

                if (keyData.limitExceeded) {
                    return res.status(429).json({
                        error: 'Usage limit exceeded',
                        message: `Monthly usage limit of ${keyData.usage_limit} requests has been exceeded`,
                        usage: {
                            current: keyData.usage_count,
                            limit: keyData.usage_limit
                        }
                    });
                }

                // Check rate limit
                const rateLimitResult = await this.checkRateLimit(apiKey, keyData.rate_limit_per_minute);
                if (!rateLimitResult.allowed) {
                    return res.status(429).json({
                        error: 'Rate limit exceeded',
                        message: `Rate limit of ${keyData.rate_limit_per_minute} requests per minute exceeded`,
                        rateLimit: {
                            limit: keyData.rate_limit_per_minute,
                            remaining: rateLimitResult.remaining,
                            resetTime: rateLimitResult.resetTime
                        }
                    });
                }

                // Attach API key data to request
                req.apiKey = {
                    key: apiKey,
                    data: keyData,
                    rateLimit: rateLimitResult
                };

                next();
            } catch (error) {
                console.error('API key authentication error:', error);
                res.status(500).json({
                    error: 'Authentication error',
                    message: 'Failed to authenticate API key'
                });
            }
        };
    }

    // Usage tracking middleware (call after successful request)
    trackUsage() {
        return async (req, res, next) => {
            // Store original send method
            const originalSend = res.send;

            res.send = async function(data) {
                // Only track usage for successful responses (2xx status codes)
                if (res.statusCode >= 200 && res.statusCode < 300 && req.apiKey) {
                    try {
                        await req.app.locals.apiKeyMiddleware.incrementUsage(req.apiKey.key);
                    } catch (error) {
                        console.error('Error tracking API usage:', error);
                        // Don't fail the request if usage tracking fails
                    }
                }

                // Call original send method
                originalSend.call(this, data);
            };

            next();
        };
    }

    // Extract API key from request headers
    extractApiKey(req) {
        // Check Authorization header (Bearer token)
        const authHeader = req.headers.authorization;
        if (authHeader && authHeader.startsWith('Bearer ')) {
            return authHeader.substring(7);
        }

        // Check x-api-key header
        const apiKeyHeader = req.headers['x-api-key'];
        if (apiKeyHeader) {
            return apiKeyHeader;
        }

        // Check query parameter (less secure, but sometimes needed)
        const queryApiKey = req.query.api_key;
        if (queryApiKey) {
            return queryApiKey;
        }

        return null;
    }

    // Rate limiting logic
    async checkRateLimit(apiKey, limitPerMinute) {
        const now = Date.now();
        const windowStart = now - 60000; // 1 minute window

        // Get or create rate limit data for this API key
        if (!this.rateLimitStore.has(apiKey)) {
            this.rateLimitStore.set(apiKey, []);
        }

        const requests = this.rateLimitStore.get(apiKey);

        // Remove requests outside the current window
        const validRequests = requests.filter(timestamp => timestamp > windowStart);
        this.rateLimitStore.set(apiKey, validRequests);

        // Check if limit exceeded
        if (validRequests.length >= limitPerMinute) {
            const oldestRequest = Math.min(...validRequests);
            const resetTime = new Date(oldestRequest + 60000);

            return {
                allowed: false,
                remaining: 0,
                resetTime: resetTime.toISOString()
            };
        }

        // Add current request
        validRequests.push(now);
        this.rateLimitStore.set(apiKey, validRequests);

        return {
            allowed: true,
            remaining: limitPerMinute - validRequests.length,
            resetTime: new Date(now + 60000).toISOString()
        };
    }

    // Increment usage count
    async incrementUsage(apiKey) {
        try {
            return await this.apiKeyModel.incrementUsage(apiKey);
        } catch (error) {
            console.error('Error incrementing usage:', error);
            throw error;
        }
    }

    // Clean up old rate limit data (call periodically)
    cleanupRateLimitStore() {
        const now = Date.now();
        const windowStart = now - 60000;

        for (const [apiKey, requests] of this.rateLimitStore.entries()) {
            const validRequests = requests.filter(timestamp => timestamp > windowStart);
            if (validRequests.length === 0) {
                this.rateLimitStore.delete(apiKey);
            } else {
                this.rateLimitStore.set(apiKey, validRequests);
            }
        }
    }

    // Optional: Add rate limit headers to response
    addRateLimitHeaders() {
        return (req, res, next) => {
            if (req.apiKey && req.apiKey.rateLimit) {
                res.set({
                    'X-RateLimit-Limit': req.apiKey.data.rate_limit_per_minute,
                    'X-RateLimit-Remaining': req.apiKey.rateLimit.remaining,
                    'X-RateLimit-Reset': req.apiKey.rateLimit.resetTime
                });
            }
            next();
        };
    }

    // Optional: Add usage headers to response
    addUsageHeaders() {
        return (req, res, next) => {
            if (req.apiKey && req.apiKey.data) {
                res.set({
                    'X-Usage-Current': req.apiKey.data.usage_count,
                    'X-Usage-Limit': req.apiKey.data.usage_limit,
                    'X-Usage-Remaining': req.apiKey.data.usage_limit - req.apiKey.data.usage_count
                });
            }
            next();
        };
    }
}

module.exports = ApiKeyAuthMiddleware;
