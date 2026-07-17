const { Client } = require('pg');
require('dotenv').config();

async function createDatabase() {
    // Connect to postgres database to create our target database
    const client = new Client({
        host: process.env.DB_HOST,
        port: process.env.DB_PORT,
        user: process.env.DB_USER,
        password: process.env.DB_PASSWORD,
        database: 'postgres' // Connect to default postgres database
    });

    try {
        await client.connect();
        console.log('Connected to PostgreSQL server');

        // Check if database exists
        const checkDbQuery = `SELECT 1 FROM pg_database WHERE datname = '${process.env.DB_NAME}'`;
        const result = await client.query(checkDbQuery);

        if (result.rows.length === 0) {
            // Create database
            const createDbQuery = `CREATE DATABASE ${process.env.DB_NAME}`;
            await client.query(createDbQuery);
            console.log(`Database '${process.env.DB_NAME}' created successfully`);
        } else {
            console.log(`Database '${process.env.DB_NAME}' already exists`);
        }

    } catch (error) {
        console.error('Error creating database:', error);
        throw error;
    } finally {
        await client.end();
    }
}

// Run if this file is executed directly
if (require.main === module) {
    createDatabase();
}

module.exports = createDatabase;