const https = require('https');
const querystring = require('querystring');
const fs = require('fs').promises;
const readline = require('readline');
require('dotenv').config();

async function directOAuthSetup() {
    const credentialsPath = process.env.GOOGLE_SHEETS_CREDENTIALS_PATH;

    console.log('🔧 Direct Google Sheets OAuth2 Setup');
    console.log('====================================');
    console.log('\n📋 STEP 1: Configure Google Cloud Console');
    console.log('1. Go to https://console.cloud.google.com/');
    console.log('2. Navigate to APIs & Services > Credentials');
    console.log('3. Find your OAuth 2.0 Client ID:');
    console.log('   840315095267-u9fdt3jegg4tsi77rb394361ankj2emt.apps.googleusercontent.com');
    console.log('4. Click on it to edit');
    console.log('5. In "Authorized redirect URIs", add:');
    console.log('   • http://localhost:3000/oauth/callback');
    console.log('6. Save the changes');
    console.log('7. Wait 2-3 minutes for changes to propagate');

    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout
    });

    const ready = await new Promise((resolve) => {
        rl.question('\n❓ Have you added the redirect URI and waited a few minutes? (y/n): ', (answer) => {
            resolve(answer.toLowerCase() === 'y');
        });
    });

    if (!ready) {
        console.log('❌ Please complete the Google Cloud Console setup first.');
        rl.close();
        process.exit(1);
    }

    try {
        // Read current credentials
        const credentialsContent = await fs.readFile(credentialsPath, 'utf8');
        const credentials = JSON.parse(credentialsContent);

        // Generate auth URL manually
        const authParams = {
            client_id: credentials.client_id,
            redirect_uri: 'http://localhost:3000/oauth/callback',
            scope: 'https://www.googleapis.com/auth/spreadsheets',
            response_type: 'code',
            access_type: 'offline',
            prompt: 'consent'
        };

        const authUrl = 'https://accounts.google.com/o/oauth2/v2/auth?' + querystring.stringify(authParams);

        console.log('\n📋 STEP 2: Get Authorization Code');
        console.log('1. Copy the URL below and open it in your browser');
        console.log('2. Sign in to your Google account');
        console.log('3. Grant permissions to access Google Sheets');
        console.log('4. You will be redirected to localhost:3000 - copy ONLY the "code" parameter from the URL');
        console.log('\n🔗 Authorization URL:');
        console.log(authUrl);
        console.log('\n');

        // Prompt for authorization code
        const authCode = await new Promise((resolve) => {
            rl.question('📝 Enter ONLY the authorization code (the part after "code="): ', (code) => {
                resolve(code.trim());
            });
        });

        rl.close();

        if (!authCode) {
            console.log('❌ No authorization code provided. Setup cancelled.');
            process.exit(1);
        }

        console.log('\n⏳ Exchanging authorization code for tokens...');

        // Exchange code for tokens using direct HTTP request
        const tokenData = querystring.stringify({
            client_id: credentials.client_id,
            client_secret: credentials.client_secret,
            code: authCode,
            grant_type: 'authorization_code',
            redirect_uri: 'http://localhost:3000/oauth/callback'
        });

        const tokenResponse = await new Promise((resolve, reject) => {
            const options = {
                hostname: 'oauth2.googleapis.com',
                port: 443,
                path: '/token',
                method: 'POST',
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded',
                    'Content-Length': Buffer.byteLength(tokenData)
                }
            };

            const req = https.request(options, (res) => {
                let data = '';
                res.on('data', (chunk) => {
                    data += chunk;
                });
                res.on('end', () => {
                    try {
                        const parsed = JSON.parse(data);
                        if (res.statusCode === 200) {
                            resolve(parsed);
                        } else {
                            reject(new Error(`HTTP ${res.statusCode}: ${parsed.error_description || parsed.error || data}`));
                        }
                    } catch (error) {
                        reject(new Error(`Failed to parse response: ${data}`));
                    }
                });
            });

            req.on('error', (error) => {
                reject(error);
            });

            req.write(tokenData);
            req.end();
        });

        console.log('✅ Tokens received successfully!');
        console.log('   Access Token:', tokenResponse.access_token ? 'Present' : 'Missing');
        console.log('   Refresh Token:', tokenResponse.refresh_token ? 'Present' : 'Missing');

        // Update credentials file
        const updatedCredentials = {
            ...credentials,
            redirect_uri: 'http://localhost:3000/oauth/callback',
            refresh_token: tokenResponse.refresh_token,
            access_token: tokenResponse.access_token,
            expiry_date: tokenResponse.expires_in ? Date.now() + (tokenResponse.expires_in * 1000) : null
        };

        await fs.writeFile(credentialsPath, JSON.stringify(updatedCredentials, null, 2));

        console.log('✅ Credentials file updated successfully!');
        console.log('\n🧪 Testing the connection...');

        // Test the connection using direct HTTP request
        const testResponse = await new Promise((resolve, reject) => {
            const options = {
                hostname: 'sheets.googleapis.com',
                port: 443,
                path: `/v4/spreadsheets/${process.env.GOOGLE_SHEETS_SPREADSHEET_ID}`,
                method: 'GET',
                headers: {
                    'Authorization': `Bearer ${tokenResponse.access_token}`
                }
            };

            const req = https.request(options, (res) => {
                let data = '';
                res.on('data', (chunk) => {
                    data += chunk;
                });
                res.on('end', () => {
                    try {
                        const parsed = JSON.parse(data);
                        if (res.statusCode === 200) {
                            resolve(parsed);
                        } else {
                            reject(new Error(`HTTP ${res.statusCode}: ${parsed.error?.message || data}`));
                        }
                    } catch (error) {
                        reject(new Error(`Failed to parse response: ${data}`));
                    }
                });
            });

            req.on('error', (error) => {
                reject(error);
            });

            req.end();
        });

        console.log('✅ Connection test successful!');
        console.log('📊 Spreadsheet:', testResponse.properties.title);
        console.log('📄 Sheets:', testResponse.sheets.length);
        console.log('\n🎉 Setup complete! Run "npm run test:connections" to verify all services.');

    } catch (error) {
        console.error('❌ Setup failed:', error.message);
        console.log('\n🔍 Troubleshooting:');
        console.log('- Verify the authorization code is complete and correct');
        console.log('- Make sure the redirect URI in Google Console is exactly: http://localhost:3000/oauth/callback');
        console.log('- Try waiting a few more minutes for Google Console changes to propagate');
        console.log('- Generate a new authorization code and try again');
        process.exit(1);
    }
}

// Run setup if this file is executed directly
if (require.main === module) {
    directOAuthSetup();
}

module.exports = directOAuthSetup;