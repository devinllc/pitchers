const crypto = require('crypto');

class UserGoogleSheet {
    constructor(databaseService) {
        this.db = databaseService;
    }

    // Create user_google_sheets table for multi-tenant sheet management
    async createUserGoogleSheetsTable() {
        let client;
        try {
            client = await this.db.pool.connect();
            
            // Check if table exists
            const checkTableQuery = `
                SELECT EXISTS (
                    SELECT FROM information_schema.tables 
                    WHERE table_name = 'user_google_sheets'
                );
            `;
            const tableCheck = await client.query(checkTableQuery);
            
            if (!tableCheck.rows[0].exists) {
                console.log('Creating user_google_sheets table...');
                const createTableQuery = `
                    CREATE TABLE IF NOT EXISTS user_google_sheets (
                        id SERIAL PRIMARY KEY,
                        user_email VARCHAR(255) NOT NULL,
                        sheet_id VARCHAR(255) NOT NULL,
                        sheet_name VARCHAR(255) NOT NULL,
                        sheet_url TEXT,
                        access_token TEXT,
                        refresh_token TEXT,
                        token_expires_at TIMESTAMP,
                        is_active BOOLEAN DEFAULT true,
                        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                        UNIQUE(user_email, sheet_id)
                    );
                `;
                await client.query(createTableQuery);

                // Create indexes
                await client.query('CREATE INDEX IF NOT EXISTS idx_user_google_sheets_email ON user_google_sheets(user_email);');
                await client.query('CREATE INDEX IF NOT EXISTS idx_user_google_sheets_active ON user_google_sheets(is_active);');
                console.log('User Google Sheets table and indexes created successfully');
            }
            
            return true;
        } catch (error) {
            if (error.code === '42P07' || error.code === '23505') return true;
            console.error('Error creating user Google Sheets table:', error);
            throw error;
        } finally {
            if (client) client.release();
        }
    }

    // Create business_data table for storing scraped data with user isolation
    async createBusinessDataTable() {
        let client;
        try {
            client = await this.db.pool.connect();
            
            // Check if table exists
            const checkTableQuery = `
                SELECT EXISTS (
                    SELECT FROM information_schema.tables 
                    WHERE table_name = 'business_data'
                );
            `;
            const tableCheck = await client.query(checkTableQuery);
            
            if (!tableCheck.rows[0].exists) {
                console.log('Creating business_data table...');
                const createTableQuery = `
                    CREATE TABLE IF NOT EXISTS business_data (
                        id SERIAL PRIMARY KEY,
                        user_email VARCHAR(255) NOT NULL,
                        job_id VARCHAR(255),
                        place_id VARCHAR(255),
                        name TEXT,
                        address TEXT,
                        phone VARCHAR(50),
                        website TEXT,
                        email VARCHAR(255),
                        search_phrase TEXT,
                        city VARCHAR(255),
                        keyword VARCHAR(255),
                        sheet_id VARCHAR(255),
                        linkedin TEXT,
                        facebook TEXT,
                        instagram TEXT,
                        twitter TEXT,
                        youtube TEXT,
                        tiktok TEXT,
                        reddit TEXT,
                        status VARCHAR(100) DEFAULT 'New',
                        notes TEXT DEFAULT '',
                        tags TEXT DEFAULT '',
                        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                    );
                `;
                await client.query(createTableQuery);

                // Create indexes
                await client.query('CREATE INDEX IF NOT EXISTS idx_business_data_user_email ON business_data(user_email);');
                await client.query('CREATE INDEX IF NOT EXISTS idx_business_data_job_id ON business_data(job_id);');
                await client.query('CREATE INDEX IF NOT EXISTS idx_business_data_sheet_id ON business_data(sheet_id);');
                await client.query('CREATE INDEX IF NOT EXISTS idx_business_data_created_at ON business_data(created_at);');
                console.log('Business data table and indexes created successfully');
            }
            
            // Safe schema migration: run on every initialization to add reddit column if it's missing
            await client.query('ALTER TABLE business_data ADD COLUMN IF NOT EXISTS reddit TEXT;');
            
            return true;
        } catch (error) {
            if (error.code === '42P07' || error.code === '23505') return true;
            console.error('Error creating business data table:', error);
            throw error;
        } finally {
            if (client) client.release();
        }
    }

    // Save user's Google Sheet connection
    async saveUserGoogleSheet(userEmail, sheetData) {
        const insertQuery = `
            INSERT INTO user_google_sheets (
                user_email, sheet_id, sheet_name, sheet_url, 
                access_token, refresh_token, token_expires_at
            )
            VALUES ($1, $2, $3, $4, $5, $6, $7)
            ON CONFLICT (user_email, sheet_id) 
            DO UPDATE SET 
                sheet_name = EXCLUDED.sheet_name,
                sheet_url = EXCLUDED.sheet_url,
                access_token = EXCLUDED.access_token,
                refresh_token = EXCLUDED.refresh_token,
                token_expires_at = EXCLUDED.token_expires_at,
                updated_at = CURRENT_TIMESTAMP
            RETURNING *;
        `;

        const values = [
            userEmail,
            sheetData.sheet_id,
            sheetData.sheet_name,
            sheetData.sheet_url,
            sheetData.access_token,
            sheetData.refresh_token,
            sheetData.token_expires_at
        ];

        try {
            const result = await this.db.pool.query(insertQuery, values);
            return result.rows[0];
        } catch (error) {
            console.error('Error saving user Google Sheet:', error);
            throw error;
        }
    }

    // Get user's Google Sheets
    async getUserGoogleSheets(userEmail) {
        const selectQuery = `
            SELECT id, sheet_id, sheet_name, sheet_url, is_active, created_at, updated_at
            FROM user_google_sheets 
            WHERE user_email = $1 AND is_active = true AND sheet_id != 'oauth_credentials'
            ORDER BY created_at DESC;
        `;

        try {
            const result = await this.db.pool.query(selectQuery, [userEmail]);
            return result.rows;
        } catch (error) {
            console.error('Error getting user Google Sheets:', error);
            throw error;
        }
    }

    // Get user's Google Sheet credentials
    async getUserSheetCredentials(userEmail, sheetId) {
        const selectQuery = `
            SELECT access_token, refresh_token, token_expires_at
            FROM user_google_sheets 
            WHERE user_email = $1 AND sheet_id = $2 AND is_active = true;
        `;

        try {
            const result = await this.db.pool.query(selectQuery, [userEmail, sheetId]);
            return result.rows[0] || null;
        } catch (error) {
            console.error('Error getting user sheet credentials:', error);
            throw error;
        }
    }

    // Update user's sheet tokens
    async updateUserSheetTokens(userEmail, sheetId, tokens) {
        const updateQuery = `
            UPDATE user_google_sheets 
            SET access_token = $1, 
                refresh_token = COALESCE($2, refresh_token),
                token_expires_at = $3,
                updated_at = CURRENT_TIMESTAMP
            WHERE user_email = $4 AND sheet_id = $5
            RETURNING *;
        `;

        try {
            const result = await this.db.pool.query(updateQuery, [
                tokens.access_token,
                tokens.refresh_token,
                tokens.expiry_date ? new Date(tokens.expiry_date) : null,
                userEmail,
                sheetId
            ]);
            return result.rows[0];
        } catch (error) {
            console.error('Error updating user sheet tokens:', error);
            throw error;
        }
    }

    // Save business data with user isolation
    async saveBusinessData(userEmail, businessData, jobId = null, sheetId = null) {
        const insertQuery = `
            INSERT INTO business_data (
                user_email, job_id, place_id, name, address, phone, 
                website, email, search_phrase, city, keyword, sheet_id,
                linkedin, facebook, instagram, twitter, youtube, tiktok, reddit
            )
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19)
            RETURNING *;
        `;

        // Validate and clean business data
        const cleanBusinessName = (businessData.name || '').trim();
        const cleanAddress = (businessData.address || '').trim();
        const cleanPhone = (businessData.phone || '').trim();
        const cleanWebsite = (businessData.website || '').trim();
        const cleanEmail = (businessData.contact?.emails?.[0] || businessData.email || '').trim();
        const cleanSearchPhrase = (businessData.searchPhrase || '').trim();
        const cleanCity = (businessData.city || '').trim();
        const cleanKeyword = (businessData.keyword || '').trim();

        // Extract social profiles flexibly (handles both flat properties and nested objects)
        const socials = businessData.socialProfiles || businessData.socials || {};
        const cleanLinkedin = (socials.linkedin || businessData.linkedin || '').trim();
        const cleanFacebook = (socials.facebook || businessData.facebook || '').trim();
        const cleanInstagram = (socials.instagram || businessData.instagram || '').trim();
        const cleanTwitter = (socials.twitter || socials.x || businessData.twitter || businessData.x || '').trim();
        const cleanYoutube = (socials.youtube || businessData.youtube || '').trim();
        const cleanTiktok = (socials.tiktok || businessData.tiktok || '').trim();
        const cleanReddit = (socials.reddit || businessData.reddit || '').trim();

        const values = [
            userEmail,
            jobId,
            businessData.placeId || null,
            cleanBusinessName,
            cleanAddress,
            cleanPhone,
            cleanWebsite,
            cleanEmail,
            cleanSearchPhrase,
            cleanCity,
            cleanKeyword,
            sheetId,
            cleanLinkedin || null,
            cleanFacebook || null,
            cleanInstagram || null,
            cleanTwitter || null,
            cleanYoutube || null,
            cleanTiktok || null,
            cleanReddit || null
        ];

        try {
            const result = await this.db.pool.query(insertQuery, values);
            return result.rows[0];
        } catch (error) {
            console.error('Error saving business data:', error);
            throw error;
        }
    }

    // Get user's business data with pagination
    async getUserBusinessData(userEmail, options = {}) {
        const { 
            limit = 100, 
            offset = 0, 
            jobId = null, 
            sheetId = null,
            city = null,
            keyword = null,
            startDate = null,
            endDate = null
        } = options;

        let whereConditions = ['user_email = $1'];
        let values = [userEmail];
        let paramCount = 1;

        if (jobId) {
            paramCount++;
            whereConditions.push(`job_id = $${paramCount}`);
            values.push(jobId);
        }

        if (sheetId) {
            paramCount++;
            whereConditions.push(`sheet_id = $${paramCount}`);
            values.push(sheetId);
        }

        if (city) {
            paramCount++;
            whereConditions.push(`city ILIKE $${paramCount}`);
            values.push(`%${city}%`);
        }

        if (keyword) {
            paramCount++;
            whereConditions.push(`keyword ILIKE $${paramCount}`);
            values.push(`%${keyword}%`);
        }

        if (startDate) {
            paramCount++;
            whereConditions.push(`created_at >= $${paramCount}`);
            values.push(startDate);
        }

        if (endDate) {
            paramCount++;
            whereConditions.push(`created_at <= $${paramCount}`);
            values.push(endDate);
        }

        const selectQuery = `
            SELECT id, job_id, place_id, name, address, phone, website, email,
                   search_phrase, city, keyword, sheet_id, 
                   linkedin, facebook, instagram, twitter, youtube, tiktok, reddit,
                   status, notes, tags, created_at
            FROM business_data 
            WHERE ${whereConditions.join(' AND ')}
            ORDER BY created_at DESC
            LIMIT $${paramCount + 1} OFFSET $${paramCount + 2};
        `;

        values.push(limit, offset);

        try {
            const result = await this.db.pool.query(selectQuery, values);
            return result.rows;
        } catch (error) {
            console.error('Error getting user business data:', error);
            throw error;
        }
    }

    // Get user's business data count
    async getUserBusinessDataCount(userEmail, options = {}) {
        const { 
            jobId = null, 
            sheetId = null,
            city = null,
            keyword = null,
            startDate = null,
            endDate = null
        } = options;

        let whereConditions = ['user_email = $1'];
        let values = [userEmail];
        let paramCount = 1;

        if (jobId) {
            paramCount++;
            whereConditions.push(`job_id = $${paramCount}`);
            values.push(jobId);
        }

        if (sheetId) {
            paramCount++;
            whereConditions.push(`sheet_id = $${paramCount}`);
            values.push(sheetId);
        }

        if (city) {
            paramCount++;
            whereConditions.push(`city ILIKE $${paramCount}`);
            values.push(`%${city}%`);
        }

        if (keyword) {
            paramCount++;
            whereConditions.push(`keyword ILIKE $${paramCount}`);
            values.push(`%${keyword}%`);
        }

        if (startDate) {
            paramCount++;
            whereConditions.push(`created_at >= $${paramCount}`);
            values.push(startDate);
        }

        if (endDate) {
            paramCount++;
            whereConditions.push(`created_at <= $${paramCount}`);
            values.push(endDate);
        }

        const countQuery = `
            SELECT COUNT(*) as total
            FROM business_data 
            WHERE ${whereConditions.join(' AND ')};
        `;

        try {
            const result = await this.db.pool.query(countQuery, values);
            return parseInt(result.rows[0].total);
        } catch (error) {
            console.error('Error getting user business data count:', error);
            throw error;
        }
    }

    // Delete user's Google Sheet connection
    async deleteUserGoogleSheet(userEmail, sheetId) {
        const updateQuery = `
            UPDATE user_google_sheets 
            SET is_active = false, updated_at = CURRENT_TIMESTAMP
            WHERE user_email = $1 AND sheet_id = $2
            RETURNING *;
        `;

        try {
            const result = await this.db.pool.query(updateQuery, [userEmail, sheetId]);
            return result.rows[0];
        } catch (error) {
            console.error('Error deleting user Google Sheet:', error);
            throw error;
        }
    }
}

module.exports = UserGoogleSheet;
