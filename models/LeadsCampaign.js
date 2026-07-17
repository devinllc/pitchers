/**
 * LeadsCampaign Model
 * Manages multi-channel automation campaigns (WhatsApp, Email, SMS)
 */

class LeadsCampaign {
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
                    WHERE table_name = 'leads_campaigns'
                );
            `;
            const tableCheck = await client.query(checkTableQuery);
            
            if (!tableCheck.rows[0].exists) {
                console.log('Creating leads_campaigns table...');
                const createTableQuery = `
                    CREATE TABLE IF NOT EXISTS leads_campaigns (
                        id SERIAL PRIMARY KEY,
                        campaign_id VARCHAR(255) UNIQUE NOT NULL,
                        user_email VARCHAR(255) NOT NULL,
                        campaign_name VARCHAR(255) NOT NULL,
                        campaign_type VARCHAR(50) NOT NULL CHECK (campaign_type IN ('email', 'sms', 'whatsapp')),
                        lead_source_id VARCHAR(255),
                        template_id VARCHAR(255),
                        total_leads INTEGER DEFAULT 0,
                        status VARCHAR(50) NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'running', 'paused', 'completed', 'failed')),
                        config JSONB DEFAULT '{}',
                        metadata JSONB DEFAULT '{}',
                        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                    );
                `;
                await client.query(createTableQuery);

                // Create indexes
                await client.query('CREATE INDEX IF NOT EXISTS idx_leads_campaigns_campaign_id ON leads_campaigns(campaign_id);');
                await client.query('CREATE INDEX IF NOT EXISTS idx_leads_campaigns_user_email ON leads_campaigns(user_email);');
                await client.query('CREATE INDEX IF NOT EXISTS idx_leads_campaigns_status ON leads_campaigns(status);');
                await client.query('CREATE INDEX IF NOT EXISTS idx_leads_campaigns_type ON leads_campaigns(campaign_type);');
                await client.query('CREATE INDEX IF NOT EXISTS idx_leads_campaigns_created_at ON leads_campaigns(created_at);');
                console.log('leads_campaigns table created successfully');
            }
            
            return true;
        } catch (error) {
            if (error.code === '42P07' || error.code === '23505') {
                return true;
            }
            console.error('Error creating leads_campaigns table:', error);
            throw error;
        } finally {
            if (client) client.release();
        }
    }

    async createCampaign(campaignData) {
        const {
            campaignId,
            userEmail,
            campaignName,
            campaignType, // 'email', 'sms', 'whatsapp'
            leadSourceId,
            templateId,
            totalLeads,
            config = {},
            metadata = {}
        } = campaignData;

        const query = `
            INSERT INTO leads_campaigns (
                campaign_id, user_email, campaign_name, campaign_type, lead_source_id, 
                template_id, total_leads, config, metadata, status
            )
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'draft')
            RETURNING *;
        `;

        try {
            const result = await this.db.pool.query(query, [
                campaignId,
                userEmail,
                campaignName,
                campaignType,
                leadSourceId,
                templateId,
                totalLeads,
                JSON.stringify(config),
                JSON.stringify(metadata)
            ]);

            return result.rows[0];
        } catch (error) {
            console.error('Error creating campaign:', error);
            throw error;
        }
    }

    async getCampaignById(campaignId) {
        const query = 'SELECT * FROM leads_campaigns WHERE campaign_id = $1;';
        try {
            const result = await this.db.pool.query(query, [campaignId]);
            if (result.rows[0]) {
                result.rows[0].config = JSON.parse(result.rows[0].config);
                result.rows[0].metadata = JSON.parse(result.rows[0].metadata);
            }
            return result.rows[0] || null;
        } catch (error) {
            console.error('Error fetching campaign:', error);
            throw error;
        }
    }

    async getCampaignsByUser(userEmail, filters = {}) {
        let query = 'SELECT * FROM leads_campaigns WHERE user_email = $1';
        const params = [userEmail];
        let paramIndex = 2;

        if (filters.status) {
            query += ` AND status = $${paramIndex}`;
            params.push(filters.status);
            paramIndex++;
        }

        if (filters.campaign_type) {
            query += ` AND campaign_type = $${paramIndex}`;
            params.push(filters.campaign_type);
            paramIndex++;
        }

        query += ' ORDER BY created_at DESC;';

        try {
            const result = await this.db.pool.query(query, params);
            return result.rows.map(row => {
                row.config = JSON.parse(row.config);
                row.metadata = JSON.parse(row.metadata);
                return row;
            });
        } catch (error) {
            console.error('Error fetching campaigns:', error);
            throw error;
        }
    }

    async updateCampaignStatus(campaignId, status) {
        const query = `
            UPDATE leads_campaigns 
            SET status = $1, updated_at = CURRENT_TIMESTAMP
            WHERE campaign_id = $2
            RETURNING *;
        `;

        try {
            const result = await this.db.pool.query(query, [status, campaignId]);
            if (result.rows[0]) {
                result.rows[0].config = JSON.parse(result.rows[0].config);
                result.rows[0].metadata = JSON.parse(result.rows[0].metadata);
            }
            return result.rows[0];
        } catch (error) {
            console.error('Error updating campaign status:', error);
            throw error;
        }
    }

    async updateCampaignConfig(campaignId, config) {
        const query = `
            UPDATE leads_campaigns 
            SET config = $1, updated_at = CURRENT_TIMESTAMP
            WHERE campaign_id = $2
            RETURNING *;
        `;

        try {
            const result = await this.db.pool.query(query, [JSON.stringify(config), campaignId]);
            if (result.rows[0]) {
                result.rows[0].config = JSON.parse(result.rows[0].config);
                result.rows[0].metadata = JSON.parse(result.rows[0].metadata);
            }
            return result.rows[0];
        } catch (error) {
            console.error('Error updating campaign config:', error);
            throw error;
        }
    }

    async deleteCampaign(campaignId) {
        const query = 'DELETE FROM leads_campaigns WHERE campaign_id = $1 RETURNING campaign_id;';
        try {
            const result = await this.db.pool.query(query, [campaignId]);
            return result.rowCount > 0;
        } catch (error) {
            console.error('Error deleting campaign:', error);
            throw error;
        }
    }
}

module.exports = LeadsCampaign;
