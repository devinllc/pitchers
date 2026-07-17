const { google } = require('googleapis');
const fs = require('fs').promises;
const readline = require('readline');
require('dotenv').config();

async function manualOAuthSetup() {
    const credentialsPath = process.env.GOOGLE_SHEETS_CREDENTIALS_PATH;

    try {
        // Read current credentials
        const credentialsContent = await fs.readFile(credentialsPath, 'utf8');
        const credentials = JSON.parse(credentialsContent);

        // Create OAuth2 client with urn:ietf:wg:oauth:2.0:oob redirect URI (for manual flow)
        const oauth2Client = new google.auth.OAuth2(
            credentials.client_id,
            credentials.client_secret,
            'urn:ietf:wg:oauth:2.0:oob'  // This is for manual/desktop apps
        );

        // Generate auth URL
        const authUrl = oauth2Client.generateAuthUrl({
            access_type: 'offline',
            scope: ['https://www.googleapis.com/auth/spreadsheets'],
            prompt: 'consent'
        });

        console.log('🔧 Manual Google Sheets OAuth2 Setup');
        console.log('=====================================');
        console.log('\n📋 INSTRUCTIONS:');
        console.log('1. Copy the URL below and open it in your browser');
        console.log('2. Sign in to your Google account');
        console.log('3. Grant permissions to access Google Sheets');
        console.log('4. Copy the authorization code from the browser');
        console.log('5. Paste it here when prompted');
        console.log('\n🔗 Authorization URL:');
        console.log(authUrl);
        console.log('\n');

        // Create readline interface
        const rl = readline.createInterface({
            input: process.stdin,
            output: process.stdout
        });

        // Prompt for authorization code
        const authCode = await new Promise((resolve) => {
            rl.question('📝 Enter the authorization code from your browser: ', (code) => {
                resolve(code.trim());
            });
        });

        rl.close();

        if (!authCode) {
            console.log('❌ No authorization code provided. Setup cancelled.');
            process.exit(1);
        }

        console.log('\n⏳ Exchanging authorization code for tokens...');

        try {
            // Exchange code for tokens
            const tokenResponse = await oauth2Client.getAccessToken(authCode);

            if (!tokenResponse || !tokenResponse.tokens) {
                throw new Error('Invalid token response from Google OAuth');
            }

            const tokens = tokenResponse.tokens;

            // Update credentials file
            const updatedCredentials = {
                ...credentials,
                refresh_token: tokens.refresh_token,
                access_token: tokens.access_token,
                expiry_date: tokens.expiry_date
            };

            await fs.writeFile(credentialsPath, JSON.stringify(updatedCredentials, null, 2));

            console.log('✅ OAuth setup completed successfully!');
            console.log('Google Sheets credentials have been updated.');
            console.log('\n🧪 Testing the connection...');

            // Test the connection
            oauth2Client.setCredentials(tokens);
            const sheets = google.sheets({ version: 'v4', auth: oauth2Client });

            const response = await sheets.spreadsheets.get({
                spreadsheetId: process.env.GOOGLE_SHEETS_SPREADSHEET_ID
            });

            console.log('✅ Connection test successful!');
            console.log('📊 Spreadsheet:', response.data.properties.title);
            console.log('\n🎉 Setup complete! Run "npm run test:connections" to verify all services.');

        } catch (error) {
            console.error('❌ Error exchanging code for tokens:', error.message);
            console.log('\nTroubleshooting:');
            console.log('- Make sure you copied the entire authorization code');
            console.log('- Verify your Google Cloud Console OAuth client is configured correctly');
            console.log('- Try generating a new authorization code');
            process.exit(1);
        }

    } catch (error) {
        console.error('❌ Manual OAuth setup failed:', error.message);
        process.exit(1);
    }
}

// Run setup if this file is executed directly
if (require.main === module) {
    manualOAuthSetup();
}

module.exports = manualOAuthSetup;