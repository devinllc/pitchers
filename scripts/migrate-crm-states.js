require('dotenv').config();
const { Pool } = require('pg');

async function migrateCRMStates() {
    const connectionString = process.env.DATABASE_URL;
    
    if (!connectionString) {
        console.error('❌ DATABASE_URL environment variable is not set');
        process.exit(1);
    }
    
    console.log('🔗 Connecting to database...');
    console.log('📍 Database URL:', connectionString.replace(/:[^:@]+@/, ':***@')); // Hide password
    
    // SSL Configuration matching migrate-database-schema.js and backend database service
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
        
        console.log('Starting CRM states schema migration on business_data...');
        
        // 1. Add missing columns to business_data if they do not exist
        await client.query(`
            ALTER TABLE business_data 
            ADD COLUMN IF NOT EXISTS status VARCHAR(100) DEFAULT 'New',
            ADD COLUMN IF NOT EXISTS notes TEXT DEFAULT '',
            ADD COLUMN IF NOT EXISTS tags TEXT DEFAULT '';
        `);
        console.log('✅ Checked and added CRM columns (status, notes, tags) to business_data');

        // 2. Set default values on any existing NULL rows to ensure data integrity
        console.log('Backfilling default values for existing rows...');
        
        const updateStatusRes = await client.query(`
            UPDATE business_data SET status = 'New' WHERE status IS NULL;
        `);
        console.log(`✅ Backfilled status for ${updateStatusRes.rowCount} rows`);

        const updateNotesRes = await client.query(`
            UPDATE business_data SET notes = '' WHERE notes IS NULL;
        `);
        console.log(`✅ Backfilled notes for ${updateNotesRes.rowCount} rows`);

        const updateTagsRes = await client.query(`
            UPDATE business_data SET tags = '' WHERE tags IS NULL;
        `);
        console.log(`✅ Backfilled tags for ${updateTagsRes.rowCount} rows`);

        console.log('🎉 CRM states database migration completed successfully');
        client.release();
    } catch (error) {
        console.error('❌ Error during CRM states database migration:', error);
        throw error;
    } finally {
        await pool.end();
    }
}

// Run migration if called directly
if (require.main === module) {
    migrateCRMStates()
        .then(() => {
            console.log('Migration script completed successfully');
            process.exit(0);
        })
        .catch((error) => {
            console.error('Migration execution failed:', error);
            process.exit(1);
        });
}

module.exports = { migrateCRMStates };
