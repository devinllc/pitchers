const DatabaseService = require('./services/database');
const AdminController = require('./controllers/adminController');
const dotenv = require('dotenv');

dotenv.config();

async function run() {
    const db = new DatabaseService();
    const adminController = new AdminController();
    adminController.databaseService = db; // Inject the database service manually

    try {
        console.log('Testing AdminController.getAllLeads...');
        
        // Mock req and res objects
        const req = {
            query: { page: 1, limit: 5 },
            body: { searchTerm: '', filterCity: '', filterKeyword: '' }
        };

        const res = {
            json: (response) => {
                console.log('getAllLeads Response Success:', response.success);
                console.log('Leads Count:', response.data.length);
                if (response.data.length > 0) {
                    console.log('Keys of returned leads:', Object.keys(response.data[0]));
                    console.log('Sample Lead Status, Notes, Tags:', {
                        id: response.data[0].id,
                        name: response.data[0].name,
                        status: response.data[0].status,
                        notes: response.data[0].notes,
                        tags: response.data[0].tags
                    });
                }
            },
            status: (code) => ({
                json: (errResponse) => {
                    console.error(`Error status ${code}:`, errResponse);
                }
            })
        };

        await adminController.getAllLeads(req, res);
    } catch (err) {
        console.error('❌ Error testing admin controller:', err);
    } finally {
        await db.pool.end();
    }
}

run();
