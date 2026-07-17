const DatabaseService = require('./services/database');
const UserDataService = require('./services/userDataService');
const dotenv = require('dotenv');

dotenv.config();

async function run() {
    const db = new DatabaseService();
    const service = new UserDataService(db);

    try {
        console.log('Initializing UserDataService...');
        await service.initialize();

        // Let's find one user_email that exists in the database
        const client = await db.pool.connect();
        const users = await client.query('SELECT DISTINCT user_email FROM business_data LIMIT 5');
        console.log('Users in database:', users.rows);
        
        if (users.rows.length > 0) {
            const testEmail = users.rows[0].user_email;
            console.log(`Fetching user data for test email: ${testEmail}...`);
            const data = await service.getAllUserData(testEmail, { limit: 5 });
            console.log('Retrieved rows structure:', data.length > 0 ? Object.keys(data[0]) : 'No data found');
            console.log('Sample row status, notes, tags:', data.length > 0 ? {
                id: data[0].id,
                name: data[0].name,
                status: data[0].status,
                notes: data[0].notes,
                tags: data[0].tags
            } : 'No data found');

            console.log('\nTesting CSV export content structure...');
            const csvData = await service.exportUserDataToCSV(testEmail, { limit: 5 });
            console.log('CSV mapping fields:', csvData.length > 0 ? Object.keys(csvData[0]) : 'No data');
            console.log('Sample CSV row:', csvData.length > 0 ? csvData[0] : 'No data');
        } else {
            console.log('No users found in business_data table.');
        }
        client.release();
    } catch (err) {
        console.error('❌ Error executing check:', err);
    } finally {
        await db.pool.end();
    }
}

run();
