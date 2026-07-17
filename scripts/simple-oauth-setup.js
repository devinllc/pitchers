const { google } = require('googleapis');
const fs = require('fs').promises;
const readline = require('readline');
require('dotenv').config();

async function simpleOAuthSetup() {
    const credentialsPath = process.env.GOOGLE_SHEETS_CREDENTIALS_PATH;

    console.log('🔧 Simple Google Sheets OAuth2 Setup');
    console.log('====================================');
    console.log('\n📋 STEP 1: Configure Google Cloud Console');
    console.log('1. Go to https://console.cloud.google.com/');
    console.log('2. Navigate to APIs & Services > Credentials');
    console.log('3. Find your OAuth 2.0 Client ID:');
    console.log('   840315095267-u9fdt3jegg4tsi77rb394361ankj2emt.apps.googleusercontent.com');
    console.log('4. Click on it to edit');
    console.log('5. In "Authorized redirect URIs", add ONE of these:');
    console.log('   • http://localhost:3000/oauth/callback');
    console.log('   • urn:ietf:wg:oauth:2.0:oob');
    console.log('6. Save the changes');
    console.log('7. Wait 2-3 minutes for changes to propagate');

    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout
    });

    const redirectChoice = await new Promise((resolve) => {
        rl.question('\n❓ Which redirect URI did you add? (1 for localhost, 2 for oob): ', (choice) => {
            resolve(choice.trim());
        });
    });

    let redirectUri;
    if (redirectChoice === '1') {
        redirectUri = 'http://localhost:3000/oauth/callback';
    } else if (redirectChoice === '2') {
        redirectUri = 'urn:ietf:wg:oauth:2.0:oob';
    } else {
        console.log('❌ Invalid choice. Please run the script again.');
        rl.close();
        process.exit(1);
    }

    try {
        // Read current credentials
        const credentialsContent = await fs.readFile(credentialsPath, 'utf8');
        const credentials = JSON.parse(credentialsContent);

        // Create OAuth2 client
        const oauth2Client = new google.auth.OAuth2(
            credentials.client_id,
            credentials.client_secret,
            redirectUri
        );

        // Generate auth URL
        const authUrl = oauth2Client.generateAuthUrl({
            access_type: 'offline',
            scope: ['https://www.googleapis.com/auth/spreadsheets'],
            prompt: 'consent'
        });

        console.log('\n📋 STEP 2: Get Authorization Code');
        console.log('1. Copy the URL below and open it in your browser');
        console.log('2. Sign in to your Google account');
        console.log('3. Grant permissions to access Google Sheets');
        if (redirectChoice === '1') {
            console.log('4. You will be redirected to localhost:3000 - copy the "code" parameter from the URL');
        } else {
            console.log('4. Copy the authorization code shown on the page');
        }
        console.log('\n🔗 Authorization URL:');
        console.log(authUrl);
        console.log('\n');

        // Prompt for authorization code
        const authCode = await new Promise((resolve) => {
            rl.question('📝 Enter the authorization code: ', (code) => {
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
            // Exchange code for tokens using the correct method
            const tokenResponse = await oauth2Client.getAccessToken(authCode);
            console.log('Raw token response:', tokenResponse);

            let tokens;
            if (tokenResponse && tokenResponse.tokens) {
                tokens = tokenResponse.tokens;
            } else if (tokenResponse && tokenResponse.access_token) {
                tokens = tokenResponse;
            } else {
                throw new Error('Unexpected token response format: ' + JSON.stringify(tokenResponse));
            }

            if (!tokens) {
                throw new Error('No tokens received from Google OAuth');
            }

            console.log('✅ Tokens received successfully!');
            console.log('   Access Token:', tokens.access_token ? 'Present' : 'Missing');
            console.log('   Refresh Token:', tokens.refresh_token ? 'Present' : 'Missing');

            // Update credentials file
            const updatedCredentials = {
                ...credentials,
                redirect_uri: redirectUri,
                refresh_token: tokens.refresh_token,
                access_token: tokens.access_token,
                expiry_date: tokens.expiry_date
            };

            await fs.writeFile(credentialsPath, JSON.stringify(updatedCredentials, null, 2));

            console.log('✅ Credentials file updated successfully!');
            console.log('\n🧪 Testing the connection...');

            // Test the connection
            oauth2Client.setCredentials(tokens);
            const sheets = google.sheets({ version: 'v4', auth: oauth2Client });

            const response = await sheets.spreadsheets.get({
                spreadsheetId: process.env.GOOGLE_SHEETS_SPREADSHEET_ID
            });

            console.log('✅ Connection test successful!');
            console.log('📊 Spreadsheet:', response.data.properties.title);
            console.log('📄 Sheets:', response.data.sheets.length);
            console.log('\n🎉 Setup complete! Run "npm run test:connections" to verify all services.');

        } catch (error) {
            console.error('❌ Error during token exchange:', error.message);
            console.log('\n🔍 Troubleshooting:');
            console.log('- Verify the authorization code is complete and correct');
            console.log('- Make sure the redirect URI in Google Console matches your choice');
            console.log('- Try waiting a few more minutes for Google Console changes to propagate');
            console.log('- Generate a new authorization code and try again');
            process.exit(1);
        }

    } catch (error) {
        console.error('❌ Setup failed:', error.message);
        process.exit(1);
    }
}

// Run setup if this file is executed directly
if (require.main === module) {
    simpleOAuthSetup();
}

module.exports = simpleOAuthSetup;