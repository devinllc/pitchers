const DatabaseService = require('../services/database');
const ApiKey = require('../models/ApiKey');

async function setupApiKeyTables() {
    console.log('🚀 Setting up API Key tables...');
    
    const dbService = new DatabaseService();
    const apiKeyModel = new ApiKey(dbService);
    
    try {
        // Test database connection
        console.log('📡 Testing database connection...');
        const connectionTest = await dbService.testConnection();
        
        if (!connectionTest) {
            throw new Error('Database connection failed');
        }
        
        console.log('✅ Database connection successful');
        
        // Create API keys table
        console.log('📋 Creating API keys table...');
        await apiKeyModel.createApiKeysTable();
        console.log('✅ API keys table created successfully');
        
        // Create a sample free API key for testing
        console.log('🔑 Creating sample API key for testing...');
        const sampleApiKey = await apiKeyModel.createApiKey('test@example.com', 'free');
        
        console.log('✅ Sample API key created:');
        console.log(`   API Key: ${sampleApiKey.api_key}`);
        console.log(`   Email: ${sampleApiKey.user_email}`);
        console.log(`   Plan: ${sampleApiKey.plan_type}`);
        console.log(`   Usage Limit: ${sampleApiKey.usage_limit}`);
        console.log(`   Rate Limit: ${sampleApiKey.rate_limit_per_minute} requests/minute`);
        console.log(`   Expires: ${sampleApiKey.expires_at}`);
        
        console.log('\n🎉 API Key system setup completed successfully!');
        console.log('\n📚 Next steps:');
        console.log('1. Use the sample API key to test the SaaS endpoints');
        console.log('2. Create production API keys via POST /api-keys/create');
        console.log('3. Test the API endpoints at /api/v1/* with your API key');
        console.log('\n📖 API Key Usage:');
        console.log('- Include in Authorization header: "Bearer your-api-key"');
        console.log('- Or include in x-api-key header: "your-api-key"');
        console.log('- Or include as query parameter: ?api_key=your-api-key');
        
    } catch (error) {
        console.error('❌ Error setting up API Key tables:', error);
        throw error;
    } finally {
        await dbService.close();
        console.log('🔌 Database connection closed');
    }
}

// Run the setup if this script is executed directly
if (require.main === module) {
    setupApiKeyTables()
        .then(() => {
            console.log('✅ Setup completed successfully');
            process.exit(0);
        })
        .catch((error) => {
            console.error('❌ Setup failed:', error);
            process.exit(1);
        });
}

module.exports = { setupApiKeyTables };
