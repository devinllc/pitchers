const { Pool } = require('pg');
const ErrorHandler = require('./errorHandler');
require('dotenv').config();

let globalPool = null;

class DatabaseService {
    constructor() {
        if (globalPool) {
            this.pool = globalPool;
            this.errorHandler = new ErrorHandler();
            return;
        }

        const hasUrl = !!process.env.DATABASE_URL;
        const url = process.env.DATABASE_URL || '';
        const urlWantsSsl = /sslmode=require/i.test(url) || /ssl=true/i.test(url);
        const hostHintsSsl = /(supabase\.(co|com)|neon\.tech|render\.com|railway\.app|aws-\d+-.*\.pooler\.supabase\.com)/i.test(url);

        // Decide SSL usage robustly for managed Postgres providers
        const useSsl = (process.env.DB_SSL === 'true')
            || (process.env.NODE_ENV === 'production')
            || (hasUrl && (urlWantsSsl || hostHintsSsl));

        // Optional debug
        if (process.env.DEBUG_DB === 'true') {
            console.log('[DB] hasUrl:', hasUrl, '\n[DB] urlWantsSsl:', urlWantsSsl, '\n[DB] hostHintsSsl:', hostHintsSsl, '\n[DB] useSsl:', useSsl);
        }

        // Build configuration: prefer DATABASE_URL when available (Vercel/Render/Neon/Supabase)
        let baseConfig;
        if (hasUrl) {
            try {
                const parsed = new URL(url);
                const [user, ...pwParts] = decodeURIComponent(parsed.username || '').split(':');
                const passwordFromUser = pwParts.length > 0 ? pwParts.join(':') : undefined;
                const password = decodeURIComponent(parsed.password || passwordFromUser || '');
                baseConfig = {
                    host: parsed.hostname,
                    port: Number(parsed.port) || 5432,
                    database: decodeURIComponent(parsed.pathname || '').replace(/^\//, '') || undefined,
                    user: decodeURIComponent(parsed.username || ''),
                    password,
                    // Force non-verifying SSL to handle managed/self-signed cert chains
                    ssl: useSsl ? { rejectUnauthorized: false } : false,
                };
            } catch (e) {
                // Fallback to connectionString if URL parse fails
                baseConfig = {
                    connectionString: url,
                    ssl: useSsl ? { rejectUnauthorized: false } : false,
                };
            }
        } else {
            baseConfig = {
                host: process.env.DB_HOST || '127.0.0.1',
                port: Number(process.env.DB_PORT) || 5432,
                database: process.env.DB_NAME,
                user: process.env.DB_USER,
                password: process.env.DB_PASSWORD,
                // Explicitly allow self-signed certs when SSL is requested by flags/env
                ssl: useSsl ? { rejectUnauthorized: false } : false,
            };
        }

        this.pool = new Pool({
            ...baseConfig,
            // Connection pool configuration optimized for stability and shared usage
            max: 10, // DigitalOcean Starter has low connection limits
            idleTimeoutMillis: 30000, 
            connectionTimeoutMillis: 30000, 
            acquireTimeoutMillis: 30000,
            statement_timeout: 45000,
            query_timeout: 30000,
        });

        globalPool = this.pool;
        this.errorHandler = new ErrorHandler();

        // Handle pool errors
        this.pool.on('error', (err) => {
            console.error('[DATABASE_POOL] Unexpected error on idle client:', err.message);
            this.errorHandler.logAndContinue(err, {
                operation: 'database_pool_error',
                context: 'Unexpected error on idle client'
            });
        });

        console.log('[DATABASE] Singleton connection pool initialized (Max: 10 connections)');
    }

    async connect() {
        try {
            const client = await this.pool.connect();
            console.log('Connected to PostgreSQL database');
            client.release();
            return true;
        } catch (error) {
            console.error('Database connection error:', error);
            throw error;
        }
    }

    async createBusinessesTable() {
        const createTableQuery = `
      CREATE TABLE IF NOT EXISTS businesses (
        id SERIAL PRIMARY KEY,
        name TEXT NOT NULL,
        address TEXT,
        phone VARCHAR(50),
        website VARCHAR(500),
        rating DECIMAL(2,1),
        total_reviews INTEGER,
        opening_hours JSONB,
        place_id VARCHAR(255) UNIQUE,
        search_phrase VARCHAR(255),
        linkedin TEXT,
        facebook TEXT,
        instagram TEXT,
        twitter TEXT,
        youtube TEXT,
        tiktok TEXT,
        reddit TEXT,
        lead_segment VARCHAR(10) DEFAULT 'B2B',
        platform_source VARCHAR(50) DEFAULT 'GoogleMaps',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `;

        try {
            const client = await this.pool.connect();
            await client.query(createTableQuery);
            // Ensure reddit column exists if the table was already created
            await client.query('ALTER TABLE businesses ADD COLUMN IF NOT EXISTS reddit TEXT;');
            // Removed success log to reduce console spam
            // console.log('Businesses table created successfully');
            client.release();
            return true;
        } catch (error) {
            console.error('Error creating businesses table:', error);
            throw error;
        }
    }

    async insertBusiness(businessData) {
        const startTime = Date.now();
        const context = {
            operation: 'insertBusiness',
            businessName: businessData.name,
            placeId: businessData.placeId
        };

        const insertQuery = `
      INSERT INTO businesses (
        name, address, phone, website, rating, total_reviews, opening_hours, place_id, search_phrase,
        linkedin, facebook, instagram, twitter, youtube, tiktok, reddit, lead_segment, platform_source
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18)
      ON CONFLICT (place_id) DO UPDATE SET
        name = EXCLUDED.name,
        address = EXCLUDED.address,
        phone = EXCLUDED.phone,
        website = EXCLUDED.website,
        rating = EXCLUDED.rating,
        total_reviews = EXCLUDED.total_reviews,
        opening_hours = EXCLUDED.opening_hours,
        search_phrase = EXCLUDED.search_phrase,
        linkedin = EXCLUDED.linkedin,
        facebook = EXCLUDED.facebook,
        instagram = EXCLUDED.instagram,
        twitter = EXCLUDED.twitter,
        youtube = EXCLUDED.youtube,
        tiktok = EXCLUDED.tiktok,
        reddit = EXCLUDED.reddit,
        lead_segment = EXCLUDED.lead_segment,
        platform_source = EXCLUDED.platform_source,
        updated_at = CURRENT_TIMESTAMP
      RETURNING id, (xmax = 0) AS inserted;
    `;

        const socials = businessData.socialProfiles || businessData.socials || {};
        const cleanLinkedin = (socials.linkedin || businessData.linkedin || '').trim();
        const cleanFacebook = (socials.facebook || businessData.facebook || '').trim();
        const cleanInstagram = (socials.instagram || businessData.instagram || '').trim();
        const cleanTwitter = (socials.twitter || socials.x || businessData.twitter || businessData.x || '').trim();
        const cleanYoutube = (socials.youtube || businessData.youtube || '').trim();
        const cleanTiktok = (socials.tiktok || businessData.tiktok || '').trim();
        const cleanReddit = (socials.reddit || businessData.reddit || '').trim();

        const values = [
            businessData.name || '',
            businessData.address || '',
            businessData.phone || '',
            businessData.website || '',
            businessData.rating || null,
            businessData.totalReviews || null,
            businessData.openingHours ? JSON.stringify(businessData.openingHours) : null,
            businessData.placeId || '',
            businessData.searchPhrase || '',
            cleanLinkedin || null,
            cleanFacebook || null,
            cleanInstagram || null,
            cleanTwitter || null,
            cleanYoutube || null,
            cleanTiktok || null,
            cleanReddit || null,
            businessData.lead_segment || businessData.leadSegment || 'B2B',
            businessData.platform_source || businessData.platformSource || 'GoogleMaps'
        ];

        // Retry logic for Render network issues
        const maxRetries = 3;
        let lastError;

        for (let attempt = 1; attempt <= maxRetries; attempt++) {
            let client;
            try {
                if (attempt === 1) {
                    this.errorHandler.logProgress('insertBusiness', {
                        status: 'started',
                        businessName: businessData.name,
                        placeId: businessData.placeId
                    });
                } else {
                    console.log(`[DB] Retry attempt ${attempt}/${maxRetries} for ${businessData.name}`);
                }

                client = await this.pool.connect();
                const result = await client.query(insertQuery, values);

                const record = result.rows[0];
                const wasInserted = record.inserted;
                const duration = Date.now() - startTime;

                this.errorHandler.logDataSave('PostgreSQL', businessData, 1);
                this.errorHandler.logProgress('insertBusiness', {
                    status: 'completed',
                    businessName: businessData.name,
                    action: wasInserted ? 'inserted' : 'updated',
                    recordId: record.id,
                    duration: `${duration}ms`,
                    attempts: attempt
                });

                return {
                    id: record.id,
                    inserted: wasInserted,
                    businessName: businessData.name,
                    placeId: businessData.placeId
                };
            } catch (error) {
                lastError = error;

                // Check if it's a retryable error
                const isRetryable = error.message.includes('timeout') ||
                    error.message.includes('connection') ||
                    error.code === 'ECONNRESET' ||
                    error.code === 'ETIMEDOUT';

                if (client) {
                    client.release();
                    client = null;
                }

                if (!isRetryable || attempt === maxRetries) {
                    break;
                }

                // Exponential backoff: 1s, 2s, 4s
                const delay = Math.pow(2, attempt - 1) * 1000;
                console.log(`[DB] Retrying in ${delay}ms due to: ${error.message}`);
                await new Promise(resolve => setTimeout(resolve, delay));
            } finally {
                if (client) {
                    client.release();
                }
            }
        }

        // All retries failed
        this.errorHandler.logDataSaveFailure('PostgreSQL', lastError, businessData);
        this.errorHandler.logAndContinue(lastError, context);

        // Re-throw with enhanced context for upstream error handling
        const enhancedError = new Error(`Database save failed for ${businessData.name}: ${lastError.message}`);
        enhancedError.originalError = lastError;
        enhancedError.businessData = businessData;
        enhancedError.errorCode = lastError.code;

        throw enhancedError;
    }

    async insertBusinessBatch(businessDataArray) {
        if (!businessDataArray || businessDataArray.length === 0) {
            return [];
        }

        const insertQuery = `
      INSERT INTO businesses (
        name, address, phone, website, rating, total_reviews, opening_hours, place_id, search_phrase,
        linkedin, facebook, instagram, twitter, youtube, tiktok, reddit, lead_segment, platform_source
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18)
      ON CONFLICT (place_id) DO UPDATE SET
        name = EXCLUDED.name,
        address = EXCLUDED.address,
        phone = EXCLUDED.phone,
        website = EXCLUDED.website,
        rating = EXCLUDED.rating,
        total_reviews = EXCLUDED.total_reviews,
        opening_hours = EXCLUDED.opening_hours,
        search_phrase = EXCLUDED.search_phrase,
        linkedin = EXCLUDED.linkedin,
        facebook = EXCLUDED.facebook,
        instagram = EXCLUDED.instagram,
        twitter = EXCLUDED.twitter,
        youtube = EXCLUDED.youtube,
        tiktok = EXCLUDED.tiktok,
        reddit = EXCLUDED.reddit,
        lead_segment = EXCLUDED.lead_segment,
        platform_source = EXCLUDED.platform_source,
        updated_at = CURRENT_TIMESTAMP
      RETURNING id;
    `;

        const results = [];
        let client;

        try {
            client = await this.pool.connect();

            for (const businessData of businessDataArray) {
                const socials = businessData.socialProfiles || businessData.socials || {};
                const cleanLinkedin = (socials.linkedin || businessData.linkedin || '').trim();
                const cleanFacebook = (socials.facebook || businessData.facebook || '').trim();
                const cleanInstagram = (socials.instagram || businessData.instagram || '').trim();
                const cleanTwitter = (socials.twitter || socials.x || businessData.twitter || businessData.x || '').trim();
                const cleanYoutube = (socials.youtube || businessData.youtube || '').trim();
                const cleanTiktok = (socials.tiktok || businessData.tiktok || '').trim();
                const cleanReddit = (socials.reddit || businessData.reddit || '').trim();

                const values = [
                    businessData.name || '',
                    businessData.address || '',
                    businessData.phone || '',
                    businessData.website || '',
                    businessData.rating || null,
                    businessData.totalReviews || null,
                    businessData.openingHours ? JSON.stringify(businessData.openingHours) : null,
                    businessData.placeId || '',
                    businessData.searchPhrase || '',
                    cleanLinkedin || null,
                    cleanFacebook || null,
                    cleanInstagram || null,
                    cleanTwitter || null,
                    cleanYoutube || null,
                    cleanTiktok || null,
                    cleanReddit || null,
                    businessData.lead_segment || businessData.leadSegment || 'B2B',
                    businessData.platform_source || businessData.platformSource || 'GoogleMaps'
                ];

                try {
                    const result = await client.query(insertQuery, values);
                    results.push(result.rows[0]);
                } catch (error) {
                    console.error('Error inserting business in batch:', {
                        error: error.message,
                        businessData: {
                            name: businessData.name,
                            placeId: businessData.placeId
                        }
                    });
                    // Continue with other records even if one fails
                    results.push(null);
                }
            }

            return results;
        } catch (error) {
            console.error('Error in batch insert:', error);
            throw error;
        } finally {
            if (client) {
                client.release();
            }
        }
    }

    async testConnection() {
        let client;
        try {
            client = await this.pool.connect();
            const result = await client.query('SELECT NOW()');
            // Removed success log to reduce console spam
            // console.log('Database connection test successful:', result.rows[0]);
            return true;
        } catch (error) {
            console.error('Database connection test failed:', error);
            return false;
        } finally {
            if (client) {
                client.release();
            }
        }
    }

    async getBusinessCount() {
        let client;
        try {
            client = await this.pool.connect();
            const result = await client.query('SELECT COUNT(*) as count FROM businesses');
            return parseInt(result.rows[0].count);
        } catch (error) {
            console.error('Error getting business count:', error);
            throw error;
        } finally {
            if (client) {
                client.release();
            }
        }
    }

    async getBusinessesBySearchPhrase(searchPhrase) {
        let client;
        try {
            client = await this.pool.connect();
            const result = await client.query(
                'SELECT * FROM businesses WHERE search_phrase = $1 ORDER BY created_at DESC',
                [searchPhrase]
            );
            return result.rows;
        } catch (error) {
            console.error('Error getting businesses by search phrase:', error);
            throw error;
        } finally {
            if (client) {
                client.release();
            }
        }
    }

    async close() {
        await this.pool.end();
        console.log('Database connection pool closed');
    }
}

module.exports = DatabaseService;