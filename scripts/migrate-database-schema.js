require('dotenv').config();
const { Pool } = require('pg');

async function migrateDatabase() {
    // Handle Supabase connection string properly
    const connectionString = process.env.DATABASE_URL;
    
    if (!connectionString) {
        console.error('❌ DATABASE_URL environment variable is not set');
        process.exit(1);
    }
    
    console.log('🔗 Connecting to database...');
    console.log('📍 Database URL:', connectionString.replace(/:[^:@]+@/, ':***@')); // Hide password
    
    // Use the same SSL logic as the main application
    const hasUrl = !!connectionString;
    const urlWantsSsl = /sslmode=require/i.test(connectionString) || /ssl=true/i.test(connectionString);
    const hostHintsSsl = /(supabase\.(co|com)|neon\.tech|render\.com|railway\.app|aws-\d+-.*\.pooler\.supabase\.com)/i.test(connectionString);
    const useSsl = (process.env.DB_SSL === 'true')
        || (process.env.NODE_ENV === 'production')
        || (hasUrl && (urlWantsSsl || hostHintsSsl));
    
    console.log('🔒 SSL Configuration:', { useSsl, urlWantsSsl, hostHintsSsl });
    
    const pool = new Pool({
        connectionString: connectionString,
        ssl: useSsl ? { rejectUnauthorized: false } : false,
        connectionTimeoutMillis: 10000,
        idleTimeoutMillis: 30000
    });

    try {
        const client = await pool.connect();
        console.log('✅ Successfully connected to database');
        
        console.log('Starting database migration...');
        
        // Check if business_data table exists
        const tableExists = await client.query(`
            SELECT EXISTS (
                SELECT FROM information_schema.tables 
                WHERE table_name = 'business_data'
            );
        `);
        
        if (tableExists.rows[0].exists) {
            console.log('business_data table exists, checking schema...');
            
            // Check current schema
            const schema = await client.query(`
                SELECT column_name, data_type, character_maximum_length 
                FROM information_schema.columns 
                WHERE table_name = 'business_data' AND column_name = 'name';
            `);
            
            console.log('Current name column schema:', schema.rows[0]);
            
            // Update name column to TEXT if it's VARCHAR(255)
            if (schema.rows[0] && schema.rows[0].character_maximum_length === 255) {
                console.log('Updating name column from VARCHAR(255) to TEXT...');
                await client.query(`
                    ALTER TABLE business_data 
                    ALTER COLUMN name TYPE TEXT;
                `);
                console.log('✅ Successfully updated business_data.name to TEXT');
            } else {
                console.log('✅ business_data.name is already TEXT or unlimited');
            }

            // Ensure social profile columns exist in business_data
            console.log('Ensuring social media columns exist in business_data...');
            await client.query(`
                ALTER TABLE business_data 
                ADD COLUMN IF NOT EXISTS linkedin TEXT,
                ADD COLUMN IF NOT EXISTS facebook TEXT,
                ADD COLUMN IF NOT EXISTS instagram TEXT,
                ADD COLUMN IF NOT EXISTS twitter TEXT,
                ADD COLUMN IF NOT EXISTS youtube TEXT,
                ADD COLUMN IF NOT EXISTS tiktok TEXT;
            `);
            console.log('✅ Checked/Added social media columns in business_data');
        } else {
            console.log('business_data table does not exist, will be created with correct schema');
        }
        
        // Check if businesses table exists
        const businessesExists = await client.query(`
            SELECT EXISTS (
                SELECT FROM information_schema.tables 
                WHERE table_name = 'businesses'
            );
        `);
        
        if (businessesExists.rows[0].exists) {
            console.log('businesses table exists, checking schema...');
            
            // Check current schema
            const schema = await client.query(`
                SELECT column_name, data_type, character_maximum_length 
                FROM information_schema.columns 
                WHERE table_name = 'businesses' AND column_name = 'name';
            `);
            
            console.log('Current businesses.name schema:', schema.rows[0]);
            
            // Update name column to TEXT if it's VARCHAR(255)
            if (schema.rows[0] && schema.rows[0].character_maximum_length === 255) {
                console.log('Updating businesses.name column from VARCHAR(255) to TEXT...');
                await client.query(`
                    ALTER TABLE businesses 
                    ALTER COLUMN name TYPE TEXT;
                `);
                console.log('✅ Successfully updated businesses.name to TEXT');
            } else {
                console.log('✅ businesses.name is already TEXT or unlimited');
            }

            // Ensure social profile columns exist in businesses
            console.log('Ensuring social media columns exist in businesses...');
            await client.query(`
                ALTER TABLE businesses 
                ADD COLUMN IF NOT EXISTS linkedin TEXT,
                ADD COLUMN IF NOT EXISTS facebook TEXT,
                ADD COLUMN IF NOT EXISTS instagram TEXT,
                ADD COLUMN IF NOT EXISTS twitter TEXT,
                ADD COLUMN IF NOT EXISTS youtube TEXT,
                ADD COLUMN IF NOT EXISTS tiktok TEXT,
                ADD COLUMN IF NOT EXISTS lead_segment VARCHAR(10) DEFAULT 'B2B',
                ADD COLUMN IF NOT EXISTS platform_source VARCHAR(50) DEFAULT 'GoogleMaps';
            `);
            console.log('✅ Checked/Added social media columns in businesses');

            // Add to business_data as well
            console.log('Ensuring lead_segment and platform_source columns exist in business_data...');
            await client.query(`
                ALTER TABLE business_data 
                ADD COLUMN IF NOT EXISTS lead_segment VARCHAR(10) DEFAULT 'B2B',
                ADD COLUMN IF NOT EXISTS platform_source VARCHAR(50) DEFAULT 'GoogleMaps';
            `);

            // Create social_jobs table for B2C and C2C jobs isolation
            console.log('Creating social_jobs table for B2C & C2C job isolation...');
            await client.query(`
                CREATE TABLE IF NOT EXISTS social_jobs (
                    id SERIAL PRIMARY KEY,
                    job_id VARCHAR(255) UNIQUE NOT NULL,
                    user_email VARCHAR(255) NOT NULL,
                    platform VARCHAR(50) NOT NULL,
                    segment VARCHAR(10) NOT NULL,
                    search_type VARCHAR(50) NOT NULL,
                    search_value VARCHAR(255) NOT NULL,
                    status VARCHAR(50) NOT NULL DEFAULT 'pending',
                    progress JSONB DEFAULT '{}',
                    statistics JSONB DEFAULT '{}',
                    error_message TEXT,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                );
                CREATE INDEX IF NOT EXISTS idx_social_jobs_job_id ON social_jobs(job_id);
                CREATE INDEX IF NOT EXISTS idx_social_jobs_user ON social_jobs(user_email);
            `);
            console.log('✅ Checked/Created social_jobs table');
        } else {
            console.log('businesses table does not exist, will be created with correct schema');
        }
        
        console.log('✅ Database migration completed successfully');
        
        client.release();
    } catch (error) {
        console.error('❌ Error during migration:', error);
        throw error;
    } finally {
        await pool.end();
    }
}

// Run migration if called directly
if (require.main === module) {
    migrateDatabase()
        .then(() => {
            console.log('Migration script completed');
            process.exit(0);
        })
        .catch((error) => {
            console.error('Migration failed:', error);
            process.exit(1);
        });
}

module.exports = { migrateDatabase };
