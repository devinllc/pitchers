/**
 * SmtpConnection Model
 * Manages SMTP configurations for email sending (Gmail, custom SMTP, etc.)
 */

class SmtpConnection {
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
                    WHERE table_name = 'smtp_connections'
                );
            `;
            const tableCheck = await client.query(checkTableQuery);
            
            if (!tableCheck.rows[0].exists) {
                console.log('Creating smtp_connections table...');
                const createTableQuery = `
                    CREATE TABLE IF NOT EXISTS smtp_connections (
                        id SERIAL PRIMARY KEY,
                        connection_id VARCHAR(255) UNIQUE NOT NULL,
                        user_email VARCHAR(255) NOT NULL,
                        provider_name VARCHAR(100),
                        username VARCHAR(255),
                        password TEXT,
                        smtp_host VARCHAR(255),
                        smtp_port INTEGER,
                        imap_host VARCHAR(255),
                        imap_port INTEGER,
                        encryption_type VARCHAR(50) CHECK (encryption_type IN ('TLS', 'SSL', 'NONE')),
                        is_default BOOLEAN DEFAULT FALSE,
                        is_active BOOLEAN DEFAULT TRUE,
                        verified_at TIMESTAMP,
                        daily_limit INTEGER DEFAULT 300,
                        daily_sent_count INTEGER DEFAULT 0,
                        daily_reset_at TIMESTAMP,
                        metadata JSONB DEFAULT '{}',
                        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                    );
                `;
                await client.query(createTableQuery);

                // Create indexes
                await client.query('CREATE INDEX IF NOT EXISTS idx_smtp_connections_id ON smtp_connections(connection_id);');
                await client.query('CREATE INDEX IF NOT EXISTS idx_smtp_connections_user ON smtp_connections(user_email);');
                await client.query('CREATE INDEX IF NOT EXISTS idx_smtp_connections_default ON smtp_connections(user_email, is_default);');
                await client.query('CREATE INDEX IF NOT EXISTS idx_smtp_connections_active ON smtp_connections(is_active);');
                console.log('smtp_connections table created successfully');
            }
            
            return true;
        } catch (error) {
            if (error.code === '42P07' || error.code === '23505') {
                return true;
            }
            console.error('Error creating smtp_connections table:', error);
            throw error;
        } finally {
            if (client) client.release();
        }
    }

    async createConnection(connectionData) {
        const {
            connectionId,
            userEmail,
            providerName,
            smtpHost,
            smtpPort,
            senderEmail,
            senderName,
            username,
            password,
            encryptionType = 'TLS',
            dailyLimit = 300,
            imapHost = null,
            imapPort = null
        } = connectionData;

        const query = `
            INSERT INTO smtp_connections (
                connection_id, user_email, provider_name, smtp_host, smtp_port, sender_email,
                sender_name, username, password, encryption_type, daily_limit, imap_host, imap_port
            )
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
            RETURNING *;
        `;

        try {
            const result = await this.db.pool.query(query, [
                connectionId,
                userEmail,
                providerName,
                smtpHost,
                smtpPort,
                senderEmail,
                senderName,
                username,
                password, // Should be encrypted before storing
                encryptionType,
                dailyLimit,
                imapHost,
                imapPort
            ]);

            if (result.rows[0]) {
                result.rows[0].metadata = typeof result.rows[0].metadata === 'string' ? JSON.parse(result.rows[0].metadata) : result.rows[0].metadata;
                // Never return password
                delete result.rows[0].password;
            }

            return result.rows[0];
        } catch (error) {
            console.error('Error creating SMTP connection:', error);
            throw error;
        }
    }

    async getConnectionById(connectionId) {
        const query = 'SELECT * FROM smtp_connections WHERE connection_id = $1;';
        try {
            const result = await this.db.pool.query(query, [connectionId]);
            if (result.rows[0]) {
                result.rows[0].metadata = typeof result.rows[0].metadata === 'string' ? JSON.parse(result.rows[0].metadata) : result.rows[0].metadata;
            }
            return result.rows[0] || null;
        } catch (error) {
            console.error('Error fetching SMTP connection:', error);
            throw error;
        }
    }

    async getConnectionsByUser(userEmail) {
        const query = `
            SELECT connection_id, user_email, provider_name, sender_email, sender_name,
                   smtp_host, smtp_port, encryption_type, is_default, is_active, verified_at,
                   daily_limit, daily_sent_count, created_at, updated_at
            FROM smtp_connections 
            WHERE user_email = $1 
            ORDER BY is_default DESC, created_at DESC;
        `;

        try {
            const result = await this.db.pool.query(query, [userEmail]);
            return result.rows;
        } catch (error) {
            console.error('Error fetching user SMTP connections:', error);
            throw error;
        }
    }

    async getDefaultConnection(userEmail) {
        const query = `
            SELECT connection_id, user_email, provider_name, sender_email, sender_name,
                   smtp_host, smtp_port, encryption_type, is_default, is_active, verified_at,
                   daily_limit, daily_sent_count, created_at, updated_at
            FROM smtp_connections 
            WHERE user_email = $1 AND is_default = TRUE AND is_active = TRUE
            LIMIT 1;
        `;

        try {
            const result = await this.db.pool.query(query, [userEmail]);
            return result.rows[0] || null;
        } catch (error) {
            console.error('Error fetching default SMTP connection:', error);
            throw error;
        }
    }

    async setDefaultConnection(connectionId, userEmail) {
        let client;
        try {
            client = await this.db.pool.connect();
            await client.query('BEGIN');

            // Unset all other defaults for this user
            await client.query(
                'UPDATE smtp_connections SET is_default = FALSE WHERE user_email = $1;',
                [userEmail]
            );

            // Set this as default
            const query = `
                UPDATE smtp_connections 
                SET is_default = TRUE, updated_at = CURRENT_TIMESTAMP
                WHERE connection_id = $1 AND user_email = $2
                RETURNING *;
            `;
            const result = await client.query(query, [connectionId, userEmail]);

            await client.query('COMMIT');

            if (result.rows[0]) {
                result.rows[0].metadata = typeof result.rows[0].metadata === 'string' ? JSON.parse(result.rows[0].metadata) : result.rows[0].metadata;
            }

            return result.rows[0];
        } catch (error) {
            if (client) await client.query('ROLLBACK');
            console.error('Error setting default SMTP connection:', error);
            throw error;
        } finally {
            if (client) client.release();
        }
    }

    async updateDailySentCount(connectionId) {
        const query = `
            UPDATE smtp_connections 
            SET daily_sent_count = daily_sent_count + 1, updated_at = CURRENT_TIMESTAMP
            WHERE connection_id = $1
            RETURNING daily_sent_count, daily_limit;
        `;

        try {
            const result = await this.db.pool.query(query, [connectionId]);
            return result.rows[0];
        } catch (error) {
            console.error('Error updating daily sent count:', error);
            throw error;
        }
    }

    async resetDailyCount(connectionId) {
        const query = `
            UPDATE smtp_connections 
            SET daily_sent_count = 0, daily_reset_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
            WHERE connection_id = $1
            RETURNING *;
        `;

        try {
            const result = await this.db.pool.query(query, [connectionId]);
            return result.rows[0];
        } catch (error) {
            console.error('Error resetting daily count:', error);
            throw error;
        }
    }

    async verifyConnection(connectionId) {
        const query = `
            UPDATE smtp_connections 
            SET verified_at = CURRENT_TIMESTAMP, is_active = TRUE, updated_at = CURRENT_TIMESTAMP
            WHERE connection_id = $1
            RETURNING *;
        `;

        try {
            const result = await this.db.pool.query(query, [connectionId]);
            if (result.rows[0]) {
                result.rows[0].metadata = typeof result.rows[0].metadata === 'string' ? JSON.parse(result.rows[0].metadata) : result.rows[0].metadata;
            }
            return result.rows[0];
        } catch (error) {
            console.error('Error verifying SMTP connection:', error);
            throw error;
        }
    }

    async deleteConnection(connectionId) {
        const query = 'DELETE FROM smtp_connections WHERE connection_id = $1 RETURNING connection_id;';
        try {
            const result = await this.db.pool.query(query, [connectionId]);
            return result.rowCount > 0;
        } catch (error) {
            console.error('Error deleting SMTP connection:', error);
            throw error;
        }
    }

    async canSendEmail(connectionId) {
        const query = `
            SELECT daily_sent_count, daily_limit, is_active
            FROM smtp_connections 
            WHERE connection_id = $1;
        `;

        try {
            const result = await this.db.pool.query(query, [connectionId]);
            if (!result.rows[0]) return false;
            
            const { daily_sent_count, daily_limit, is_active } = result.rows[0];
            return is_active && (daily_sent_count < daily_limit);
        } catch (error) {
            console.error('Error checking if can send email:', error);
            throw error;
        }
    }
}

module.exports = SmtpConnection;
