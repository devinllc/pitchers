const DatabaseService = require('../services/database');

class UsageTrackingMiddleware {
    constructor() {
        this.databaseService = new DatabaseService();
        this.rateLimitStore = new Map(); // In-memory rate limit store
    }

    // Check if user is within usage limits
    checkUsageLimits() {
        return async (req, res, next) => {
            try {
                // User email and subscription should be provided by previous middleware
                const userEmail = req.user?.email;
                const subscription = req.subscription;
                
                if (!userEmail) {
                    return res.status(401).json({
                        success: false,
                        error: 'Authentication required',
                        message: 'User authentication is required for this operation'
                    });
                }

                if (!subscription) {
                    return res.status(403).json({
                        success: false,
                        error: 'No subscription found',
                        message: 'You need a subscription to access this feature'
                    });
                }

                // Get plan limits from subscription
                const planLimits = subscription.features || {};
                const usageLimit = planLimits.usage_limit || 100; // Default limit
                const rateLimit = planLimits.rate_limit || 10; // Default rate limit

                // Check current usage
                const currentUsage = await this.getUserCurrentUsage(userEmail);
                
                if (currentUsage >= usageLimit) {
                    return res.status(429).json({
                        success: false,
                        error: 'Usage limit exceeded',
                        message: `You have reached your plan's usage limit of ${usageLimit} requests per month`,
                        code: 'usage_limit_exceeded',
                        usage: {
                            current: currentUsage,
                            limit: usageLimit
                        }
                    });
                }

                // Check rate limit
                const rateLimitResult = this.checkRateLimit(userEmail, rateLimit);
                if (!rateLimitResult.allowed) {
                    return res.status(429).json({
                        success: false,
                        error: 'Rate limit exceeded',
                        message: `Rate limit of ${rateLimit} requests per minute exceeded`,
                        code: 'rate_limit_exceeded',
                        rateLimit: {
                            limit: rateLimit,
                            remaining: rateLimitResult.remaining,
                            resetTime: rateLimitResult.resetTime
                        }
                    });
                }

                // Attach usage info to request
                req.usage = {
                    current: currentUsage,
                    limit: usageLimit,
                    remaining: usageLimit - currentUsage,
                    rateLimit: rateLimitResult
                };
                
                // Pre-allocate usage (will be committed after successful request)
                req.usageToTrack = {
                    userEmail,
                    endpoint: req.originalUrl,
                    method: req.method,
                    resourceType: this.getResourceTypeFromUrl(req.originalUrl)
                };
                
                next();
            } catch (error) {
                console.error('Usage check error:', error);
                return res.status(500).json({
                    success: false,
                    error: 'Usage check error',
                    message: 'An error occurred while checking usage limits'
                });
            }
        };
    }

    // Track usage after successful request
    trackUsage() {
        return async (req, res, next) => {
            // Store original send method
            const originalSend = res.send;

            res.send = async function(data) {
                // Only track usage for successful responses (2xx status codes)
                if (res.statusCode >= 200 && res.statusCode < 300 && req.usageToTrack) {
                    try {
                        await req.app.locals.usageTrackingMiddleware.recordUsage(req.usageToTrack);
                    } catch (error) {
                        console.error('Error tracking usage:', error);
                        // Don't fail the request if usage tracking fails
                    }
                }

                // Call original send method
                originalSend.call(this, data);
            };

            next();
        };
    }

    // Record usage in database
    async recordUsage(usageData) {
        const client = await this.databaseService.pool.connect();
        try {
            await client.query(`
                INSERT INTO usage_logs (
                    user_email, endpoint, method, resource_type, units_consumed
                )
                VALUES ($1, $2, $3, $4, $5)
            `, [
                usageData.userEmail,
                usageData.endpoint,
                usageData.method,
                usageData.resourceType,
                usageData.units || 1
            ]);
            
            return true;
        } catch (error) {
            console.error('Error recording usage:', error);
            throw error;
        } finally {
            client.release();
        }
    }

    // Get user's current usage for the current billing period
    async getUserCurrentUsage(userEmail) {
        const client = await this.databaseService.pool.connect();
        try {
            // Get current month's usage
            const result = await client.query(`
                SELECT SUM(units_consumed) as total_usage
                FROM usage_logs
                WHERE user_email = $1
                AND created_at >= date_trunc('month', CURRENT_DATE)
            `, [userEmail]);
            
            return parseInt(result.rows[0]?.total_usage || 0);
        } catch (error) {
            console.error('Error getting user usage:', error);
            throw error;
        } finally {
            client.release();
        }
    }

    // Get resource type from URL
    getResourceTypeFromUrl(url) {
        if (url.includes('/search')) return 'search';
        if (url.includes('/jobs')) return 'job';
        if (url.includes('/google-sheets')) return 'google_sheets';
        return 'api';
    }

    // Check rate limit
    checkRateLimit(userEmail, limitPerMinute) {
        const now = Date.now();
        const windowStart = now - 60000; // 1 minute window

        // Get or create rate limit data for this user
        if (!this.rateLimitStore.has(userEmail)) {
            this.rateLimitStore.set(userEmail, []);
        }

        const requests = this.rateLimitStore.get(userEmail);

        // Remove requests outside the current window
        const validRequests = requests.filter(timestamp => timestamp > windowStart);
        this.rateLimitStore.set(userEmail, validRequests);

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

        // Add current request timestamp
        validRequests.push(now);
        this.rateLimitStore.set(userEmail, validRequests);

        return {
            allowed: true,
            remaining: limitPerMinute - validRequests.length,
            resetTime: new Date(now + 60000).toISOString()
        };
    }

    // Clean up rate limit store (call periodically)
    cleanupRateLimitStore() {
        const now = Date.now();
        const windowStart = now - 60000; // 1 minute window

        for (const [userEmail, timestamps] of this.rateLimitStore.entries()) {
            const validTimestamps = timestamps.filter(timestamp => timestamp > windowStart);
            
            if (validTimestamps.length === 0) {
                // Remove entry if no valid timestamps
                this.rateLimitStore.delete(userEmail);
            } else {
                // Update with only valid timestamps
                this.rateLimitStore.set(userEmail, validTimestamps);
            }
        }
    }

    // Add rate limit headers to response
    addRateLimitHeaders() {
        return (req, res, next) => {
            if (req.usage && req.usage.rateLimit) {
                res.setHeader('X-RateLimit-Limit', req.subscription.features.rate_limit || 10);
                res.setHeader('X-RateLimit-Remaining', req.usage.rateLimit.remaining);
                res.setHeader('X-RateLimit-Reset', req.usage.rateLimit.resetTime);
            }
            
            if (req.usage) {
                res.setHeader('X-Usage-Limit', req.usage.limit);
                res.setHeader('X-Usage-Remaining', req.usage.remaining);
                res.setHeader('X-Usage-Current', req.usage.current);
            }
            
            next();
        };
    }

    // Initialize database tables
    async initialize() {
        const client = await this.databaseService.pool.connect();
        try {
            // Create usage_logs table if it doesn't exist
            await client.query(`
                CREATE TABLE IF NOT EXISTS usage_logs (
                    id SERIAL PRIMARY KEY,
                    user_email VARCHAR(255) NOT NULL,
                    endpoint VARCHAR(255),
                    method VARCHAR(10),
                    resource_type VARCHAR(50),
                    units_consumed INTEGER DEFAULT 1,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                );
            `);

            // Create index on user_email and created_at
            await client.query(`
                CREATE INDEX IF NOT EXISTS idx_usage_logs_user_email ON usage_logs(user_email);
                CREATE INDEX IF NOT EXISTS idx_usage_logs_created_at ON usage_logs(created_at);
            `);

            console.log('Usage tracking tables initialized');
            return true;
        } catch (error) {
            console.error('Error initializing usage tracking tables:', error);
            throw error;
        } finally {
            client.release();
        }
    }
}

module.exports = UsageTrackingMiddleware;
