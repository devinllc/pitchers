class Payment {
    constructor(databaseService) {
        this.db = databaseService;
        if (!this.db || !this.db.pool) {
            console.error('Database service not properly initialized');
            throw new Error('Database service is required');
        }
    }

    // Create payments table for payment tracking
    async createPaymentsTable() {
        let client;
        try {
            client = await this.db.pool.connect();
            
            // Check if table exists first to avoid race conditions with sequences
            const checkTableQuery = `
                SELECT EXISTS (
                    SELECT FROM information_schema.tables 
                    WHERE table_name = 'payments'
                );
            `;
            const tableCheck = await client.query(checkTableQuery);
            
            if (!tableCheck.rows[0].exists) {
                console.log('Creating payments table...');
                const createTableQuery = `
                    CREATE TABLE IF NOT EXISTS payments (
                        id SERIAL PRIMARY KEY,
                        user_email VARCHAR(255) NOT NULL,
                        payment_id VARCHAR(255) UNIQUE,
                        razorpay_payment_id VARCHAR(255),
                        razorpay_order_id VARCHAR(255),
                        plan_type VARCHAR(50) NOT NULL,
                        amount DECIMAL(10,2) NOT NULL,
                        currency VARCHAR(3) DEFAULT 'INR',
                        status VARCHAR(50) NOT NULL DEFAULT 'pending',
                        payment_method VARCHAR(100),
                        payment_provider VARCHAR(100) DEFAULT 'razorpay',
                        subscription_id VARCHAR(255),
                        subscription_status VARCHAR(50),
                        subscription_expires_at TIMESTAMP,
                        webhook_received_at TIMESTAMP,
                        webhook_signature_verified BOOLEAN DEFAULT FALSE,
                        metadata JSONB DEFAULT '{}',
                        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                    );
                `;
                await client.query(createTableQuery);

                // Create indexes
                await client.query('CREATE INDEX IF NOT EXISTS idx_payments_user_email ON payments(user_email);');
                await client.query('CREATE INDEX IF NOT EXISTS idx_payments_status ON payments(status);');
                await client.query('CREATE INDEX IF NOT EXISTS idx_payments_created_at ON payments(created_at);');
                await client.query('CREATE INDEX IF NOT EXISTS idx_payments_razorpay_payment_id ON payments(razorpay_payment_id);');
                await client.query('CREATE INDEX IF NOT EXISTS idx_payments_razorpay_order_id ON payments(razorpay_order_id);');
                console.log('Payments table and indexes created successfully');
            } else {
                // Table exists, ensures indexes exist anyway (safe)
                await client.query('CREATE INDEX IF NOT EXISTS idx_payments_user_email ON payments(user_email);');
            }
            
            return true;
        } catch (error) {
            // Ignore "relation already exists" or "duplicate key" errors during concurrent startup
            if (error.code === '42P07' || error.code === '23505') {
                return true;
            }
            console.error('Error creating payments table:', error);
            throw error;
        } finally {
            if (client) client.release();
        }
    }

    // Create a new payment record
    async createPayment(paymentData) {
        const {
            userEmail,
            paymentId,
            razorpayOrderId,
            planType,
            amount,
            currency = 'INR',
            paymentMethod,
            metadata = {}
        } = paymentData;

        const insertQuery = `
            INSERT INTO payments (
                user_email, payment_id, razorpay_order_id, plan_type, amount, currency, 
                payment_method, payment_provider, metadata
            )
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
            RETURNING *;
        `;

        const values = [
            userEmail,
            paymentId,
            razorpayOrderId,
            planType,
            amount,
            currency,
            paymentMethod || 'card',
            'razorpay',
            JSON.stringify(metadata)
        ];

        try {
            const result = await this.db.pool.query(insertQuery, values);
            return result.rows[0];
        } catch (error) {
            console.error('Error creating payment:', error);
            throw error;
        }
    }

    // Update payment status via webhook
    async updatePaymentViaWebhook(razorpayPaymentId, webhookData) {
        const updateQuery = `
            UPDATE payments 
            SET 
                razorpay_payment_id = $1,
                status = $2,
                payment_method = $3,
                webhook_received_at = CURRENT_TIMESTAMP,
                webhook_signature_verified = $4,
                metadata = $5,
                updated_at = CURRENT_TIMESTAMP
            WHERE razorpay_order_id = $6
            RETURNING *;
        `;

        const values = [
            razorpayPaymentId,
            webhookData.status,
            webhookData.method,
            webhookData.signature_verified || false,
            JSON.stringify(webhookData),
            webhookData.order_id
        ];

        try {
            const result = await this.db.pool.query(updateQuery, values);
            return result.rows[0];
        } catch (error) {
            console.error('Error updating payment via webhook:', error);
            throw error;
        }
    }

    // Get payment by Razorpay payment ID
    async getPaymentByRazorpayId(razorpayPaymentId) {
        const query = `
            SELECT * FROM payments 
            WHERE razorpay_payment_id = $1
        `;

        try {
            const result = await this.db.pool.query(query, [razorpayPaymentId]);
            return result.rows[0];
        } catch (error) {
            console.error('Error getting payment by Razorpay ID:', error);
            throw error;
        }
    }

    // Get payment by Razorpay order ID
    async getPaymentByOrderId(razorpayOrderId) {
        const query = `
            SELECT * FROM payments 
            WHERE razorpay_order_id = $1
        `;

        try {
            const result = await this.db.pool.query(query, [razorpayOrderId]);
            return result.rows[0];
        } catch (error) {
            console.error('Error getting payment by order ID:', error);
            throw error;
        }
    }

    // Update payment status
    async updatePaymentStatus(paymentId, status, metadata = {}) {
        const updateQuery = `
            UPDATE payments 
            SET status = $1, metadata = $2, updated_at = CURRENT_TIMESTAMP
            WHERE payment_id = $3
            RETURNING *;
        `;

        try {
            const result = await this.db.pool.query(updateQuery, [status, JSON.stringify(metadata), paymentId]);
            return result.rows[0];
        } catch (error) {
            console.error('Error updating payment status:', error);
            throw error;
        }
    }

    // Get payment by ID
    async getPayment(paymentId) {
        const query = `
            SELECT * FROM payments 
            WHERE payment_id = $1
        `;

        try {
            const result = await this.db.pool.query(query, [paymentId]);
            return result.rows[0];
        } catch (error) {
            console.error('Error getting payment:', error);
            throw error;
        }
    }

    // Get user's payment history
    async getUserPayments(userEmail, limit = 20, offset = 0) {
        const query = `
            SELECT * FROM payments 
            WHERE user_email = $1
            ORDER BY created_at DESC
            LIMIT $2 OFFSET $3
        `;

        try {
            const result = await this.db.pool.query(query, [userEmail, limit, offset]);
            return result.rows;
        } catch (error) {
            console.error('Error getting user payments:', error);
            throw error;
        }
    }

    // Get user's active subscription
    async getUserActiveSubscription(userEmail) {
        const query = `
            SELECT * FROM payments 
            WHERE user_email = $1 
            AND status = 'captured'
            AND subscription_status = 'active'
            AND (subscription_expires_at IS NULL OR subscription_expires_at > NOW())
            ORDER BY created_at DESC
            LIMIT 1
        `;

        try {
            const result = await this.db.pool.query(query, [userEmail]);
            return result.rows[0];
        } catch (error) {
            console.error('Error getting user active subscription:', error);
            throw error;
        }
    }

    // Create subscription after successful payment
    async createSubscription(userEmail, planType, razorpayPaymentId) {
        const subscriptionExpiresAt = this.calculateSubscriptionExpiry(planType);
        
        const updateQuery = `
            UPDATE payments 
            SET subscription_id = $1, subscription_status = 'active', subscription_expires_at = $2
            WHERE razorpay_payment_id = $3
            RETURNING *;
        `;

        const subscriptionId = `sub_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;

        try {
            const result = await this.db.pool.query(updateQuery, [subscriptionId, subscriptionExpiresAt, razorpayPaymentId]);
            return result.rows[0];
        } catch (error) {
            console.error('Error creating subscription:', error);
            throw error;
        }
    }

    // Calculate subscription expiry based on plan type
    calculateSubscriptionExpiry(planType) {
        const now = new Date();
        switch (planType) {
            case 'monthly':
                return new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000); // 30 days
            case 'yearly':
                return new Date(now.getTime() + 365 * 24 * 60 * 60 * 1000); // 365 days
            case 'basic':
                return new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000); // 30 days
            case 'pro':
                return new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000); // 30 days
            default:
                return new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000); // 30 days
        }
    }

    // Get payment statistics
    async getPaymentStatistics(userEmail = null) {
        let query;
        let values = [];

        if (userEmail) {
            query = `
                SELECT 
                    COUNT(*) as total_payments,
                    COUNT(CASE WHEN status = 'captured' THEN 1 END) as successful_payments,
                    COUNT(CASE WHEN status = 'failed' THEN 1 END) as failed_payments,
                    COUNT(CASE WHEN status IN ('created', 'authorized') THEN 1 END) as pending_payments,
                    SUM(CASE WHEN status = 'captured' THEN amount ELSE 0 END) as total_revenue,
                    COUNT(CASE WHEN subscription_status = 'active' THEN 1 END) as active_subscriptions
                FROM payments 
                WHERE user_email = $1
            `;
            values = [userEmail];
        } else {
            query = `
                SELECT 
                    COUNT(*) as total_payments,
                    COUNT(CASE WHEN status = 'captured' THEN 1 END) as successful_payments,
                    COUNT(CASE WHEN status = 'failed' THEN 1 END) as failed_payments,
                    COUNT(CASE WHEN status IN ('created', 'authorized') THEN 1 END) as pending_payments,
                    SUM(CASE WHEN status = 'captured' THEN amount ELSE 0 END) as total_revenue,
                    COUNT(CASE WHEN subscription_status = 'active' THEN 1 END) as active_subscriptions
                FROM payments
            `;
        }

        try {
            const result = await this.db.pool.query(query, values);
            return result.rows[0];
        } catch (error) {
            console.error('Error getting payment statistics:', error);
            throw error;
        }
    }

    // Get webhook events for debugging
    async getWebhookEvents(limit = 50) {
        const query = `
            SELECT 
                payment_id,
                razorpay_payment_id,
                razorpay_order_id,
                status,
                webhook_received_at,
                webhook_signature_verified,
                metadata
            FROM payments 
            WHERE webhook_received_at IS NOT NULL
            ORDER BY webhook_received_at DESC
            LIMIT $1
        `;

        try {
            const result = await this.db.pool.query(query, [limit]);
            return result.rows;
        } catch (error) {
            console.error('Error getting webhook events:', error);
            throw error;
        }
    }
}

module.exports = Payment;
