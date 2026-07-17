const DatabaseService = require('../services/database');

async function setupDatabase() {
    const db = new DatabaseService();

    try {
        console.log('Setting up database...');

        // Test connection
        await db.connect();

        // Create businesses table
        await db.createBusinessesTable();

        // Test the connection
        await db.testConnection();

        console.log('Database setup completed successfully!');

    } catch (error) {
        console.error('Database setup failed:', error);
        process.exit(1);
    } finally {
        await db.close();
    }
}

// Run setup if this file is executed directly
if (require.main === module) {
    setupDatabase();
}

module.exports = setupDatabase;