/**
 * CampaignExecution Model
 * Tracks individual message delivery attempts for each lead
 */

class CampaignExecution {
    constructor(databaseService) {
        this.db = databaseService;
        if (!this.db || !this.db.pool) {
            console.error('Database service not properly initialized');
            throw new Error('Database service is required');
        }
    }

    async createTable() {
        let client;
        try {
            client = await this.db.pool.connect();
            
            const checkTableQuery = `
                SELECT EXISTS (
                    SELECT FROM information_schema.tables 
                    WHERE table_name = 'campaign_executions'
                );
            `;
            const tableCheck = await client.query(checkTableQuery);
            
            if (!tableCheck.rows[0].exists) {
                console.log('Creating campaign_executions table...');
                const createTableQuery = `
                    CREATE TABLE IF NOT EXISTS campaign_executions (
                        id SERIAL PRIMARY KEY,
                        execution_id VARCHAR(255) UNIQUE NOT NULL,
                        campaign_id VARCHAR(255) NOT NULL,
                        lead_id VARCHAR(255) NOT NULL,
                        user_email VARCHAR(255) NOT NULL,
                        campaign_type VARCHAR(50) NOT NULL,
                        contact_channel VARCHAR(50),
                        lead_email VARCHAR(255),
                        lead_phone VARCHAR(20),
                        lead_name VARCHAR(255),
                        business_name VARCHAR(255),
                        message_template TEXT,
                        rendered_message TEXT,
                        status VARCHAR(50) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'sent', 'delivered', 'failed', 'bounced', 'read')),
                        provider_message_id VARCHAR(255),
                        retry_count INTEGER DEFAULT 0,
                        error_message TEXT,
                        sent_at TIMESTAMP,
                        delivered_at TIMESTAMP,
                        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                    );
                `;
                await client.query(createTableQuery);

                // Create indexes
                await client.query('CREATE INDEX IF NOT EXISTS idx_campaign_executions_id ON campaign_executions(execution_id);');
                await client.query('CREATE INDEX IF NOT EXISTS idx_campaign_executions_campaign ON campaign_executions(campaign_id);');
                await client.query('CREATE INDEX IF NOT EXISTS idx_campaign_executions_lead ON campaign_executions(lead_id);');
                await client.query('CREATE INDEX IF NOT EXISTS idx_campaign_executions_status ON campaign_executions(status);');
                await client.query('CREATE INDEX IF NOT EXISTS idx_campaign_executions_user ON campaign_executions(user_email);');
                await client.query('CREATE INDEX IF NOT EXISTS idx_campaign_executions_created ON campaign_executions(created_at);');
                console.log('campaign_executions table created successfully');
            }
            
            return true;
        } catch (error) {
            if (error.code === '42P07' || error.code === '23505') {
                return true;
            }
            console.error('Error creating campaign_executions table:', error);
            throw error;
        } finally {
            if (client) client.release();
        }
    }

    async createExecution(executionData) {
        const {
            executionId,
            campaignId,
            leadId,
            userEmail,
            campaignType,
            contactChannel,
            leadEmail,
            leadPhone,
            leadName,
            businessName,
            messageTemplate,
            renderedMessage
        } = executionData;

        const query = `
            INSERT INTO campaign_executions (
                execution_id, campaign_id, lead_id, user_email, campaign_type, contact_channel,
                lead_email, lead_phone, lead_name, business_name, message_template, rendered_message, status
            )
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, 'pending')
            RETURNING *;
        `;

        try {
            const result = await this.db.pool.query(query, [
                executionId,
                campaignId,
                leadId,
                userEmail,
                campaignType,
                contactChannel,
                leadEmail,
                leadPhone,
                leadName,
                businessName,
                messageTemplate,
                renderedMessage
            ]);

            return result.rows[0];
        } catch (error) {
            console.error('Error creating execution:', error);
            throw error;
        }
    }

    async getExecutionById(executionId) {
        const query = 'SELECT * FROM campaign_executions WHERE execution_id = $1;';
        try {
            const result = await this.db.pool.query(query, [executionId]);
            return result.rows[0] || null;
        } catch (error) {
            console.error('Error fetching execution:', error);
            throw error;
        }
    }

    async getCampaignExecutions(campaignId, filters = {}) {
        let query = 'SELECT * FROM campaign_executions WHERE campaign_id = $1';
        const params = [campaignId];
        let paramIndex = 2;

        if (filters.status) {
            query += ` AND status = $${paramIndex}`;
            params.push(filters.status);
            paramIndex++;
        }

        query += ' ORDER BY created_at DESC;';

        try {
            const result = await this.db.pool.query(query, params);
            return result.rows;
        } catch (error) {
            console.error('Error fetching campaign executions:', error);
            throw error;
        }
    }

    async updateExecutionStatus(executionId, status, updates = {}) {
        const {
            providerMessageId,
            errorMessage,
            retryCount,
            deliveredAt
        } = updates;

        let query = `
            UPDATE campaign_executions 
            SET status = $1, updated_at = CURRENT_TIMESTAMP
        `;
        const params = [status, executionId];
        let paramIndex = 3;

        if (status === 'sent' && !updates.sentAt) {
            query += `, sent_at = CURRENT_TIMESTAMP`;
        }

        if (providerMessageId) {
            query += `, provider_message_id = $${paramIndex}`;
            params.splice(1, 0, providerMessageId);
            paramIndex++;
        }

        if (errorMessage) {
            query += `, error_message = $${paramIndex}`;
            params.splice(1, 0, errorMessage);
            paramIndex++;
        }

        if (retryCount !== undefined) {
            query += `, retry_count = $${paramIndex}`;
            params.splice(1, 0, retryCount);
            paramIndex++;
        }

        if (deliveredAt) {
            query += `, delivered_at = $${paramIndex}`;
            params.splice(1, 0, deliveredAt);
            paramIndex++;
        }

        query += ` WHERE execution_id = $${paramIndex} RETURNING *;`;
        params.push(executionId);

        try {
            const result = await this.db.pool.query(query, params);
            return result.rows[0];
        } catch (error) {
            console.error('Error updating execution status:', error);
            throw error;
        }
    }

    async getCampaignStats(campaignId) {
        const query = `
            SELECT 
                COUNT(*) as total,
                COUNT(CASE WHEN status = 'sent' THEN 1 END) as sent,
                COUNT(CASE WHEN status = 'delivered' THEN 1 END) as delivered,
                COUNT(CASE WHEN status = 'failed' THEN 1 END) as failed,
                COUNT(CASE WHEN status = 'bounced' THEN 1 END) as bounced,
                COUNT(CASE WHEN status = 'read' THEN 1 END) as read
            FROM campaign_executions
            WHERE campaign_id = $1;
        `;

        try {
            const result = await this.db.pool.query(query, [campaignId]);
            return result.rows[0];
        } catch (error) {
            console.error('Error fetching campaign stats:', error);
            throw error;
        }
    }

    async getPendingExecutions(limit = 100) {
        const query = `
            SELECT * FROM campaign_executions 
            WHERE status = 'pending' 
            ORDER BY created_at ASC 
            LIMIT $1;
        `;

        try {
            const result = await this.db.pool.query(query, [limit]);
            return result.rows;
        } catch (error) {
            console.error('Error fetching pending executions:', error);
            throw error;
        }
    }

    async getFailedExecutions(maxRetries = 3) {
        const query = `
            SELECT * FROM campaign_executions 
            WHERE status = 'failed' AND retry_count < $1
            ORDER BY updated_at ASC;
        `;

        try {
            const result = await this.db.pool.query(query, [maxRetries]);
            return result.rows;
        } catch (error) {
            console.error('Error fetching failed executions:', error);
            throw error;
        }
    }
}

module.exports = CampaignExecution;
