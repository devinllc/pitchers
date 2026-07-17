const express = require('express');
const router = express.Router();
const JWTAuthMiddleware = require('../middleware/jwtAuth');
const SubscriptionCheckMiddleware = require('../middleware/subscriptionCheck');
const UsageTrackingMiddleware = require('../middleware/usageTracking');
const DatabaseService = require('../services/database');

// Initialize middleware
const jwtAuth = new JWTAuthMiddleware();
const subscriptionCheck = new SubscriptionCheckMiddleware();
const usageTracking = new UsageTrackingMiddleware();
const dbService = new DatabaseService();

// Get current usage
router.get('/current', jwtAuth.authenticate(), async (req, res) => {
    try {
        const userEmail = req.user.email;
        
        // Get user subscription
        const subscription = await subscriptionCheck.getUserSubscription(userEmail);
        
        // Get current usage
        const currentUsage = await usageTracking.getUserCurrentUsage(userEmail);
        
        // Get plan limits
        const planLimits = subscription?.features || {
            usage_limit: 100,
            rate_limit: 10,
            max_jobs: 5
        };
        
        return res.json({
            success: true,
            usage: {
                current: currentUsage,
                limit: planLimits.usage_limit,
                remaining: Math.max(0, planLimits.usage_limit - currentUsage),
                percentUsed: Math.min(100, Math.round((currentUsage / planLimits.usage_limit) * 100))
            },
            limits: {
                rate: planLimits.rate_limit,
                jobs: planLimits.max_jobs
            },
            subscription: subscription ? {
                plan: subscription.plan_name,
                status: subscription.status,
                expiresAt: subscription.expires_at
            } : null
        });
    } catch (error) {
        console.error('Error getting current usage:', error);
        return res.status(500).json({
            success: false,
            error: 'Failed to get usage information',
            message: error.message
        });
    }
});

// Get usage history
router.get('/history', jwtAuth.authenticate(), async (req, res) => {
    try {
        const userEmail = req.user.email;
        const { startDate, endDate, groupBy } = req.query;
        
        // Default to last 30 days if no dates provided
        const start = startDate ? new Date(startDate) : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
        const end = endDate ? new Date(endDate) : new Date();
        
        // Group by day, week, or month (default: day)
        const validGroupBy = ['day', 'week', 'month'].includes(groupBy) ? groupBy : 'day';
        
        const client = await dbService.pool.connect();
        try {
            let query;
            
            if (validGroupBy === 'day') {
                query = `
                    SELECT 
                        DATE(created_at) as date,
                        SUM(units_consumed) as units,
                        COUNT(*) as requests
                    FROM usage_logs
                    WHERE user_email = $1
                    AND created_at BETWEEN $2 AND $3
                    GROUP BY DATE(created_at)
                    ORDER BY date ASC
                `;
            } else if (validGroupBy === 'week') {
                query = `
                    SELECT 
                        DATE_TRUNC('week', created_at) as date,
                        SUM(units_consumed) as units,
                        COUNT(*) as requests
                    FROM usage_logs
                    WHERE user_email = $1
                    AND created_at BETWEEN $2 AND $3
                    GROUP BY DATE_TRUNC('week', created_at)
                    ORDER BY date ASC
                `;
            } else {
                query = `
                    SELECT 
                        DATE_TRUNC('month', created_at) as date,
                        SUM(units_consumed) as units,
                        COUNT(*) as requests
                    FROM usage_logs
                    WHERE user_email = $1
                    AND created_at BETWEEN $2 AND $3
                    GROUP BY DATE_TRUNC('month', created_at)
                    ORDER BY date ASC
                `;
            }
            
            const result = await client.query(query, [userEmail, start, end]);
            
            return res.json({
                success: true,
                history: result.rows.map(row => ({
                    date: row.date,
                    units: parseInt(row.units),
                    requests: parseInt(row.requests)
                })),
                period: {
                    start: start.toISOString(),
                    end: end.toISOString(),
                    groupBy: validGroupBy
                }
            });
        } finally {
            client.release();
        }
    } catch (error) {
        console.error('Error getting usage history:', error);
        return res.status(500).json({
            success: false,
            error: 'Failed to get usage history',
            message: error.message
        });
    }
});

// Get usage by resource type
router.get('/by-resource', jwtAuth.authenticate(), async (req, res) => {
    try {
        const userEmail = req.user.email;
        const { startDate, endDate } = req.query;
        
        // Default to current month if no dates provided
        const start = startDate ? new Date(startDate) : new Date(new Date().setDate(1));
        const end = endDate ? new Date(endDate) : new Date();
        
        const client = await dbService.pool.connect();
        try {
            const query = `
                SELECT 
                    resource_type,
                    SUM(units_consumed) as units,
                    COUNT(*) as requests
                FROM usage_logs
                WHERE user_email = $1
                AND created_at BETWEEN $2 AND $3
                GROUP BY resource_type
                ORDER BY units DESC
            `;
            
            const result = await client.query(query, [userEmail, start, end]);
            
            return res.json({
                success: true,
                resourceUsage: result.rows.map(row => ({
                    resourceType: row.resource_type,
                    units: parseInt(row.units),
                    requests: parseInt(row.requests)
                })),
                period: {
                    start: start.toISOString(),
                    end: end.toISOString()
                }
            });
        } finally {
            client.release();
        }
    } catch (error) {
        console.error('Error getting resource usage:', error);
        return res.status(500).json({
            success: false,
            error: 'Failed to get resource usage',
            message: error.message
        });
    }
});

// Get usage forecast
router.get('/forecast', jwtAuth.authenticate(), async (req, res) => {
    try {
        const userEmail = req.user.email;
        
        // Get user subscription
        const subscription = await subscriptionCheck.getUserSubscription(userEmail);
        
        // Get current usage
        const currentUsage = await usageTracking.getUserCurrentUsage(userEmail);
        
        // Get plan limits
        const usageLimit = subscription?.features?.usage_limit || 100;
        
        // Get current date info
        const now = new Date();
        const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
        const daysPassed = now.getDate();
        const daysRemaining = daysInMonth - daysPassed;
        
        // Calculate daily average and forecast
        const dailyAverage = daysPassed > 0 ? currentUsage / daysPassed : 0;
        const forecastedTotal = Math.round(currentUsage + (dailyAverage * daysRemaining));
        const willExceedLimit = forecastedTotal > usageLimit;
        
        return res.json({
            success: true,
            forecast: {
                currentUsage,
                usageLimit,
                dailyAverage: Math.round(dailyAverage * 10) / 10,
                forecastedTotal,
                willExceedLimit,
                daysRemaining,
                percentForecast: Math.min(100, Math.round((forecastedTotal / usageLimit) * 100))
            },
            billing: {
                cycleStart: new Date(now.getFullYear(), now.getMonth(), 1).toISOString(),
                cycleEnd: new Date(now.getFullYear(), now.getMonth() + 1, 0).toISOString(),
                daysInCycle: daysInMonth,
                daysPassed,
                daysRemaining
            }
        });
    } catch (error) {
        console.error('Error getting usage forecast:', error);
        return res.status(500).json({
            success: false,
            error: 'Failed to get usage forecast',
            message: error.message
        });
    }
});

module.exports = router;
