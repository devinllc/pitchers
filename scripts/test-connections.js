const DatabaseService = require('../services/database');
const GoogleSheetsService = require('../services/googleSheets');

async function testConnections() {
    console.log('Testing all service connections...\n');

    // Test Database Connection
    console.log('1. Testing PostgreSQL Database Connection...');
    const db = new DatabaseService();
    try {
        const dbSuccess = await db.testConnection();
        if (dbSuccess) {
            console.log('✅ Database connection successful\n');
        } else {
            console.log('❌ Database connection failed\n');
        }
    } catch (error) {
        console.log('❌ Database connection failed:', error.message, '\n');
    } finally {
        await db.close();
    }

    // Test Google Sheets Connection
    console.log('2. Testing Google Sheets Connection...');
    const sheets = new GoogleSheetsService();
    try {
        const sheetsSuccess = await sheets.testConnection();
        if (sheetsSuccess) {
            console.log('✅ Google Sheets connection successful\n');
        } else {
            console.log('❌ Google Sheets connection failed\n');
        }
    } catch (error) {
        console.log('❌ Google Sheets connection failed:', error.message, '\n');
    }

    console.log('Connection testing completed!');
}

// Run tests if this file is executed directly
if (require.main === module) {
    testConnections();
}

module.exports = testConnections;