const express = require('express');
const router = express.Router();
const AdminController = require('../controllers/adminController');
const AdminAuthMiddleware = require('../middleware/adminAuth');

// Initialize controller and middleware
const adminController = new AdminController();
const adminAuth = new AdminAuthMiddleware();

// Initialize admin tables
adminController.initialize().catch(console.error);

// Admin authentication middleware
const requireAdmin = adminAuth.authenticate();
const requireSuperAdmin = adminAuth.authenticateSuperAdmin();

// Debug route for token verification (development only)
if (process.env.NODE_ENV !== 'production') {
    router.get('/debug/token', (req, res) => {
        try {
            const authHeader = req.headers.authorization;
            if (!authHeader || !authHeader.startsWith('Bearer ')) {
                return res.status(401).json({
                    success: false,
                    error: 'No token provided',
                    message: 'Authorization header missing or invalid format'
                });
            }
            
            const token = authHeader.substring(7);
            const parts = token.split('.');
            
            if (parts.length !== 3) {
                return res.status(400).json({
                    success: false,
                    error: 'Invalid token format',
                    message: 'Token should have three parts separated by dots'
                });
            }
            
            try {
                // Handle padding issues with base64 decoding
                const base64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
                const padded = base64 + '==='.slice(0, (4 - base64.length % 4) % 4);
                const payload = JSON.parse(Buffer.from(padded, 'base64').toString());
                
                return res.json({
                    success: true,
                    message: 'Token parsed successfully',
                    payload
                });
            } catch (parseError) {
                return res.status(400).json({
                    success: false,
                    error: 'Token parsing error',
                    message: parseError.message
                });
            }
        } catch (error) {
            return res.status(500).json({
                success: false,
                error: 'Server error',
                message: error.message
            });
        }
    });
}

// User Management Routes
router.get('/users', requireAdmin, (req, res) => adminController.getAllUsers(req, res));
router.get('/users/:email', requireAdmin, (req, res) => adminController.getUserDetails(req, res));
router.post('/users/assign-plan', requireAdmin, (req, res) => adminController.assignPlanToUser(req, res));
router.post('/leads', requireAdmin, (req, res) => adminController.getAllLeads(req, res));

// All API keys (admin view)
router.get('/api-keys', requireAdmin, async (req, res) => {
    try {
        const { page = 1, limit = 50, search } = req.query;
        const offset = (page - 1) * limit;
        const client = await adminController.databaseService.pool.connect();
        try {
            let whereClause = 'WHERE 1=1';
            const params = [];
            if (search) {
                params.push(`%${search}%`);
                whereClause += ` AND (ak.user_email ILIKE $${params.length} OR ak.api_key ILIKE $${params.length})`;
            }
            params.push(limit, offset);

            const result = await client.query(`
                SELECT 
                    ak.api_key,
                    ak.user_email,
                    ak.plan_type,
                    ak.usage_count,
                    ak.usage_limit,
                    ak.is_active,
                    ak.created_at,
                    ak.last_used_at,
                    ak.expires_at,
                    ak.rate_limit_per_minute
                FROM api_keys ak
                ${whereClause}
                ORDER BY ak.created_at DESC
                LIMIT $${params.length - 1} OFFSET $${params.length}
            `, params);

            const countResult = await client.query(
                `SELECT COUNT(*) FROM api_keys ak ${whereClause.replace(/\$(\d+)/g, (m, n) => `$${n}`)}`,
                params.slice(0, params.length - 2)
            );

            return res.json({
                success: true,
                apiKeys: result.rows,
                total: parseInt(countResult.rows[0].count),
                pagination: {
                    page: parseInt(page),
                    limit: parseInt(limit),
                    total: parseInt(countResult.rows[0].count),
                    totalPages: Math.ceil(parseInt(countResult.rows[0].count) / limit)
                }
            });
        } finally {
            client.release();
        }
    } catch (error) {
        console.error('Error getting all API keys:', error);
        return res.status(500).json({ success: false, error: 'Failed to get API keys', message: error.message });
    }
});

// Usage Monitoring Routes
router.get('/usage/statistics', requireAdmin, (req, res) => adminController.getUsageStatistics(req, res));

// Subscription Management Routes
router.get('/subscriptions/statistics', requireAdmin, (req, res) => adminController.getSubscriptionStatistics(req, res));
router.get('/subscription/plans', requireAdmin, (req, res) => adminController.getSubscriptionPlans(req, res));

// Admin User Management Routes (super admin only)
router.get('/admins', requireSuperAdmin, (req, res) => adminController.getAdminUsers(req, res));
router.post('/admins', requireSuperAdmin, (req, res) => adminController.addAdminUser(req, res));
router.delete('/admins/:email', requireSuperAdmin, (req, res) => adminController.removeAdminUser(req, res));

// Dashboard Route - Get summary statistics
router.get('/dashboard', requireAdmin, async (req, res) => {
    try {
        const client = await adminController.databaseService.pool.connect();
        try {
            // Get user count from user_google_sheets table
            const userCountResult = await client.query(`
                SELECT COUNT(DISTINCT user_email) as count FROM user_google_sheets
            `);
            
            // Get active subscription count
            const subscriptionCountResult = await client.query(`
                SELECT COUNT(*) as count FROM subscriptions WHERE status = 'active'
            `);
            
            // Get total jobs
            const jobCountResult = await client.query(`
                SELECT COUNT(*) as count FROM jobs
            `);
            
            // Get total API usage this month
            const usageResult = await client.query(`
                SELECT SUM(units_consumed) as total
                FROM usage_logs
                WHERE created_at >= date_trunc('month', CURRENT_DATE)
            `);
            
            // Get plan distribution
            const planDistributionResult = await client.query(`
                SELECT 
                    p.name, 
                    COUNT(*) as count
                FROM subscriptions s
                JOIN plans p ON s.plan_id = p.id
                WHERE s.status = 'active'
                GROUP BY p.name
                ORDER BY count DESC
            `);
            
            // Get recent users from user_google_sheets table
            const recentUsersResult = await client.query(`
                SELECT 
                    user_email as email, 
                    user_email as name, 
                    created_at
                FROM user_google_sheets
                ORDER BY created_at DESC
                LIMIT 5
            `);
            
            // Get recent subscriptions
            const recentSubscriptionsResult = await client.query(`
                SELECT 
                    s.user_email, 
                    p.name as plan_name, 
                    s.status, 
                    s.created_at
                FROM subscriptions s
                JOIN plans p ON s.plan_id = p.id
                ORDER BY s.created_at DESC
                LIMIT 5
            `);
            
            return res.json({
                success: true,
                statistics: {
                    userCount: parseInt(userCountResult.rows[0].count),
                    activeSubscriptions: parseInt(subscriptionCountResult.rows[0].count),
                    totalJobs: parseInt(jobCountResult.rows[0].count),
                    monthlyUsage: parseInt(usageResult.rows[0]?.total || 0)
                },
                planDistribution: planDistributionResult.rows,
                recentUsers: recentUsersResult.rows,
                recentSubscriptions: recentSubscriptionsResult.rows
            });
        } finally {
            client.release();
        }
    } catch (error) {
        console.error('Error getting dashboard data:', error);
        return res.status(500).json({
            success: false,
            error: 'Failed to get dashboard data',
            message: error.message
        });
    }
});

module.exports = router;
