const crypto = require('crypto');

class ApiKey {
    constructor(databaseService) {
        this.db = databaseService;
    }

    // Create API keys table
    async createApiKeysTable() {
        let client;
        try {
            client = await this.db.pool.connect();
            
            // Check if table exists first to avoid race conditions with sequences
            const checkTableQuery = `
                SELECT EXISTS (
                    SELECT FROM information_schema.tables 
                    WHERE table_name = 'api_keys'
                );
            `;
            const tableCheck = await client.query(checkTableQuery);
            
            if (!tableCheck.rows[0].exists) {
                console.log('Creating API keys table...');
                // Create table with proper structure
                const createTableQuery = `
                    CREATE TABLE IF NOT EXISTS api_keys (
                        id SERIAL PRIMARY KEY,
                        api_key VARCHAR(64) UNIQUE NOT NULL,
                        user_email VARCHAR(255) NOT NULL,
                        plan_type VARCHAR(50) NOT NULL DEFAULT 'free',
                        usage_limit INTEGER NOT NULL DEFAULT 100,
                        usage_count INTEGER NOT NULL DEFAULT 0,
                        rate_limit_per_minute INTEGER NOT NULL DEFAULT 10,
                        automation_limit INTEGER NOT NULL DEFAULT 5,
                        auto_reply_limit INTEGER NOT NULL DEFAULT 10,
                        whatsapp_campaign_limit INTEGER NOT NULL DEFAULT 5,
                        email_campaign_limit INTEGER NOT NULL DEFAULT 5,
                        whatsapp_send_limit INTEGER NOT NULL DEFAULT 100,
                        email_send_limit INTEGER NOT NULL DEFAULT 100,
                        is_active BOOLEAN NOT NULL DEFAULT true,
                        expires_at TIMESTAMP,
                        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                        last_used_at TIMESTAMP
                    );
                `;
                
                await client.query(createTableQuery);

                // Create indexes separately
                await client.query('CREATE INDEX IF NOT EXISTS idx_api_keys_key ON api_keys(api_key);');
                await client.query('CREATE INDEX IF NOT EXISTS idx_api_keys_user_email ON api_keys(user_email);');
                await client.query('CREATE INDEX IF NOT EXISTS idx_api_keys_active ON api_keys(is_active);');
                console.log('API Keys table and indexes created successfully');
            } else {
                // Table exists, ensures indexes exist anyway (safe)
                await client.query('CREATE INDEX IF NOT EXISTS idx_api_keys_key ON api_keys(api_key);');
                await client.query('CREATE INDEX IF NOT EXISTS idx_api_keys_user_email ON api_keys(user_email);');
                
                // Add any missing columns to existing table
                console.log('Ensuring all columns exist in api_keys table...');
                await client.query('ALTER TABLE api_keys ADD COLUMN IF NOT EXISTS automation_limit INTEGER NOT NULL DEFAULT 5;');
                await client.query('ALTER TABLE api_keys ADD COLUMN IF NOT EXISTS auto_reply_limit INTEGER NOT NULL DEFAULT 10;');
                await client.query('ALTER TABLE api_keys ADD COLUMN IF NOT EXISTS whatsapp_campaign_limit INTEGER NOT NULL DEFAULT 5;');
                await client.query('ALTER TABLE api_keys ADD COLUMN IF NOT EXISTS email_campaign_limit INTEGER NOT NULL DEFAULT 5;');
                await client.query('ALTER TABLE api_keys ADD COLUMN IF NOT EXISTS whatsapp_send_limit INTEGER NOT NULL DEFAULT 100;');
                await client.query('ALTER TABLE api_keys ADD COLUMN IF NOT EXISTS email_send_limit INTEGER NOT NULL DEFAULT 100;');
                console.log('API Keys table schema synced successfully');
            }
            
            return true;
        } catch (error) {
            // Ignore "relation already exists" or "duplicate key" errors during concurrent startup
            if (error.code === '42P07' || error.code === '23505') {
                return true;
            }
            console.error('Error creating API keys table:', error);
            throw error;
        } finally {
            if (client) client.release();
        }
    }

    // Generate a new API key
    generateApiKey() {
        return 'pk_' + crypto.randomBytes(28).toString('hex');
    }

    // Create a new API key
    async createApiKey(userEmail, planType = 'free') {
        const planLimits = this.getPlanLimits(planType);
        const apiKey = this.generateApiKey();
        
        const insertQuery = `
            INSERT INTO api_keys (
                api_key, user_email, plan_type, usage_limit, rate_limit_per_minute, 
                automation_limit, auto_reply_limit, 
                whatsapp_campaign_limit, email_campaign_limit,
                whatsapp_send_limit, email_send_limit,
                expires_at
            )
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
            RETURNING *;
        `;

        const expiresAt = planType === 'free' || planType === 'trial' ? new Date(Date.now() + 30 * 24 * 60 * 60 * 1000) : null;
        const values = [
            apiKey,
            userEmail,
            planType,
            planLimits.usageLimit,
            planLimits.rateLimit,
            planLimits.automationLimit,
            planLimits.autoReplyLimit,
            planLimits.whatsappCampaignLimit,
            planLimits.emailCampaignLimit,
            planLimits.whatsappSendLimit,
            planLimits.emailSendLimit,
            expiresAt
        ];

        try {
            const result = await this.db.pool.query(insertQuery, values);
            return result.rows[0];
        } catch (error) {
            console.error('Error creating API key:', error);
            throw error;
        }
    }

    // Get plan limits based on plan type
    getPlanLimits(planType) {
        const plans = {
            free: {
                usageLimit: 100,
                rateLimit: 5,
                automationLimit: 5,
                autoReplyLimit: 10,
                whatsappCampaignLimit: 2,
                emailCampaignLimit: 2,
                whatsappSendLimit: 50,
                emailSendLimit: 50
            },
            trial: {
                usageLimit: 50,
                rateLimit: 10,
                automationLimit: 10,
                autoReplyLimit: 20,
                whatsappCampaignLimit: 5,
                emailCampaignLimit: 5,
                whatsappSendLimit: 100,
                emailSendLimit: 100
            },
            basic: {
                usageLimit: 2000,
                rateLimit: 20,
                automationLimit: 50,
                autoReplyLimit: 200,
                whatsappCampaignLimit: 10,
                emailCampaignLimit: 10,
                whatsappSendLimit: 500,
                emailSendLimit: 500
            },
            pro: {
                usageLimit: 10000,
                rateLimit: 50,
                automationLimit: 200,
                autoReplyLimit: 1000,
                whatsappCampaignLimit: 50,
                emailCampaignLimit: 50,
                whatsappSendLimit: 2500,
                emailSendLimit: 2500
            },
            enterprise: {
                usageLimit: 50000,
                rateLimit: 100,
                automationLimit: 1000,
                autoReplyLimit: 10000,
                whatsappCampaignLimit: 9999,
                emailCampaignLimit: 9999,
                whatsappSendLimit: 99999,
                emailSendLimit: 99999
            }
        };

        return plans[planType] || plans.free;
    }

    // Validate and get API key details
    async validateApiKey(apiKey) {
        const selectQuery = `
            SELECT * FROM api_keys 
            WHERE api_key = $1 AND is_active = true
            AND (expires_at IS NULL OR expires_at > NOW());
        `;

        try {
            const result = await this.db.pool.query(selectQuery, [apiKey]);
            
            if (result.rows.length === 0) {
                return null;
            }

            const keyData = result.rows[0];
            
            // Check usage limit
            if (keyData.usage_count >= keyData.usage_limit) {
                return { ...keyData, limitExceeded: true };
            }

            return keyData;
        } catch (error) {
            console.error('Error validating API key:', error);
            throw error;
        }
    }

    // Increment usage count
    async incrementUsage(apiKey) {
        const updateQuery = `
            UPDATE api_keys 
            SET usage_count = usage_count + 1, 
                last_used_at = NOW(),
                updated_at = NOW()
            WHERE api_key = $1
            RETURNING usage_count, usage_limit;
        `;

        try {
            const result = await this.db.pool.query(updateQuery, [apiKey]);
            return result.rows[0];
        } catch (error) {
            console.error('Error incrementing usage:', error);
            throw error;
        }
    }

    // Get API key usage statistics
    async getUsageStats(apiKey) {
        const selectQuery = `
            SELECT api_key, user_email, plan_type, usage_count, usage_limit, 
                   rate_limit_per_minute, is_active, expires_at, created_at, last_used_at,
                   automation_limit, auto_reply_limit, whatsapp_campaign_limit,
                   email_campaign_limit, whatsapp_send_limit, email_send_limit
            FROM api_keys 
            WHERE api_key = $1;
        `;

        try {
            const result = await this.db.pool.query(selectQuery, [apiKey]);
            return result.rows[0] || null;
        } catch (error) {
            console.error('Error getting usage stats:', error);
            throw error;
        }
    }

    // Update API key specific limits and features
    async updateLimits(apiKey, limits) {
        const {
            usageLimit,
            rateLimit,
            automationLimit,
            autoReplyLimit,
            whatsappCampaignLimit,
            emailCampaignLimit,
            whatsappSendLimit,
            emailSendLimit,
            isActive
        } = limits;
        
        const updateQuery = `
            UPDATE api_keys 
            SET usage_limit = COALESCE($1, usage_limit),
                rate_limit_per_minute = COALESCE($2, rate_limit_per_minute),
                automation_limit = COALESCE($3, automation_limit),
                auto_reply_limit = COALESCE($4, auto_reply_limit),
                whatsapp_campaign_limit = COALESCE($5, whatsapp_campaign_limit),
                email_campaign_limit = COALESCE($6, email_campaign_limit),
                whatsapp_send_limit = COALESCE($7, whatsapp_send_limit),
                email_send_limit = COALESCE($8, email_send_limit),
                is_active = COALESCE($9, is_active),
                updated_at = NOW()
            WHERE api_key = $10
            RETURNING *;
        `;
        
        try {
            const result = await this.db.pool.query(updateQuery, [
                usageLimit !== undefined ? parseInt(usageLimit) : null,
                rateLimit !== undefined ? parseInt(rateLimit) : null,
                automationLimit !== undefined ? parseInt(automationLimit) : null,
                autoReplyLimit !== undefined ? parseInt(autoReplyLimit) : null,
                whatsappCampaignLimit !== undefined ? parseInt(whatsappCampaignLimit) : null,
                emailCampaignLimit !== undefined ? parseInt(emailCampaignLimit) : null,
                whatsappSendLimit !== undefined ? parseInt(whatsappSendLimit) : null,
                emailSendLimit !== undefined ? parseInt(emailSendLimit) : null,
                isActive !== undefined ? isActive : null,
                apiKey
            ]);
            return result.rows[0];
        } catch (error) {
            console.error('Error updating API key limits:', error);
            throw error;
        }
    }

    // Update API key plan
    async updatePlan(apiKey, newPlanType) {
        const planLimits = this.getPlanLimits(newPlanType);
        const updateQuery = `
            UPDATE api_keys 
            SET plan_type = $1, 
                usage_limit = $2, 
                rate_limit_per_minute = $3,
                automation_limit = $4,
                auto_reply_limit = $5,
                whatsapp_campaign_limit = $6,
                email_campaign_limit = $7,
                whatsapp_send_limit = $8,
                email_send_limit = $9,
                expires_at = CASE 
                    WHEN $1 = 'free' OR $1 = 'trial' THEN NOW() + INTERVAL '30 days'
                    ELSE NULL 
                END,
                updated_at = NOW()
            WHERE api_key = $10
            RETURNING *;
        `;

        try {
            const result = await this.db.pool.query(updateQuery, [
                newPlanType,
                planLimits.usageLimit,
                planLimits.rateLimit,
                planLimits.automationLimit,
                planLimits.autoReplyLimit,
                planLimits.whatsappCampaignLimit,
                planLimits.emailCampaignLimit,
                planLimits.whatsappSendLimit,
                planLimits.emailSendLimit,
                apiKey
            ]);
            return result.rows[0];
        } catch (error) {
            console.error('Error updating plan:', error);
            throw error;
        }
    }

    // Deactivate API key
    async deactivateApiKey(apiKey) {
        const updateQuery = `
            UPDATE api_keys 
            SET is_active = false, updated_at = NOW()
            WHERE api_key = $1
            RETURNING *;
        `;

        try {
            const result = await this.db.pool.query(updateQuery, [apiKey]);
            return result.rows[0];
        } catch (error) {
            console.error('Error deactivating API key:', error);
            throw error;
        }
    }

    // Get all API keys for a user
    async getUserApiKeys(userEmail) {
        const selectQuery = `
            SELECT api_key, plan_type, usage_count, usage_limit, 
                   rate_limit_per_minute, is_active, expires_at, created_at, last_used_at,
                   automation_limit, auto_reply_limit, whatsapp_campaign_limit,
                   email_campaign_limit, whatsapp_send_limit, email_send_limit
            FROM api_keys 
            WHERE user_email = $1
            ORDER BY
                -- Non-expiring keys (expires_at IS NULL) first
                (expires_at IS NULL) DESC,
                -- Then keys that haven't expired yet
                (expires_at IS NOT NULL AND expires_at > NOW()) DESC,
                -- Then by usage_limit descending (higher-tier plans first)
                usage_limit DESC,
                created_at DESC;
        `;

        try {
            const result = await this.db.pool.query(selectQuery, [userEmail]);
            return result.rows;
        } catch (error) {
            console.error('Error getting user API keys:', error);
            throw error;
        }
    }

    // Reset usage count (for monthly resets)
    async resetUsageCount(apiKey) {
        const updateQuery = `
            UPDATE api_keys 
            SET usage_count = 0, updated_at = NOW()
            WHERE api_key = $1
            RETURNING *;
        `;

        try {
            const result = await this.db.pool.query(updateQuery, [apiKey]);
            return result.rows[0];
        } catch (error) {
            console.error('Error resetting usage count:', error);
            throw error;
        }
    }

    // Admin: get all API keys (for audit/ops dashboards)
    async getAllApiKeys() {
        const selectQuery = `
            SELECT id, api_key, user_email, plan_type, usage_count, usage_limit,
                   rate_limit_per_minute, is_active, expires_at, created_at, updated_at, last_used_at,
                   automation_limit, auto_reply_limit, whatsapp_campaign_limit,
                   email_campaign_limit, whatsapp_send_limit, email_send_limit
            FROM api_keys
            ORDER BY created_at DESC;
        `;

        try {
            const result = await this.db.pool.query(selectQuery);
            return result.rows;
        } catch (error) {
            console.error('Error getting all API keys:', error);
            throw error;
        }
    }

    // Admin: summary grouped by user
    async getUsersSummary() {
        const selectQuery = `
            SELECT 
                user_email,
                COUNT(*) AS total_keys,
                SUM(CASE WHEN is_active THEN 1 ELSE 0 END) AS active_keys,
                SUM(usage_count) AS total_usage,
                SUM(usage_limit) AS total_limit,
                MAX(rate_limit_per_minute) AS max_rate_limit,
                MIN(expires_at) FILTER (WHERE expires_at IS NOT NULL) AS nearest_expiry,
                MAX(last_used_at) AS last_activity,
                MIN(created_at) AS first_key_created,
                MAX(created_at) AS last_key_created
            FROM api_keys
            GROUP BY user_email
            ORDER BY last_activity DESC NULLS LAST, total_usage DESC;
        `;

        try {
            const result = await this.db.pool.query(selectQuery);
            return result.rows;
        } catch (error) {
            console.error('Error getting users summary:', error);
            throw error;
        }
    }
}

module.exports = ApiKey;
