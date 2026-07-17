/**
 * WhatsAppConnection Model
 * Manages WhatsApp integration configurations (QR-connected account & Meta API credentials)
 */

class WhatsAppConnection {
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
                    WHERE table_name = 'whatsapp_connections'
                );
            `;
            const tableCheck = await client.query(checkTableQuery);
            
            if (!tableCheck.rows[0].exists) {
                console.log('Creating whatsapp_connections table...');
                const createTableQuery = `
                    CREATE TABLE IF NOT EXISTS whatsapp_connections (
                        id SERIAL PRIMARY KEY,
                        user_email VARCHAR(255) UNIQUE NOT NULL,
                        qr_enabled BOOLEAN DEFAULT FALSE,
                        qr_session_token TEXT,
                        qr_connected_phone VARCHAR(20),
                        qr_connected_at TIMESTAMP,
                        meta_api_enabled BOOLEAN DEFAULT FALSE,
                        meta_phone_number_id VARCHAR(255),
                        meta_business_account_id VARCHAR(255),
                        meta_api_token TEXT,
                        meta_verified_at TIMESTAMP,
                        active_mode VARCHAR(50) CHECK (active_mode IN ('qr', 'meta_api', 'none')),
                        is_active BOOLEAN DEFAULT FALSE,
                        last_message_sent_at TIMESTAMP,
                        metadata JSONB DEFAULT '{}',
                        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                    );
                `;
                await client.query(createTableQuery);

                // Create index
                await client.query('CREATE INDEX IF NOT EXISTS idx_whatsapp_connections_email ON whatsapp_connections(user_email);');
                await client.query('CREATE INDEX IF NOT EXISTS idx_whatsapp_connections_active ON whatsapp_connections(is_active);');
                console.log('whatsapp_connections table created successfully');
            }
            
            return true;
        } catch (error) {
            if (error.code === '42P07' || error.code === '23505') {
                return true;
            }
            console.error('Error creating whatsapp_connections table:', error);
            throw error;
        } finally {
            if (client) client.release();
        }
    }

    async getOrCreateConnection(userEmail) {
        let query = 'SELECT * FROM whatsapp_connections WHERE user_email = $1;';
        try {
            let result = await this.db.pool.query(query, [userEmail]);
            
            if (result.rows.length === 0) {
                // Create new connection
                const createQuery = `
                    INSERT INTO whatsapp_connections (user_email, active_mode)
                    VALUES ($1, 'none')
                    RETURNING *;
                `;
                result = await this.db.pool.query(createQuery, [userEmail]);
            }

            if (result.rows[0]) {
                if (typeof result.rows[0].metadata === 'string') { try { result.rows[0].metadata = JSON.parse(result.rows[0].metadata); } catch {} }
            }

            return result.rows[0];
        } catch (error) {
            console.error('Error getting/creating WhatsApp connection:', error);
            throw error;
        }
    }

    async updateQRConnection(userEmail, qrData) {
        const { sessionToken, connectedPhone, connectedAt } = qrData;

        const query = `
            UPDATE whatsapp_connections 
            SET 
                qr_enabled = TRUE,
                qr_session_token = $1,
                qr_connected_phone = $2,
                qr_connected_at = $3,
                active_mode = CASE WHEN meta_api_enabled = FALSE THEN 'qr' ELSE active_mode END,
                is_active = TRUE,
                updated_at = CURRENT_TIMESTAMP
            WHERE user_email = $4
            RETURNING *;
        `;

        try {
            const result = await this.db.pool.query(query, [
                sessionToken,
                connectedPhone,
                connectedAt || new Date(),
                userEmail
            ]);

            if (result.rows[0]) {
                if (typeof result.rows[0].metadata === 'string') { try { result.rows[0].metadata = JSON.parse(result.rows[0].metadata); } catch {} }
            }

            return result.rows[0];
        } catch (error) {
            console.error('Error updating QR connection:', error);
            throw error;
        }
    }

    async updateMetaAPIConnection(userEmail, metaData) {
        const { phoneNumberId, businessAccountId, apiToken, verifiedAt } = metaData;

        const query = `
            UPDATE whatsapp_connections 
            SET 
                meta_api_enabled = TRUE,
                meta_phone_number_id = $1,
                meta_business_account_id = $2,
                meta_api_token = $3,
                meta_verified_at = $4,
                active_mode = CASE WHEN qr_enabled = FALSE THEN 'meta_api' ELSE active_mode END,
                is_active = TRUE,
                updated_at = CURRENT_TIMESTAMP
            WHERE user_email = $5
            RETURNING *;
        `;

        try {
            const result = await this.db.pool.query(query, [
                phoneNumberId,
                businessAccountId,
                apiToken,
                verifiedAt || new Date(),
                userEmail
            ]);

            if (result.rows[0]) {
                if (typeof result.rows[0].metadata === 'string') { try { result.rows[0].metadata = JSON.parse(result.rows[0].metadata); } catch {} }
            }

            return result.rows[0];
        } catch (error) {
            console.error('Error updating Meta API connection:', error);
            throw error;
        }
    }

    async setActiveMode(userEmail, mode) {
        const query = `
            UPDATE whatsapp_connections 
            SET active_mode = $1, updated_at = CURRENT_TIMESTAMP
            WHERE user_email = $2
            RETURNING *;
        `;

        try {
            const result = await this.db.pool.query(query, [mode, userEmail]);
            if (result.rows[0]) {
                if (typeof result.rows[0].metadata === 'string') { try { result.rows[0].metadata = JSON.parse(result.rows[0].metadata); } catch {} }
            }
            return result.rows[0];
        } catch (error) {
            console.error('Error setting active mode:', error);
            throw error;
        }
    }

    async updateLastMessageSent(userEmail) {
        const query = `
            UPDATE whatsapp_connections 
            SET last_message_sent_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
            WHERE user_email = $1
            RETURNING *;
        `;

        try {
            const result = await this.db.pool.query(query, [userEmail]);
            if (result.rows[0]) {
                if (typeof result.rows[0].metadata === 'string') { try { result.rows[0].metadata = JSON.parse(result.rows[0].metadata); } catch {} }
            }
            return result.rows[0];
        } catch (error) {
            console.error('Error updating last message sent:', error);
            throw error;
        }
    }

    async updateMetadata(userEmail, metadata) {
        const query = `
            UPDATE whatsapp_connections 
            SET metadata = $1, updated_at = CURRENT_TIMESTAMP
            WHERE user_email = $2
            RETURNING *;
        `;
        try {
            const result = await this.db.pool.query(query, [metadata, userEmail]);
            if (result.rows[0]) {
                if (typeof result.rows[0].metadata === 'string') { try { result.rows[0].metadata = JSON.parse(result.rows[0].metadata); } catch {} }
            }
            return result.rows[0];
        } catch (error) {
            console.error('Error updating metadata:', error);
            throw error;
        }
    }

    async disableConnection(userEmail) {
        const query = `
            UPDATE whatsapp_connections 
            SET 
                is_active = FALSE,
                active_mode = 'none',
                updated_at = CURRENT_TIMESTAMP
            WHERE user_email = $1
            RETURNING *;
        `;

        try {
            const result = await this.db.pool.query(query, [userEmail]);
            if (result.rows[0]) {
                if (typeof result.rows[0].metadata === 'string') {
                    try { result.rows[0].metadata = JSON.parse(result.rows[0].metadata); } catch {}
                }
            }
            return result.rows[0];
        } catch (error) {
            console.error('Error disabling connection:', error);
            throw error;
        }
    }

    async getConnectionByEmail(userEmail) {
        const query = 'SELECT * FROM whatsapp_connections WHERE user_email = $1;';
        try {
            const result = await this.db.pool.query(query, [userEmail]);
            if (result.rows[0]) {
                if (typeof result.rows[0].metadata === 'string') {
                    try { result.rows[0].metadata = JSON.parse(result.rows[0].metadata); } catch {}
                }
            }
            return result.rows[0] || null;
        } catch (error) {
            console.error('Error fetching connection:', error);
            throw error;
        }
    }

    async getAllActiveConnections() {
        const query = `
            SELECT * FROM whatsapp_connections 
            WHERE is_active = TRUE AND active_mode = 'qr';
        `;
        try {
            const result = await this.db.pool.query(query);
            return result.rows.map(row => {
                if (typeof row.metadata === 'string') {
                    try { row.metadata = JSON.parse(row.metadata); } catch {}
                }
                return row;
            });
        } catch (error) {
            console.error('Error fetching all active connections:', error);
            return [];
        }
    }
}

module.exports = WhatsAppConnection;
