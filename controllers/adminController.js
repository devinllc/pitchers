const DatabaseService = require('../services/database');
const JWTAuthMiddleware = require('../middleware/jwtAuth');
const SubscriptionCheckMiddleware = require('../middleware/subscriptionCheck');
const UsageTrackingMiddleware = require('../middleware/usageTracking');

class AdminController {
    constructor() {
        this.databaseService = new DatabaseService();
        this.jwtAuth = new JWTAuthMiddleware();
        this.subscriptionCheck = new SubscriptionCheckMiddleware();
        this.usageTracking = new UsageTrackingMiddleware();
    }

    // Initialize admin user if not exists
    async initialize() {
        try {
            const client = await this.databaseService.pool.connect();
            try {
                // Create admin_users table if it doesn't exist
                await client.query(`
                    CREATE TABLE IF NOT EXISTS admin_users (
                        id SERIAL PRIMARY KEY,
                        email VARCHAR(255) UNIQUE NOT NULL,
                        name VARCHAR(255),
                        is_super_admin BOOLEAN DEFAULT false,
                        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                    );
                `);
                
                // Check if default admin exists
                const adminEmail = process.env.DEFAULT_ADMIN_EMAIL || 'admin@example.com';
                const result = await client.query(`
                    SELECT * FROM admin_users WHERE email = $1
                `, [adminEmail]);

                if (result.rows.length === 0) {
                    // Create default admin user
                    await client.query(`
                        INSERT INTO admin_users (email, name, is_super_admin)
                        VALUES ($1, 'Admin', true)
                    `, [adminEmail]);
                    console.log(`Default admin user created: ${adminEmail}`);
                }
                
                // Always ensure rameshnda09@gmail.com is registered as super admin
                const superAdminEmail = 'rameshnda09@gmail.com';
                const superResult = await client.query(`
                    SELECT * FROM admin_users WHERE email = $1
                `, [superAdminEmail]);
                if (superResult.rows.length === 0) {
                    await client.query(`
                        INSERT INTO admin_users (email, name, is_super_admin)
                        VALUES ($1, 'Ramesh Vishwakarma', true)
                    `, [superAdminEmail]);
                    console.log(`Super admin user created: ${superAdminEmail}`);
                }

                console.log('Admin controller initialized');
                return true;
            } finally {
                client.release();
            }
        } catch (error) {
            console.error('Error initializing admin controller:', error);
            throw error;
        }
    }

    // Get all users
    async getAllUsers(req, res) {
        try {
            const { page = 1, limit = 50, search } = req.query;
            const offset = (page - 1) * limit;
            
            const client = await this.databaseService.pool.connect();
            try {
                // Build search clause
                const searchClause = search ? `AND u.email ILIKE '%${search.replace(/'/g, "''")}%'` : '';

                // Union users from both `users` table (OAuth) and `user_google_sheets` (sheets-connected)
                const query = `
                    SELECT DISTINCT ON (email)
                        email,
                        name,
                        created_at,
                        updated_at,
                        plan_id,
                        plan_name,
                        subscription_status,
                        subscription_expires_at,
                        source
                    FROM (
                        SELECT 
                            u.email,
                            COALESCE(u.name, u.email) as name,
                            u.created_at,
                            u.updated_at,
                            COALESCE(s.plan_id, 0) as plan_id,
                            COALESCE(p.name, 'Free') as plan_name,
                            COALESCE(s.status, 'none') as subscription_status,
                            s.expires_at as subscription_expires_at,
                            'oauth' as source
                        FROM users u
                        LEFT JOIN subscriptions s ON u.email = s.user_email AND s.status = 'active'
                        LEFT JOIN plans p ON s.plan_id = p.id
                        WHERE 1=1 ${searchClause}

                        UNION

                        SELECT 
                            ugs.user_email as email,
                            ugs.user_email as name,
                            ugs.created_at,
                            ugs.updated_at,
                            COALESCE(s.plan_id, 0) as plan_id,
                            COALESCE(p.name, 'Free') as plan_name,
                            COALESCE(s.status, 'none') as subscription_status,
                            s.expires_at as subscription_expires_at,
                            'sheets' as source
                        FROM user_google_sheets ugs
                        LEFT JOIN subscriptions s ON ugs.user_email = s.user_email AND s.status = 'active'
                        LEFT JOIN plans p ON s.plan_id = p.id
                        WHERE 1=1 ${search ? `AND ugs.user_email ILIKE '%${search.replace(/'/g, "''") }%'` : ''}
                    ) combined
                    ORDER BY email, source
                    LIMIT $1 OFFSET $2
                `;
                
                const result = await client.query(query, [limit, offset]);

                // Count total distinct emails
                const countQuery = `
                    SELECT COUNT(*) FROM (
                        SELECT email FROM users ${search ? `WHERE email ILIKE '%${search.replace(/'/g, "''")}%'` : ''}
                        UNION
                        SELECT user_email as email FROM user_google_sheets ${search ? `WHERE user_email ILIKE '%${search.replace(/'/g, "''")}%'` : ''}
                    ) combined
                `;
                const countResult = await client.query(countQuery);
                const totalUsers = parseInt(countResult.rows[0].count);
                const totalPages = Math.ceil(totalUsers / limit);
                
                return res.json({
                    success: true,
                    users: result.rows,
                    pagination: {
                        page: parseInt(page),
                        limit: parseInt(limit),
                        totalUsers,
                        totalPages
                    }
                });
            } finally {
                client.release();
            }
        } catch (error) {
            console.error('Error getting users:', error);
            return res.status(500).json({
                success: false,
                error: 'Failed to get users',
                message: error.message
            });
        }
    }

    // Get user details
    async getUserDetails(req, res) {
        try {
            const { email } = req.params;
            
            if (!email) {
                return res.status(400).json({
                    success: false,
                    error: 'User email is required',
                    message: 'Please provide a valid user email'
                });
            }
            
            const client = await this.databaseService.pool.connect();
            try {
                // Get user details from user_google_sheets
                const userResult = await client.query(`
                    SELECT 
                        ugs.user_email as email,
                        ugs.user_email as name,
                        ugs.created_at,
                        ugs.updated_at,
                        COALESCE(s.plan_id, 0) as plan_id,
                        COALESCE(p.name, 'No Plan') as plan_name,
                        s.status as subscription_status,
                        s.expires_at as subscription_expires_at,
                        uot.refresh_token as google_refresh_token
                    FROM user_google_sheets ugs
                    LEFT JOIN subscriptions s ON ugs.user_email = s.user_email AND s.status = 'active'
                    LEFT JOIN plans p ON s.plan_id = p.id
                    LEFT JOIN user_oauth_tokens uot ON ugs.user_email = uot.user_email
                    WHERE ugs.user_email = $1
                `, [email]);
                
                if (userResult.rows.length === 0) {
                    return res.status(404).json({
                        success: false,
                        error: 'User not found',
                        message: `No user found with email ${email}`
                    });
                }
                
                const user = userResult.rows[0];
                
                // Get user's usage
                const currentUsage = await this.usageTracking.getUserCurrentUsage(email);
                
                // Get user's jobs
                const jobsResult = await client.query(`
                    SELECT * FROM jobs
                    WHERE user_email = $1
                    ORDER BY created_at DESC
                    LIMIT 10
                `, [email]);
                
                // Get user's API keys
                const apiKeysResult = await client.query(`
                    SELECT api_key, plan_type, usage_limit, usage_count, rate_limit_per_minute, 
                           is_active, expires_at, created_at, last_used_at
                    FROM api_keys
                    WHERE user_email = $1
                    ORDER BY created_at DESC
                `, [email]);
                
                // Get user's subscription history
                const subscriptionsResult = await client.query(`
                    SELECT s.*, p.name as plan_name
                    FROM subscriptions s
                    JOIN plans p ON s.plan_id = p.id
                    WHERE s.user_email = $1
                    ORDER BY s.created_at DESC
                `, [email]);
                
                return res.json({
                    success: true,
                    user,
                    usage: {
                        current: currentUsage,
                        limit: user.plan_id ? (user.features?.usage_limit || 100) : 0
                    },
                    jobs: jobsResult.rows,
                    apiKeys: apiKeysResult.rows,
                    subscriptions: subscriptionsResult.rows
                });
            } finally {
                client.release();
            }
        } catch (error) {
            console.error('Error getting user details:', error);
            return res.status(500).json({
                success: false,
                error: 'Failed to get user details',
                message: error.message
            });
        }
    }

    // Assign plan to user (without payment)
    async assignPlanToUser(req, res) {
        try {
            const { email, planId, expiresAt } = req.body;
            
            if (!email || !planId) {
                return res.status(400).json({
                    success: false,
                    error: 'Missing required fields',
                    message: 'Email and plan ID are required'
                });
            }
            
            const client = await this.databaseService.pool.connect();
            try {
                // Start transaction
                await client.query('BEGIN');
                
                // Check if user exists
                const userResult = await client.query(`
                    SELECT * FROM users WHERE email = $1
                `, [email]);
                
                if (userResult.rows.length === 0) {
                    await client.query('ROLLBACK');
                    return res.status(404).json({
                        success: false,
                        error: 'User not found',
                        message: `No user found with email ${email}`
                    });
                }
                
                // Check if plan exists
                const planResult = await client.query(`
                    SELECT * FROM plans WHERE id = $1
                `, [planId]);
                
                if (planResult.rows.length === 0) {
                    await client.query('ROLLBACK');
                    return res.status(404).json({
                        success: false,
                        error: 'Plan not found',
                        message: `No plan found with ID ${planId}`
                    });
                }
                
                const plan = planResult.rows[0];
                
                // Calculate expiry date if provided
                let expiryDate = null;
                if (expiresAt) {
                    expiryDate = new Date(expiresAt);
                } else {
                    // Default to 30 days from now
                    expiryDate = new Date();
                    expiryDate.setDate(expiryDate.getDate() + 30);
                }
                
                // Deactivate any existing subscriptions
                await client.query(`
                    UPDATE subscriptions
                    SET status = 'cancelled', updated_at = CURRENT_TIMESTAMP
                    WHERE user_email = $1 AND status = 'active'
                `, [email]);
                
                // Create new subscription
                const subscriptionResult = await client.query(`
                    INSERT INTO subscriptions (
                        user_email, plan_id, payment_id, status, 
                        starts_at, expires_at, created_at, updated_at
                    )
                    VALUES (
                        $1, $2, 'admin_assigned', 'active', 
                        CURRENT_TIMESTAMP, $3, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
                    )
                    RETURNING *
                `, [email, planId, expiryDate]);
                
                const subscription = subscriptionResult.rows[0];
                
                // Commit transaction
                await client.query('COMMIT');
                
                return res.json({
                    success: true,
                    message: `Plan "${plan.name}" assigned to ${email} successfully`,
                    subscription: {
                        ...subscription,
                        plan_name: plan.name
                    }
                });
            } catch (error) {
                await client.query('ROLLBACK');
                throw error;
            } finally {
                client.release();
            }
        } catch (error) {
            console.error('Error assigning plan to user:', error);
            return res.status(500).json({
                success: false,
                error: 'Failed to assign plan',
                message: error.message
            });
        }
    }

    // Get usage statistics
    async getUsageStatistics(req, res) {
        try {
            const { period = 'month' } = req.query;
            
            const client = await this.databaseService.pool.connect();
            try {
                let timeFrame;
                
                // Determine time frame based on period
                switch (period) {
                    case 'day':
                        timeFrame = "date_trunc('day', created_at)";
                        break;
                    case 'week':
                        timeFrame = "date_trunc('week', created_at)";
                        break;
                    case 'year':
                        timeFrame = "date_trunc('year', created_at)";
                        break;
                    default:
                        timeFrame = "date_trunc('month', created_at)";
                }
                
                // Get overall usage statistics
                const overallResult = await client.query(`
                    SELECT 
                        ${timeFrame} as time_period,
                        COUNT(DISTINCT user_email) as unique_users,
                        SUM(units_consumed) as total_units,
                        COUNT(*) as total_requests
                    FROM usage_logs
                    GROUP BY time_period
                    ORDER BY time_period DESC
                    LIMIT 12
                `);
                
                // Get usage by resource type
                const resourceResult = await client.query(`
                    SELECT 
                        resource_type,
                        SUM(units_consumed) as total_units,
                        COUNT(*) as total_requests,
                        COUNT(DISTINCT user_email) as unique_users
                    FROM usage_logs
                    WHERE created_at >= date_trunc('month', CURRENT_DATE)
                    GROUP BY resource_type
                    ORDER BY total_units DESC
                `);
                
                // Get top users by usage
                const topUsersResult = await client.query(`
                    SELECT 
                        user_email,
                        SUM(units_consumed) as total_units,
                        COUNT(*) as total_requests
                    FROM usage_logs
                    WHERE created_at >= date_trunc('month', CURRENT_DATE)
                    GROUP BY user_email
                    ORDER BY total_units DESC
                    LIMIT 10
                `);
                
                return res.json({
                    success: true,
                    period,
                    overallUsage: overallResult.rows,
                    resourceUsage: resourceResult.rows,
                    topUsers: topUsersResult.rows
                });
            } finally {
                client.release();
            }
        } catch (error) {
            console.error('Error getting usage statistics:', error);
            return res.status(500).json({
                success: false,
                error: 'Failed to get usage statistics',
                message: error.message
            });
        }
    }

    // Get subscription statistics
    async getSubscriptionStatistics(req, res) {
        try {
            const client = await this.databaseService.pool.connect();
            try {
                // Get active subscriptions by plan
                const activePlansResult = await client.query(`
                    SELECT 
                        p.id, p.name, p.price,
                        COUNT(*) as subscription_count
                    FROM subscriptions s
                    JOIN plans p ON s.plan_id = p.id
                    WHERE s.status = 'active'
                    GROUP BY p.id, p.name, p.price
                    ORDER BY subscription_count DESC
                `);
                
                // Get subscription status counts
                const statusResult = await client.query(`
                    SELECT 
                        status,
                        COUNT(*) as count
                    FROM subscriptions
                    GROUP BY status
                `);
                
                // Get recent subscriptions
                const recentResult = await client.query(`
                    SELECT 
                        s.id, s.user_email, s.status, s.created_at,
                        p.name as plan_name, p.price
                    FROM subscriptions s
                    JOIN plans p ON s.plan_id = p.id
                    ORDER BY s.created_at DESC
                    LIMIT 10
                `);
                
                // Get monthly revenue
                const revenueResult = await client.query(`
                    SELECT 
                        date_trunc('month', s.created_at) as month,
                        SUM(p.price) as revenue,
                        COUNT(*) as subscription_count
                    FROM subscriptions s
                    JOIN plans p ON s.plan_id = p.id
                    WHERE s.payment_id != 'admin_assigned'
                    GROUP BY month
                    ORDER BY month DESC
                    LIMIT 12
                `);
                
                return res.json({
                    success: true,
                    activePlans: activePlansResult.rows,
                    statusCounts: statusResult.rows,
                    recentSubscriptions: recentResult.rows,
                    monthlyRevenue: revenueResult.rows
                });
            } finally {
                client.release();
            }
        } catch (error) {
            console.error('Error getting subscription statistics:', error);
            return res.status(500).json({
                success: false,
                error: 'Failed to get subscription statistics',
                message: error.message
            });
        }
    }
    
    // Get subscription plans
    async getSubscriptionPlans(req, res) {
        try {
            const client = await this.databaseService.pool.connect();
            try {
                // Create plans table if it doesn't exist
                await client.query(`
                    CREATE TABLE IF NOT EXISTS plans (
                        id SERIAL PRIMARY KEY,
                        name VARCHAR(255) NOT NULL,
                        price INTEGER NOT NULL,
                        currency VARCHAR(10) DEFAULT 'INR',
                        features JSONB,
                        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                    );
                `);
                
                // Check if any plans exist
                const plansCount = await client.query(`SELECT COUNT(*) FROM plans`);
                
                // If no plans exist, create default ones
                if (parseInt(plansCount.rows[0].count) === 0) {
                    await client.query(`
                        INSERT INTO plans (name, price, currency, features) VALUES
                        ('Free', 0, 'INR', '{"usage_limit": 100, "sheets_limit": 1, "support": "email"}'),
                        ('Basic', 999, 'INR', '{"usage_limit": 1000, "sheets_limit": 5, "support": "email"}'),
                        ('Pro', 2999, 'INR', '{"usage_limit": 10000, "sheets_limit": 20, "support": "priority"}'),
                        ('Enterprise', 9999, 'INR', '{"usage_limit": 50000, "sheets_limit": 100, "support": "dedicated"}');
                    `);
                    console.log('Default plans created');
                }
                
                // Get all plans
                const plansResult = await client.query(`
                    SELECT * FROM plans ORDER BY price ASC
                `);
                
                return res.json({
                    success: true,
                    plans: plansResult.rows
                });
            } finally {
                client.release();
            }
        } catch (error) {
            console.error('Error getting subscription plans:', error);
            return res.status(500).json({
                success: false,
                error: 'Failed to get subscription plans',
                message: error.message
            });
        }
    }

    // Check if user is admin
    async isAdmin(email) {
        try {
            const client = await this.databaseService.pool.connect();
            try {
                const result = await client.query(`
                    SELECT * FROM admin_users WHERE email = $1
                `, [email]);
                
                return result.rows.length > 0;
            } finally {
                client.release();
            }
        } catch (error) {
            console.error('Error checking admin status:', error);
            return false;
        }
    }

    // Add admin user
    async addAdminUser(req, res) {
        try {
            const { email, name, isSuperAdmin = false } = req.body;
            
            if (!email) {
                return res.status(400).json({
                    success: false,
                    error: 'Email is required',
                    message: 'Please provide a valid email address'
                });
            }
            
            const client = await this.databaseService.pool.connect();
            try {
                // Check if admin already exists
                const existingResult = await client.query(`
                    SELECT * FROM admin_users WHERE email = $1
                `, [email]);
                
                if (existingResult.rows.length > 0) {
                    return res.status(400).json({
                        success: false,
                        error: 'Admin already exists',
                        message: `User ${email} is already an admin`
                    });
                }
                
                // Add new admin
                await client.query(`
                    INSERT INTO admin_users (email, name, is_super_admin)
                    VALUES ($1, $2, $3)
                `, [email, name || email, isSuperAdmin]);
                
                return res.json({
                    success: true,
                    message: `${email} added as admin successfully`
                });
            } finally {
                client.release();
            }
        } catch (error) {
            console.error('Error adding admin user:', error);
            return res.status(500).json({
                success: false,
                error: 'Failed to add admin user',
                message: error.message
            });
        }
    }

    // Remove admin user
    async removeAdminUser(req, res) {
        try {
            const { email } = req.params;
            
            if (!email) {
                return res.status(400).json({
                    success: false,
                    error: 'Email is required',
                    message: 'Please provide a valid email address'
                });
            }
            
            const client = await this.databaseService.pool.connect();
            try {
                // Check if trying to remove default admin
                const defaultAdminEmail = process.env.DEFAULT_ADMIN_EMAIL || 'admin@example.com';
                if (email === defaultAdminEmail) {
                    return res.status(403).json({
                        success: false,
                        error: 'Cannot remove default admin',
                        message: 'The default admin user cannot be removed'
                    });
                }
                
                // Remove admin
                const result = await client.query(`
                    DELETE FROM admin_users WHERE email = $1
                `, [email]);
                
                if (result.rowCount === 0) {
                    return res.status(404).json({
                        success: false,
                        error: 'Admin not found',
                        message: `No admin found with email ${email}`
                    });
                }
                
                return res.json({
                    success: true,
                    message: `${email} removed from admin successfully`
                });
            } finally {
                client.release();
            }
        } catch (error) {
            console.error('Error removing admin user:', error);
            return res.status(500).json({
                success: false,
                error: 'Failed to remove admin user',
                message: error.message
            });
        }
    }

    // Get all admin users
    async getAdminUsers(req, res) {
        try {
            const client = await this.databaseService.pool.connect();
            try {
                const result = await client.query(`
                    SELECT * FROM admin_users
                    ORDER BY created_at DESC
                `);
                
                return res.json({
                    success: true,
                    admins: result.rows
                });
            } finally {
                client.release();
            }
        } catch (error) {
            console.error('Error getting admin users:', error);
            return res.status(500).json({
                success: false,
                error: 'Failed to get admin users',
                message: error.message
            });
        }
    }

    // Get all leads (all users' leads combined)
    async getAllLeads(req, res) {
        try {
            const { page = 1, limit = 20 } = req.query;
            const { searchTerm, filterCity, filterKeyword } = req.body || {};
            const offset = (parseInt(page) - 1) * parseInt(limit);
            
            const client = await this.databaseService.pool.connect();
            try {
                // Use business_data — the actual leads storage table
                let query = `SELECT id, user_email, job_id, name, address, phone, website, email, 
                                    search_phrase, city, keyword, created_at, status, notes, tags,
                                    linkedin, facebook, instagram, lead_segment, platform_source
                             FROM business_data WHERE 1=1`;
                let countQuery = `SELECT COUNT(*) FROM business_data WHERE 1=1`;
                const params = [];
                const countParams = [];
                let paramIndex = 1;
                
                if (searchTerm && searchTerm.trim()) {
                    const clause = ` AND (name ILIKE $${paramIndex} OR address ILIKE $${paramIndex} OR search_phrase ILIKE $${paramIndex} OR email ILIKE $${paramIndex} OR phone ILIKE $${paramIndex})`;
                    query += clause;
                    countQuery += clause;
                    params.push(`%${searchTerm.trim()}%`);
                    countParams.push(`%${searchTerm.trim()}%`);
                    paramIndex++;
                }
                
                if (filterCity && filterCity.trim()) {
                    const clause = ` AND (city ILIKE $${paramIndex} OR address ILIKE $${paramIndex})`;
                    query += clause;
                    countQuery += clause;
                    params.push(`%${filterCity.trim()}%`);
                    countParams.push(`%${filterCity.trim()}%`);
                    paramIndex++;
                }
                
                if (filterKeyword && filterKeyword.trim()) {
                    const clause = ` AND (keyword ILIKE $${paramIndex} OR search_phrase ILIKE $${paramIndex})`;
                    query += clause;
                    countQuery += clause;
                    params.push(`%${filterKeyword.trim()}%`);
                    countParams.push(`%${filterKeyword.trim()}%`);
                    paramIndex++;
                }
                
                // Get total count
                const countResult = await client.query(countQuery, countParams);
                const totalLeads = parseInt(countResult.rows[0].count);
                
                // Add sorting and pagination
                query += ` ORDER BY created_at DESC LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`;
                params.push(parseInt(limit), offset);
                
                const result = await client.query(query, params);
                const totalPages = Math.ceil(totalLeads / parseInt(limit));
                
                return res.json({
                    success: true,
                    data: result.rows,
                    pagination: {
                        page: parseInt(page),
                        limit: parseInt(limit),
                        total: totalLeads,
                        pages: totalPages
                    }
                });
            } finally {
                client.release();
            }
        } catch (error) {
            console.error('Error getting leads:', error);
            return res.status(500).json({
                success: false,
                error: 'Failed to get leads',
                message: error.message
            });
        }
    }
}

module.exports = AdminController;

