const { google } = require('googleapis');
const fs = require('fs').promises;
const http = require('http');
const url = require('url');
require('dotenv').config();

async function setupOAuth() {
    const credentialsPath = process.env.GOOGLE_SHEETS_CREDENTIALS_PATH;

    try {
        // Read current credentials
        const credentialsContent = await fs.readFile(credentialsPath, 'utf8');
        const credentials = JSON.parse(credentialsContent);

        // Create OAuth2 client
        const oauth2Client = new google.auth.OAuth2(
            credentials.client_id,
            credentials.client_secret,
            credentials.redirect_uri
        );

        // Generate auth URL
        const authUrl = oauth2Client.generateAuthUrl({
            access_type: 'offline',
            scope: ['https://www.googleapis.com/auth/spreadsheets'],
            prompt: 'consent'
        });

        console.log('Setting up Google Sheets OAuth2...');
        console.log('\n⚠️  IMPORTANT: Redirect URI Configuration');
        console.log('Make sure your Google Cloud Console OAuth client has this redirect URI:');
        console.log('👉 http://localhost:3000/oauth/callback');
        console.log('\nTo add it:');
        console.log('1. Go to https://console.cloud.google.com/');
        console.log('2. Navigate to APIs & Services > Credentials');
        console.log('3. Edit your OAuth 2.0 Client ID');
        console.log('4. Add "http://localhost:3000/oauth/callback" to Authorized redirect URIs');
        console.log('5. Save the changes');
        console.log('6. Wait a few minutes for changes to propagate');
        console.log('\n📋 SETUP INSTRUCTIONS:');
        console.log('1. Copy the URL below and open it in your browser');
        console.log('2. Sign in to your Google account');
        console.log('3. Grant permissions to access Google Sheets');
        console.log('4. You will be redirected to localhost:3000 - this is expected');
        console.log('\n🔗 Authorization URL:');
        console.log(authUrl);
        console.log('\n⏳ Starting local server on http://localhost:3000...');

        // Start local server to handle callback
        const server = http.createServer(async (req, res) => {
            const parsedUrl = url.parse(req.url, true);

            if (parsedUrl.pathname === '/oauth/callback') {
                const code = parsedUrl.query.code;

                if (code) {
                    try {
                        console.log('Exchanging authorization code for tokens...');

                        // Exchange code for tokens
                        const tokenResponse = await oauth2Client.getAccessToken(code);
                        console.log('Token response received:', tokenResponse ? 'Success' : 'Failed');

                        if (!tokenResponse || !tokenResponse.tokens) {
                            throw new Error('Invalid token response from Google OAuth');
                        }

                        const tokens = tokenResponse.tokens;
                        console.log('Tokens received:', {
                            hasAccessToken: !!tokens.access_token,
                            hasRefreshToken: !!tokens.refresh_token,
                            expiryDate: tokens.expiry_date
                        });

                        // Update credentials file
                        const updatedCredentials = {
                            ...credentials,
                            refresh_token: tokens.refresh_token,
                            access_token: tokens.access_token,
                            expiry_date: tokens.expiry_date
                        };

                        await fs.writeFile(credentialsPath, JSON.stringify(updatedCredentials, null, 2));

                        res.writeHead(200, { 'Content-Type': 'text/html' });
                        res.end(`
              <html>
                <head><title>OAuth Setup Complete</title></head>
                <body style="font-family: Arial, sans-serif; text-align: center; padding: 50px;">
                  <h1 style="color: green;">✅ OAuth Setup Complete!</h1>
                  <p>Google Sheets credentials have been configured successfully.</p>
                  <p>You can close this window and return to the terminal.</p>
                  <p><strong>Next step:</strong> Run <code>npm run test:connections</code> to verify the setup.</p>
                </body>
              </html>
            `);

                        console.log('\n✅ OAuth setup completed successfully!');
                        console.log('Google Sheets credentials have been updated.');
                        console.log('Run "npm run test:connections" to verify the setup.');

                        setTimeout(() => {
                            server.close();
                            process.exit(0);
                        }, 2000);

                    } catch (error) {
                        console.error('Error exchanging code for tokens:', error);
                        res.writeHead(500, { 'Content-Type': 'text/html' });
                        res.end(`
              <html>
                <head><title>OAuth Setup Failed</title></head>
                <body style="font-family: Arial, sans-serif; text-align: center; padding: 50px;">
                  <h1 style="color: red;">❌ OAuth Setup Failed</h1>
                  <p>Error: ${error.message}</p>
                  <p>Please check the console for more details.</p>
                </body>
              </html>
            `);
                    }
                } else {
                    res.writeHead(400, { 'Content-Type': 'text/html' });
                    res.end(`
            <html>
              <head><title>Authorization Failed</title></head>
              <body style="font-family: Arial, sans-serif; text-align: center; padding: 50px;">
                <h1 style="color: red;">❌ Authorization Failed</h1>
                <p>No authorization code received.</p>
                <p>Please try the setup process again.</p>
              </body>
            </html>
          `);
                }
            } else {
                res.writeHead(404, { 'Content-Type': 'text/plain' });
                res.end('Not Found');
            }
        });

        server.listen(3000, () => {
            console.log('\n🚀 Local server is ready and waiting for authorization...');
            console.log('After completing authorization in your browser, return here for confirmation.');
        });

        // Handle server errors
        server.on('error', (error) => {
            if (error.code === 'EADDRINUSE') {
                console.error('\n❌ Port 3000 is already in use.');
                console.error('Please stop any other services running on port 3000 and try again.');
            } else {
                console.error('Server error:', error);
            }
            process.exit(1);
        });

    } catch (error) {
        console.error('OAuth setup failed:', error.message);
        process.exit(1);
    }
}

// Run setup if this file is executed directly
if (require.main === module) {
    setupOAuth();
}

module.exports = setupOAuth;