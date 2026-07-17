/**
 * Database Migration: Create Campaign Automation Tables
 * Run with: node scripts/campaigns-migration.js
 */

const LeadsCampaign = require('../models/LeadsCampaign');
const CampaignTemplate = require('../models/CampaignTemplate');
const CampaignExecution = require('../models/CampaignExecution');
const LeadSource = require('../models/LeadSource');
const WhatsAppConnection = require('../models/WhatsAppConnection');
const SmtpConnection = require('../models/SmtpConnection');

async function runMigration(databaseService) {
    console.log('\n=== Running Campaign Automation Migration ===\n');

    try {
        // Create instances of models
        const leadsCampaign = new LeadsCampaign(databaseService);
        const campaignTemplate = new CampaignTemplate(databaseService);
        const campaignExecution = new CampaignExecution(databaseService);
        const leadSource = new LeadSource(databaseService);
        const whatsAppConnection = new WhatsAppConnection(databaseService);
        const smtpConnection = new SmtpConnection(databaseService);

        // Create tables in order (parent tables first)
        console.log('Creating leads_sources table...');
        await leadSource.createTable();

        console.log('Creating campaign_templates table...');
        await campaignTemplate.createTable();

        console.log('Creating leads_campaigns table...');
        await leadsCampaign.createTable();

        console.log('Creating campaign_executions table...');
        await campaignExecution.createTable();

        console.log('Creating whatsapp_connections table...');
        await whatsAppConnection.createTable();

        console.log('Creating smtp_connections table...');
        await smtpConnection.createTable();

        console.log('\n✅ All campaign automation tables created successfully!\n');

        // Create contact channel mapping table (optional, for future optimization)
        console.log('Creating contact_channel_mapping table...');
        const client = await databaseService.pool.connect();
        try {
            const checkTableQuery = `
                SELECT EXISTS (
                    SELECT FROM information_schema.tables 
                    WHERE table_name = 'contact_channel_mapping'
                );
            `;
            const tableCheck = await client.query(checkTableQuery);
            
            if (!tableCheck.rows[0].exists) {
                const createTableQuery = `
                    CREATE TABLE IF NOT EXISTS contact_channel_mapping (
                        id SERIAL PRIMARY KEY,
                        lead_id VARCHAR(255) NOT NULL,
                        user_email VARCHAR(255) NOT NULL,
                        source_type VARCHAR(50),
                        email_address VARCHAR(255),
                        phone_number VARCHAR(20),
                        whatsapp_handle VARCHAR(255),
                        linkedin_url VARCHAR(255),
                        twitter_handle VARCHAR(255),
                        instagram_handle VARCHAR(255),
                        facebook_url VARCHAR(255),
                        tiktok_handle VARCHAR(255),
                        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                    );
                `;
                await client.query(createTableQuery);
                await client.query('CREATE INDEX IF NOT EXISTS idx_contact_channel_lead ON contact_channel_mapping(lead_id);');
                await client.query('CREATE INDEX IF NOT EXISTS idx_contact_channel_user ON contact_channel_mapping(user_email);');
                console.log('contact_channel_mapping table created successfully');
            }
        } finally {
            client.release();
        }

        return true;
    } catch (error) {
        console.error('❌ Migration failed:', error);
        throw error;
    }
}

module.exports = runMigration;
