const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');

// Load environment variables
dotenv.config();

const DatabaseService = require('../services/database');

async function runMigration() {
  const db = new DatabaseService();
  try {
    console.log('🔌 Connecting to database...');
    await db.connect();

    const sqlPath = path.join(__dirname, '..', 'migrations', '007_create_social_media_agents.sql');
    console.log(`📖 Reading SQL migration from ${sqlPath}...`);
    const sql = fs.readFileSync(sqlPath, 'utf8');

    console.log('⚡ Running SQL migration script...');
    await db.pool.query(sql);

    console.log('✅ SQL migration completed successfully!');
  } catch (err) {
    console.error('❌ SQL migration failed:', err.message);
  } finally {
    await db.close();
    console.log('🔌 Database connection closed.');
  }
}

runMigration();
