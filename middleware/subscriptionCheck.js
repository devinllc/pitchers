const DatabaseService = require('../services/database');

class SubscriptionCheckMiddleware {
    constructor() {
        this.databaseService = new DatabaseService();
    }

    // Check if user has an active subscription
    checkActiveSubscription() {
        return async (req, res, next) => {
            try {
                // User email should be provided by JWT middleware
                const userEmail = req.user?.email;
                
                if (!userEmail) {
                    return res.status(401).json({
                        success: false,
                        error: 'Authentication required',
                        message: 'User authentication is required for this operation'
                    });
                }

                // Check subscription status in database
                const subscription = await this.getUserSubscription(userEmail);
                
                if (!subscription) {
                    return res.status(403).json({
                        success: false,
                        error: 'No subscription found',
                        message: 'You need to subscribe to access this feature',
                        code: 'no_subscription'
                    });
                }

                if (subscription.status !== 'active') {
                    return res.status(403).json({
                        success: false,
                        error: 'Inactive subscription',
                        message: `Your subscription is ${subscription.status}. Please renew your subscription to continue.`,
                        code: 'inactive_subscription',
                        subscription: {
                            status: subscription.status,
                            plan: subscription.plan_name,
                            expiresAt: subscription.expires_at
                        }
                    });
                }

                // Check if subscription has expired
                if (subscription.expires_at && new Date(subscription.expires_at) < new Date()) {
                    return res.status(403).json({
                        success: false,
                        error: 'Subscription expired',
                        message: 'Your subscription has expired. Please renew your subscription to continue.',
                        code: 'subscription_expired',
                        subscription: {
                            status: subscription.status,
                            plan: subscription.plan_name,
                            expiresAt: subscription.expires_at
                        }
                    });
                }

                // Attach subscription info to request
                req.subscription = subscription;
                
                next();
            } catch (error) {
                console.error('Subscription check error:', error);
                return res.status(500).json({
                    success: false,
                    error: 'Subscription check error',
                    message: 'An error occurred while checking your subscription'
                });
            }
        };
    }

    // Get user's active subscription
    async getUserSubscription(userEmail) {
        const client = await this.databaseService.pool.connect();
        try {
            const result = await client.query(`
                SELECT s.*, p.name as plan_name, p.features
                FROM subscriptions s
                JOIN plans p ON s.plan_id = p.id
                WHERE s.user_email = $1
                AND s.status = 'active'
                ORDER BY s.created_at DESC
                LIMIT 1
            `, [userEmail]);
            
            return result.rows[0] || null;
        } catch (error) {
            console.error('Error getting user subscription:', error);
            throw error;
        } finally {
            client.release();
        }
    }

    // Initialize database tables
    async initialize() {
        const client = await this.databaseService.pool.connect();
        try {
            // Create plans table if it doesn't exist
            await client.query(`
                CREATE TABLE IF NOT EXISTS plans (
                    id SERIAL PRIMARY KEY,
                    name VARCHAR(100) NOT NULL,
                    description TEXT,
                    price DECIMAL(10, 2) NOT NULL,
                    currency VARCHAR(3) DEFAULT 'INR',
                    interval VARCHAR(20) DEFAULT 'month',
                    features JSONB,
                    is_active BOOLEAN DEFAULT true,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                );
            `);

            // Create subscriptions table if it doesn't exist
            await client.query(`
                CREATE TABLE IF NOT EXISTS subscriptions (
                    id SERIAL PRIMARY KEY,
                    user_email VARCHAR(255) NOT NULL,
                    plan_id INTEGER REFERENCES plans(id),
                    payment_id VARCHAR(255),
                    status VARCHAR(50) DEFAULT 'pending',
                    starts_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    expires_at TIMESTAMP,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                );
            `);

            // Check if default plans exist, if not create them
            const plansResult = await client.query('SELECT COUNT(*) FROM plans');
            if (parseInt(plansResult.rows[0].count) === 0) {
                // Insert default plans
                await client.query(`
                    INSERT INTO plans (name, description, price, features)
                    VALUES 
                    ('Free', 'Basic access with limited features', 0, '{"usage_limit": 100, "max_jobs": 5, "rate_limit": 10}'),
                    ('Basic', 'Standard access with more features', 999, '{"usage_limit": 1000, "max_jobs": 20, "rate_limit": 30}'),
                    ('Pro', 'Full access with all features', 2999, '{"usage_limit": 5000, "max_jobs": 100, "rate_limit": 60}'),
                    ('Enterprise', 'Custom enterprise solution', 9999, '{"usage_limit": 20000, "max_jobs": 500, "rate_limit": 120}');
                `);
                console.log('Default plans created');
            }

            console.log('Subscription tables initialized');
            return true;
        } catch (error) {
            console.error('Error initializing subscription tables:', error);
            throw error;
        } finally {
            client.release();
        }
    }

    // Get all available plans
    async getAllPlans() {
        const client = await this.databaseService.pool.connect();
        try {
            const result = await client.query(`
                SELECT * FROM plans
                WHERE is_active = true
                ORDER BY price ASC
            `);
            
            return result.rows;
        } catch (error) {
            console.error('Error getting plans:', error);
            throw error;
        } finally {
            client.release();
        }
    }
}

module.exports = SubscriptionCheckMiddleware;
