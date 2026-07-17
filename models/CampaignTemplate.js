/**
 * CampaignTemplate Model
 * Manages message templates for WhatsApp, Email, SMS with variables
 */

class CampaignTemplate {
    constructor(databaseService) {
        this.db = databaseService;
        if (!this.db || !this.db.pool) {
            console.error('Database service not properly initialized');
            throw new Error('Database service is required');
        }
    }

    normalizeJsonField(value, fallback = null) {
        if (value === null || value === undefined) {
            return fallback;
        }

        if (typeof value === 'object') {
            return value;
        }

        try {
            return JSON.parse(value);
        } catch (error) {
            return fallback;
        }
    }

    async createTable() {
        let client;
        try {
            client = await this.db.pool.connect();
            
            const checkTableQuery = `
                SELECT EXISTS (
                    SELECT FROM information_schema.tables 
                    WHERE table_name = 'campaign_templates'
                );
            `;
            const tableCheck = await client.query(checkTableQuery);
            
            if (!tableCheck.rows[0].exists) {
                console.log('Creating campaign_templates table...');
                const createTableQuery = `
                    CREATE TABLE IF NOT EXISTS campaign_templates (
                        id SERIAL PRIMARY KEY,
                        template_id VARCHAR(255) UNIQUE NOT NULL,
                        user_email VARCHAR(255),
                        template_name VARCHAR(255) NOT NULL,
                        channel VARCHAR(50) NOT NULL CHECK (channel IN ('email', 'sms', 'whatsapp')),
                        template_text TEXT NOT NULL,
                        is_preset BOOLEAN DEFAULT FALSE,
                        variables JSONB DEFAULT '[]',
                        metadata JSONB DEFAULT '{}',
                        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                    );
                `;
                await client.query(createTableQuery);

                // Create indexes
                await client.query('CREATE INDEX IF NOT EXISTS idx_campaign_templates_id ON campaign_templates(template_id);');
                await client.query('CREATE INDEX IF NOT EXISTS idx_campaign_templates_channel ON campaign_templates(channel);');
                await client.query('CREATE INDEX IF NOT EXISTS idx_campaign_templates_preset ON campaign_templates(is_preset);');
                console.log('campaign_templates table created successfully');
            }
            
            return true;
        } catch (error) {
            if (error.code === '42P07' || error.code === '23505') {
                return true;
            }
            console.error('Error creating campaign_templates table:', error);
            throw error;
        } finally {
            if (client) client.release();
        }
    }

    async createTemplate(templateData) {
        const {
            templateId,
            userEmail,
            templateName,
            channel,
            templateText,
            isPreset = false,
            variables = [],
            metadata = {}
        } = templateData;

        const query = `
            INSERT INTO campaign_templates (
                template_id, user_email, template_name, channel, template_text, is_preset, variables, metadata
            )
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
            RETURNING *;
        `;

        try {
            const result = await this.db.pool.query(query, [
                templateId,
                userEmail,
                templateName,
                channel,
                templateText,
                isPreset,
                JSON.stringify(variables),
                JSON.stringify(metadata)
            ]);

            if (result.rows[0]) {
                result.rows[0].variables = this.normalizeJsonField(result.rows[0].variables, []);
                result.rows[0].metadata = this.normalizeJsonField(result.rows[0].metadata, {});
            }

            return result.rows[0];
        } catch (error) {
            console.error('Error creating template:', error);
            throw error;
        }
    }

    async getTemplateById(templateId) {
        const query = 'SELECT * FROM campaign_templates WHERE template_id = $1;';
        try {
            const result = await this.db.pool.query(query, [templateId]);
            if (result.rows[0]) {
                result.rows[0].variables = this.normalizeJsonField(result.rows[0].variables, []);
                result.rows[0].metadata = this.normalizeJsonField(result.rows[0].metadata, {});
            }
            return result.rows[0] || null;
        } catch (error) {
            console.error('Error fetching template:', error);
            throw error;
        }
    }

    async getTemplatesByChannel(channel, userEmail = null) {
        let query = 'SELECT * FROM campaign_templates WHERE channel = $1';
        const params = [channel];

        if (userEmail) {
            query += ' AND (user_email = $2 OR is_preset = TRUE) ORDER BY is_preset DESC, created_at DESC;';
            params.push(userEmail);
        } else {
            query += ' AND is_preset = TRUE ORDER BY created_at DESC;';
        }

        try {
            const result = await this.db.pool.query(query, params);
            return result.rows.map(row => {
                row.variables = this.normalizeJsonField(row.variables, []);
                row.metadata = this.normalizeJsonField(row.metadata, {});
                return row;
            });
        } catch (error) {
            console.error('Error fetching templates:', error);
            throw error;
        }
    }

    async getUserTemplates(userEmail, channel = null) {
        let query = 'SELECT * FROM campaign_templates WHERE user_email = $1';
        const params = [userEmail];

        if (channel) {
            query += ' AND channel = $2';
            params.push(channel);
        }

        query += ' ORDER BY created_at DESC;';

        try {
            const result = await this.db.pool.query(query, params);
            return result.rows.map(row => {
                row.variables = this.normalizeJsonField(row.variables, []);
                row.metadata = this.normalizeJsonField(row.metadata, {});
                return row;
            });
        } catch (error) {
            console.error('Error fetching user templates:', error);
            throw error;
        }
    }

    async updateTemplate(templateId, updates) {
        const { templateName, templateText, variables, metadata } = updates;

        const query = `
            UPDATE campaign_templates 
            SET 
                template_name = COALESCE($1, template_name),
                template_text = COALESCE($2, template_text),
                variables = COALESCE($3, variables),
                metadata = COALESCE($4, metadata),
                updated_at = CURRENT_TIMESTAMP
            WHERE template_id = $5
            RETURNING *;
        `;

        try {
            const result = await this.db.pool.query(query, [
                templateName,
                templateText,
                variables ? JSON.stringify(variables) : null,
                metadata ? JSON.stringify(metadata) : null,
                templateId
            ]);

            if (result.rows[0]) {
                result.rows[0].variables = this.normalizeJsonField(result.rows[0].variables, []);
                result.rows[0].metadata = this.normalizeJsonField(result.rows[0].metadata, {});
            }

            return result.rows[0];
        } catch (error) {
            console.error('Error updating template:', error);
            throw error;
        }
    }

    async countUserTemplates(userEmail, channel = null) {
        let query = 'SELECT COUNT(*) FROM campaign_templates WHERE user_email = $1';
        const params = [userEmail];

        if (channel) {
            query += ' AND channel = $2';
            params.push(channel);
        }

        try {
            const result = await this.db.pool.query(query, params);
            return parseInt(result.rows[0].count);
        } catch (error) {
            console.error('Error counting user templates:', error);
            throw error;
        }
    }

    async deleteTemplate(templateId) {
        const query = 'DELETE FROM campaign_templates WHERE template_id = $1 RETURNING template_id;';
        try {
            const result = await this.db.pool.query(query, [templateId]);
            return result.rowCount > 0;
        } catch (error) {
            console.error('Error deleting template:', error);
            throw error;
        }
    }
}

module.exports = CampaignTemplate;
