const { Pool } = require('pg');
const dotenv = require('dotenv');

dotenv.config();

async function run() {
  const url = process.env.DATABASE_URL;
  const pool = new Pool({
    connectionString: url,
    ssl: { rejectUnauthorized: false }
  });

  try {
    const client = await pool.connect();
    const cols = await client.query(`
      SELECT column_name, data_type 
      FROM information_schema.columns 
      WHERE table_name = 'business_data'
    `);
    console.table(cols.rows);
    client.release();
  } catch (err) {
    console.error(err);
  } finally {
    await pool.end();
  }
}

run();
