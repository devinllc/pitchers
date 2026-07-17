/**
 * LeadSource Model
 * Tracks different data sources for leads (Google Maps, LinkedIn, Twitter, Instagram, Facebook, TikTok)
 */

class LeadSource {
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
                    WHERE table_name = 'leads_sources'
                );
            `;
            const tableCheck = await client.query(checkTableQuery);
            
            if (!tableCheck.rows[0].exists) {
                console.log('Creating leads_sources table...');
                const createTableQuery = `
                    CREATE TABLE IF NOT EXISTS leads_sources (
                        id SERIAL PRIMARY KEY,
                        source_id VARCHAR(255) UNIQUE NOT NULL,
                        user_email VARCHAR(255) NOT NULL,
                        source_name VARCHAR(255) NOT NULL,
                        source_type VARCHAR(50) NOT NULL CHECK (source_type IN ('google_maps', 'linkedin', 'twitter', 'instagram', 'facebook', 'tiktok', 'csv_import')),
                        search_query VARCHAR(255),
                        location VARCHAR(255),
                        total_leads INTEGER DEFAULT 0,
                        extracted_leads INTEGER DEFAULT 0,
                        status VARCHAR(50) DEFAULT 'pending' CHECK (status IN ('pending', 'extracting', 'completed', 'failed')),
                        config JSONB DEFAULT '{}',
                        metadata JSONB DEFAULT '{}',
                        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                    );
                `;
                await client.query(createTableQuery);

                // Create indexes
                await client.query('CREATE INDEX IF NOT EXISTS idx_leads_sources_id ON leads_sources(source_id);');
                await client.query('CREATE INDEX IF NOT EXISTS idx_leads_sources_user ON leads_sources(user_email);');
                await client.query('CREATE INDEX IF NOT EXISTS idx_leads_sources_type ON leads_sources(source_type);');
                await client.query('CREATE INDEX IF NOT EXISTS idx_leads_sources_status ON leads_sources(status);');
                console.log('leads_sources table created successfully');
            }
            
            return true;
        } catch (error) {
            if (error.code === '42P07' || error.code === '23505') {
                return true;
            }
            console.error('Error creating leads_sources table:', error);
            throw error;
        } finally {
            if (client) client.release();
        }
    }

    async createSource(sourceData) {
        const {
            sourceId,
            userEmail,
            sourceName,
            sourceType,
            searchQuery,
            location,
            config = {},
            metadata = {}
        } = sourceData;

        const query = `
            INSERT INTO leads_sources (
                source_id, user_email, source_name, source_type, search_query, 
                location, config, metadata, status
            )
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'pending')
            RETURNING *;
        `;

        try {
            const result = await this.db.pool.query(query, [
                sourceId,
                userEmail,
                sourceName,
                sourceType,
                searchQuery,
                location,
                JSON.stringify(config),
                JSON.stringify(metadata)
            ]);

            if (result.rows[0]) {
                result.rows[0].config = JSON.parse(result.rows[0].config);
                result.rows[0].metadata = JSON.parse(result.rows[0].metadata);
            }

            return result.rows[0];
        } catch (error) {
            console.error('Error creating lead source:', error);
            throw error;
        }
    }

    async getSourceById(sourceId) {
        const query = 'SELECT * FROM leads_sources WHERE source_id = $1;';
        try {
            const result = await this.db.pool.query(query, [sourceId]);
            if (result.rows[0]) {
                result.rows[0].config = JSON.parse(result.rows[0].config);
                result.rows[0].metadata = JSON.parse(result.rows[0].metadata);
            }
            return result.rows[0] || null;
        } catch (error) {
            console.error('Error fetching lead source:', error);
            throw error;
        }
    }

    async getSourcesByUser(userEmail) {
        const query = 'SELECT * FROM leads_sources WHERE user_email = $1 ORDER BY created_at DESC;';
        try {
            const result = await this.db.pool.query(query, [userEmail]);
            return result.rows.map(row => {
                row.config = JSON.parse(row.config);
                row.metadata = JSON.parse(row.metadata);
                return row;
            });
        } catch (error) {
            console.error('Error fetching user lead sources:', error);
            throw error;
        }
    }

    async updateSourceStatus(sourceId, status, updates = {}) {
        const { totalLeads, extractedLeads } = updates;

        let query = `
            UPDATE leads_sources 
            SET status = $1, updated_at = CURRENT_TIMESTAMP
        `;
        const params = [status, sourceId];
        let paramIndex = 3;

        if (totalLeads !== undefined) {
            query += `, total_leads = $${paramIndex}`;
            params.splice(1, 0, totalLeads);
            paramIndex++;
        }

        if (extractedLeads !== undefined) {
            query += `, extracted_leads = $${paramIndex}`;
            params.splice(1, 0, extractedLeads);
            paramIndex++;
        }

        query += ` WHERE source_id = $${paramIndex} RETURNING *;`;
        params.push(sourceId);

        try {
            const result = await this.db.pool.query(query, params);
            if (result.rows[0]) {
                result.rows[0].config = JSON.parse(result.rows[0].config);
                result.rows[0].metadata = JSON.parse(result.rows[0].metadata);
            }
            return result.rows[0];
        } catch (error) {
            console.error('Error updating source status:', error);
            throw error;
        }
    }

    async deleteSource(sourceId) {
        const query = 'DELETE FROM leads_sources WHERE source_id = $1 RETURNING source_id;';
        try {
            const result = await this.db.pool.query(query, [sourceId]);
            return result.rowCount > 0;
        } catch (error) {
            console.error('Error deleting lead source:', error);
            throw error;
        }
    }
}

module.exports = LeadSource;
