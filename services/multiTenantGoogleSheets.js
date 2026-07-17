const { google } = require('googleapis');
const ErrorHandler = require('./errorHandler');
const UserGoogleSheet = require('../models/UserGoogleSheet');
require('dotenv').config();

class MultiTenantGoogleSheetsService {
    constructor(databaseService) {
        this.db = databaseService;
        this.userGoogleSheet = new UserGoogleSheet(databaseService);
        this.errorHandler = new ErrorHandler();
        this.clientId = process.env.GOOGLE_SHEETS_OAUTH_CLIENT_ID || process.env.GOOGLE_OAUTH_CLIENT_ID;
        this.clientSecret = process.env.GOOGLE_SHEETS_OAUTH_CLIENT_SECRET || process.env.GOOGLE_OAUTH_CLIENT_SECRET;

        const configuredRedirectUri = process.env.GOOGLE_SHEETS_OAUTH_REDIRECT_URI || process.env.GOOGLE_OAUTH_REDIRECT_URI;
        const defaultRedirectUri = 'http://localhost:3000/oauth/google-sheets/callback';

        // Guard against reusing app-login callback for Sheets OAuth.
        if (!process.env.GOOGLE_SHEETS_OAUTH_REDIRECT_URI && configuredRedirectUri && configuredRedirectUri.includes('/auth/google/callback')) {
            this.redirectUri = configuredRedirectUri.replace('/auth/google/callback', '/oauth/google-sheets/callback');
        } else {
            this.redirectUri = configuredRedirectUri || defaultRedirectUri;
        }
        
        if (!this.clientId || !this.clientSecret) {
            throw new Error('Google OAuth credentials are required');
        }
    }

    getOAuthConfigSummary() {
        const maskedClientId = this.clientId
            ? `${this.clientId.slice(0, 12)}...${this.clientId.slice(-10)}`
            : null;

        return {
            clientIdMasked: maskedClientId,
            redirectUri: this.redirectUri,
            usingDedicatedSheetsClient: Boolean(process.env.GOOGLE_SHEETS_OAUTH_CLIENT_ID),
            usingDedicatedSheetsRedirect: Boolean(process.env.GOOGLE_SHEETS_OAUTH_REDIRECT_URI)
        };
    }

    // Initialize database tables
    async initialize() {
        try {
            await this.userGoogleSheet.createUserGoogleSheetsTable();
            await this.userGoogleSheet.createBusinessDataTable();
            console.log('Multi-tenant Google Sheets service initialized');
        } catch (error) {
            console.error('Error initializing multi-tenant Google Sheets service:', error);
            throw error;
        }
    }

    // Create OAuth2 client
    createOAuth2Client() {
        return new google.auth.OAuth2(
            this.clientId,
            this.clientSecret,
            this.redirectUri
        );
    }

    // Generate OAuth URL for user to connect Google Sheets
    generateAuthUrl(userEmail, state = null, redirectTo = null) {
        const oauth2Client = this.createOAuth2Client();
        
        const scopes = [
            'https://www.googleapis.com/auth/spreadsheets',
            'https://www.googleapis.com/auth/drive.file'
        ];

        // Combine user email and redirect_to in state parameter
        const stateData = {
            userEmail: userEmail,
            redirectTo: redirectTo
        };
        const stateString = JSON.stringify(stateData);

        const authUrl = oauth2Client.generateAuthUrl({
            access_type: 'offline',
            scope: scopes,
            state: stateString, // Pass combined state data
            prompt: 'consent'
        });

        return authUrl;
    }

    // Handle OAuth callback and save user credentials
    async handleOAuthCallback(code, state) {
        try {
            const oauth2Client = this.createOAuth2Client();
            const { tokens } = await oauth2Client.getToken(code);
            
            // Parse state to extract user email and redirect_to
            let userEmail, redirectTo;
            try {
                const stateData = JSON.parse(state);
                userEmail = stateData.userEmail;
                redirectTo = stateData.redirectTo;
            } catch (e) {
                // Fallback: treat state as user email directly (backward compatibility)
                userEmail = state;
                redirectTo = null;
            }

            oauth2Client.setCredentials(tokens);

            // Store tokens for this user
            const tokenData = {
                access_token: tokens.access_token,
                refresh_token: tokens.refresh_token,
                token_expires_at: tokens.expiry_date ? new Date(tokens.expiry_date) : null
            };

            // Save OAuth credentials for user (without specific sheet)
            await this.saveUserOAuthCredentials(userEmail, tokenData);

            return {
                success: true,
                userEmail,
                redirectTo,
                message: 'Google account connected successfully'
            };

        } catch (error) {
            console.error('Error handling OAuth callback:', error);
            throw error;
        }
    }

    // Save user OAuth credentials
    async saveUserOAuthCredentials(userEmail, tokenData) {
        const insertQuery = `
            INSERT INTO user_google_sheets (
                user_email, sheet_id, sheet_name, access_token, refresh_token, token_expires_at, is_active
            )
            VALUES ($1, 'oauth_credentials', 'OAuth Credentials', $2, $3, $4, true)
            ON CONFLICT (user_email, sheet_id) 
            DO UPDATE SET 
                access_token = EXCLUDED.access_token,
                refresh_token = EXCLUDED.refresh_token,
                token_expires_at = EXCLUDED.token_expires_at,
                is_active = true,
                updated_at = CURRENT_TIMESTAMP
            RETURNING *;
        `;

        try {
            const client = await this.db.pool.connect();
            const result = await client.query(insertQuery, [
                userEmail,
                tokenData.access_token,
                tokenData.refresh_token,
                tokenData.token_expires_at
            ]);
            client.release();
            return result.rows[0];
        } catch (error) {
            console.error('Error saving user OAuth credentials:', error);
            throw error;
        }
    }

    // Get user's OAuth credentials
    async getUserOAuthCredentials(userEmail) {
        const selectQuery = `
            SELECT access_token, refresh_token, token_expires_at
            FROM user_google_sheets 
            WHERE user_email = $1 AND sheet_id = 'oauth_credentials';
        `;

        try {
            const client = await this.db.pool.connect();
            const result = await client.query(selectQuery, [userEmail]);
            client.release();
            // Removed success log to reduce console spam
            // console.log(`getUserOAuthCredentials for ${userEmail}: found ${result.rows.length} rows`);
            if (result.rows.length === 0) {
                // Debug: check what credentials exist for this user
                const debugQuery = `SELECT user_email, sheet_id, sheet_name, is_active FROM user_google_sheets WHERE user_email = $1`;
                const debugClient = await this.db.pool.connect();
                const debugResult = await debugClient.query(debugQuery, [userEmail]);
                debugClient.release();
                console.log(`Debug - all records for ${userEmail}:`, debugResult.rows);
            }
            return result.rows[0] || null;
        } catch (error) {
            console.error('Error getting user OAuth credentials:', error);
            throw error;
        }
    }

    // Clear user's OAuth credentials (when they become invalid)
    async clearUserOAuthCredentials(userEmail) {
        const deleteQuery = `
            DELETE FROM user_google_sheets 
            WHERE user_email = $1 AND sheet_id = 'oauth_credentials';
        `;

        try {
            const client = await this.db.pool.connect();
            await client.query(deleteQuery, [userEmail]);
            client.release();
            console.log(`Cleared OAuth credentials for ${userEmail}`);
        } catch (error) {
            console.error('Error clearing user OAuth credentials:', error);
            throw error;
        }
    }

    // Create authenticated OAuth2 client for user
    async createUserOAuth2Client(userEmail) {
        const credentials = await this.getUserOAuthCredentials(userEmail);
        if (!credentials) {
            throw new Error('User has not connected their Google account');
        }

        const oauth2Client = this.createOAuth2Client();
        oauth2Client.setCredentials({
            access_token: credentials.access_token,
            refresh_token: credentials.refresh_token,
            expiry_date: credentials.token_expires_at ? new Date(credentials.token_expires_at).getTime() : null
        });

        // Set up token refresh handler
        oauth2Client.on('tokens', async (tokens) => {
            try {
                await this.saveUserOAuthCredentials(userEmail, {
                    access_token: tokens.access_token,
                    refresh_token: tokens.refresh_token || credentials.refresh_token,
                    token_expires_at: tokens.expiry_date ? new Date(tokens.expiry_date) : null
                });
            } catch (error) {
                console.error('Error updating user tokens:', error);
            }
        });

        return oauth2Client;
    }

    // Get user's Google Sheets list
    async getUserGoogleSheetsList(userEmail) {
        try {
            // Check if user has OAuth credentials first
            const credentials = await this.getUserOAuthCredentials(userEmail);
            if (!credentials) {
                return []; // Return empty array instead of throwing error
            }

            const oauth2Client = await this.createUserOAuth2Client(userEmail);
            const drive = google.drive({ version: 'v3', auth: oauth2Client });

            const response = await drive.files.list({
                q: "mimeType='application/vnd.google-apps.spreadsheet'",
                fields: 'files(id, name, webViewLink)',
                pageSize: 100
            });

            return response.data.files.map(file => ({
                id: file.id,
                name: file.name,
                url: file.webViewLink
            }));

        } catch (error) {
            console.error('Error getting user Google Sheets list:', error);
            
            // If it's an OAuth error, mark credentials as invalid
            if (error.message && error.message.includes('unauthorized_client')) {
                console.log(`OAuth credentials invalid for ${userEmail}, clearing credentials`);
                try {
                    await this.clearUserOAuthCredentials(userEmail);
                } catch (clearError) {
                    console.error('Error clearing invalid credentials:', clearError);
                }
            }
            
            return []; // Return empty array instead of throwing error
        }
    }

    // Create new Google Sheet for user
    async createUserGoogleSheet(userEmail, sheetName) {
        try {
            const oauth2Client = await this.createUserOAuth2Client(userEmail);
            const sheets = google.sheets({ version: 'v4', auth: oauth2Client });

            // Create new spreadsheet
            const response = await sheets.spreadsheets.create({
                resource: {
                    properties: {
                        title: sheetName
                    },
                    sheets: [{
                        properties: {
                            title: 'Business Data'
                        }
                    }]
                }
            });

            const spreadsheet = response.data;
            const sheetId = spreadsheet.spreadsheetId;
            const sheetUrl = `https://docs.google.com/spreadsheets/d/${sheetId}/edit`;

            // Add headers to the sheet
            await sheets.spreadsheets.values.update({
                spreadsheetId: sheetId,
                range: 'Business Data!A1:K1',
                valueInputOption: 'RAW',
                resource: {
                    values: [['Name', 'Address', 'Phone', 'Website', 'Email', 'LinkedIn', 'Facebook', 'Instagram', 'Twitter', 'YouTube', 'TikTok']]
                }
            });

            // Save sheet info to database
            await this.userGoogleSheet.saveUserGoogleSheet(userEmail, {
                sheet_id: sheetId,
                sheet_name: sheetName,
                sheet_url: sheetUrl,
                access_token: oauth2Client.credentials.access_token,
                refresh_token: oauth2Client.credentials.refresh_token,
                token_expires_at: oauth2Client.credentials.expiry_date ? new Date(oauth2Client.credentials.expiry_date) : null
            });

            return {
                id: sheetId,
                name: sheetName,
                url: sheetUrl
            };

        } catch (error) {
            console.error('Error creating user Google Sheet:', error);
            throw error;
        }
    }

    // Connect existing Google Sheet for user
    async connectUserGoogleSheet(userEmail, sheetId) {
        try {
            const oauth2Client = await this.createUserOAuth2Client(userEmail);
            const sheets = google.sheets({ version: 'v4', auth: oauth2Client });

            // Get sheet info
            const response = await sheets.spreadsheets.get({
                spreadsheetId: sheetId
            });

            const spreadsheet = response.data;
            const sheetName = spreadsheet.properties.title;
            const sheetUrl = `https://docs.google.com/spreadsheets/d/${sheetId}/edit`;

            // Save sheet info to database
            await this.userGoogleSheet.saveUserGoogleSheet(userEmail, {
                sheet_id: sheetId,
                sheet_name: sheetName,
                sheet_url: sheetUrl,
                access_token: oauth2Client.credentials.access_token,
                refresh_token: oauth2Client.credentials.refresh_token,
                token_expires_at: oauth2Client.credentials.expiry_date ? new Date(oauth2Client.credentials.expiry_date) : null
            });

            return {
                id: sheetId,
                name: sheetName,
                url: sheetUrl
            };

        } catch (error) {
            console.error('Error connecting user Google Sheet:', error);
            throw error;
        }
    }

    // Save business data to user's specific Google Sheet
    async saveBusinessDataToUserSheet(userEmail, sheetId, businessData, jobId = null) {
        try {
            // Save to database first
            await this.userGoogleSheet.saveBusinessData(userEmail, businessData, jobId, sheetId);

            // Get user's sheet credentials
            const credentials = await this.userGoogleSheet.getUserSheetCredentials(userEmail, sheetId);
            if (!credentials) {
                throw new Error('Sheet not found for user');
            }

            // Create OAuth client for this specific sheet
            const oauth2Client = this.createOAuth2Client();
            oauth2Client.setCredentials({
                access_token: credentials.access_token,
                refresh_token: credentials.refresh_token,
                expiry_date: credentials.token_expires_at ? new Date(credentials.token_expires_at).getTime() : null
            });

            const sheets = google.sheets({ version: 'v4', auth: oauth2Client });

            // Prepare row data
            const firstEmail = Array.isArray(businessData.contact && businessData.contact.emails)
                ? (businessData.contact.emails[0] || '')
                : businessData.email || '';

            const socials = businessData.socialProfiles || businessData.socials || {};
            const values = [[
                businessData.name || '',
                businessData.address || '',
                businessData.phone || '',
                businessData.website || '',
                firstEmail,
                socials.linkedin || businessData.linkedin || '',
                socials.facebook || businessData.facebook || '',
                socials.instagram || businessData.instagram || '',
                socials.twitter || socials.x || businessData.twitter || businessData.x || '',
                socials.youtube || businessData.youtube || '',
                socials.tiktok || businessData.tiktok || ''
            ]];

            // Append to sheet
            const response = await sheets.spreadsheets.values.append({
                spreadsheetId: sheetId,
                range: 'A:K',
                valueInputOption: 'RAW',
                resource: { values }
            });

            return {
                success: true,
                updatedRows: response.data.updates.updatedRows,
                updatedRange: response.data.updates.updatedRange,
                businessName: businessData.name
            };

        } catch (error) {
            console.error('Error saving business data to user sheet:', error);
            throw error;
        }
    }

    // Get user's connected Google Sheets
    async getUserConnectedSheets(userEmail) {
        return await this.userGoogleSheet.getUserGoogleSheets(userEmail);
    }

    // Get user's business data with pagination
    async getUserBusinessData(userEmail, options = {}) {
        return await this.userGoogleSheet.getUserBusinessData(userEmail, options);
    }

    // Get user's business data count
    async getUserBusinessDataCount(userEmail, options = {}) {
        return await this.userGoogleSheet.getUserBusinessDataCount(userEmail, options);
    }

    // Delete user's Google Sheet connection
    async deleteUserGoogleSheet(userEmail, sheetId) {
        return await this.userGoogleSheet.deleteUserGoogleSheet(userEmail, sheetId);
    }

    // Check if user has connected Google account
    async isUserConnected(userEmail) {
        try {
            const credentials = await this.getUserOAuthCredentials(userEmail);
            console.log(`isUserConnected for ${userEmail}:`, !!credentials, credentials ? 'has credentials' : 'no credentials');
            
            // If no OAuth credentials found, check if user has any sheets (which would mean credentials exist somewhere)
            if (!credentials) {
                const sheets = await this.getUserConnectedSheets(userEmail);
                // Removed success log to reduce console spam
                // console.log(`User ${userEmail} has ${sheets.length} connected sheets but no OAuth credentials found`);
                
                // If sheets exist but no OAuth credentials, there's a data inconsistency
                if (sheets.length > 0) {
                    console.log(`Data inconsistency detected for ${userEmail}: sheets exist but OAuth credentials missing`);
                    // Try to find any record with access_token for this user
                    const debugQuery = `SELECT sheet_id, sheet_name, access_token IS NOT NULL as has_token FROM user_google_sheets WHERE user_email = $1`;
                    const client = await this.db.pool.connect();
                    const result = await client.query(debugQuery, [userEmail]);
                    client.release();
                    console.log(`All records for ${userEmail}:`, result.rows);
                }
            }
            
            return !!credentials;
        } catch (error) {
            console.error(`Error checking if user ${userEmail} is connected:`, error);
            return false;
        }
    }
}

module.exports = MultiTenantGoogleSheetsService;
