const { google } = require('googleapis');
const fs = require('fs').promises;
const path = require('path');
const ErrorHandler = require('./errorHandler');
const oauthStore = require('./oauthStore');
require('dotenv').config();

class GoogleSheetsService {
    constructor() {
        this.spreadsheetId = process.env.GOOGLE_SHEETS_SPREADSHEET_ID;
        this.credentialsPath = process.env.GOOGLE_SHEETS_CREDENTIALS_PATH;
        this.sheets = null;
        this.auth = null;
        this.mockMode = process.env.NODE_ENV === 'development' && process.env.GOOGLE_SHEETS_MOCK === 'true';
        this.errorHandler = new ErrorHandler();
        this.loadedFromStore = false; // true when credentials were loaded from oauthStore
    }

    async authenticate() {
        try {
            // Load credentials from env var first (serverless-safe), then file if configured
            let credentials;
            if (process.env.GOOGLE_SHEETS_OAUTH_JSON) {
                credentials = JSON.parse(process.env.GOOGLE_SHEETS_OAUTH_JSON);
                console.log('Using GOOGLE_SHEETS_OAUTH_JSON from environment.');
            } else {
                // Try DB-backed store (created by one-click OAuth)
                const stored = await oauthStore.get('google_sheets_oauth');
                if (stored && (stored.refresh_token || stored.access_token) && stored.client_id) {
                    credentials = stored;
                    console.log('Using Google Sheets credentials from oauthStore');
                    this.loadedFromStore = true;
                } else {
                    const credentialsExist = await this.checkCredentialsFile();
                    if (credentialsExist) {
                        const credentialsContent = await fs.readFile(this.credentialsPath, 'utf8');
                        credentials = JSON.parse(credentialsContent);
                        console.log('Using Google Sheets credentials from file:', this.credentialsPath);
                    } else {
                        console.log('Google Sheets credentials not provided. Skipping file template on serverless.');
                        await this.createCredentialsTemplate();
                        throw new Error('Provide Google Sheets credentials via GOOGLE_SHEETS_OAUTH_JSON (recommended on Vercel) or complete OAuth via /oauth/sheets/setup');
                    }
                }
            }

            // Check if credentials contain template/example data
            if (credentials._comment || credentials._oauth2_example || credentials._service_account_example) {
                throw new Error('Please replace the template credentials with actual Google credentials in ' + this.credentialsPath);
            }

            // Check if it's a service account or OAuth2 credentials
            if (credentials.type === 'service_account') {
                // Use service account authentication
                this.auth = new google.auth.GoogleAuth({
                    credentials: credentials,
                    scopes: ['https://www.googleapis.com/auth/spreadsheets']
                });
                console.log('Using Service Account authentication');
            } else if (credentials.client_id && (credentials.refresh_token || credentials.access_token)) {
                // Use OAuth2 authentication
                this.auth = new google.auth.OAuth2(
                    credentials.client_id,
                    credentials.client_secret,
                    credentials.redirect_uri
                );

                // Set refresh token
                this.auth.setCredentials({
                    refresh_token: credentials.refresh_token,
                    access_token: credentials.access_token
                });
                console.log('Using OAuth2 authentication');

                // Auto-persist refreshed tokens back to oauthStore when available
                // Only when credentials were loaded from store (avoid writing when sourced from env/file)
                if (this.loadedFromStore && typeof this.auth.on === 'function') {
                    this.auth.on('tokens', async (tokens) => {
                        try {
                            if (!tokens) return;
                            // Merge with existing tokens
                            const existing = (await oauthStore.get('google_sheets_tokens')) || {};
                            const updated = {
                                ...existing,
                                ...tokens,
                            };
                            // Normalize expiry_date if expires_in provided
                            if (typeof tokens.expiry_date === 'number') {
                                updated.expiry_date = tokens.expiry_date;
                            } else if (typeof tokens.expires_in === 'number') {
                                updated.expiry_date = Date.now() + tokens.expires_in * 1000;
                            }
                            await oauthStore.set('google_sheets_tokens', updated);
                            const client = await oauthStore.get('google_sheets_client');
                            if (client) {
                                await oauthStore.set('google_sheets_oauth', { ...client, ...updated });
                            }
                            console.log('Google Sheets tokens refreshed and persisted to store.');
                        } catch (e) {
                            console.warn('Failed to persist refreshed Google Sheets tokens:', e.message);
                        }
                    });
                }
            } else {
                console.warn('Google Sheets credentials are incomplete. Google Sheets functionality will be disabled.');
                console.warn('To enable Google Sheets, complete OAuth setup via /oauth/sheets/setup or provide GOOGLE_SHEETS_OAUTH_JSON');
                this.mockMode = true;
                return false; // Return false instead of throwing error
            }

            // Initialize Sheets API
            this.sheets = google.sheets({ version: 'v4', auth: this.auth });

            // Removed success log to reduce console spam
            // console.log('Google Sheets authentication successful');
            return true;
        } catch (error) {
            console.error('Google Sheets authentication failed:', error.message);
            throw error;
        }
    }

    async checkCredentialsFile() {
        try {
            if (!this.credentialsPath) return false;
            await fs.access(this.credentialsPath);
            return true;
        } catch {
            return false;
        }
    }

    async createCredentialsTemplate() {
        const template = {
            "_comment": "Choose ONE of the following authentication methods:",
            "_oauth2_example": {
                "client_id": "your_google_oauth_client_id",
                "client_secret": "your_google_oauth_client_secret",
                "redirect_uri": "http://localhost:3000/oauth/callback",
                "refresh_token": "your_refresh_token",
                "access_token": "your_access_token",
                "scope": "https://www.googleapis.com/auth/spreadsheets",
                "token_type": "Bearer",
                "expiry_date": 1234567890000
            },
            "_service_account_example": {
                "type": "service_account",
                "project_id": "your-project-id",
                "private_key_id": "your-private-key-id",
                "private_key": "-----BEGIN PRIVATE KEY-----\nyour-private-key\n-----END PRIVATE KEY-----\n",
                "client_email": "your-service-account@your-project.iam.gserviceaccount.com",
                "client_id": "your-client-id",
                "auth_uri": "https://accounts.google.com/o/oauth2/auth",
                "token_uri": "https://oauth2.googleapis.com/token",
                "auth_provider_x509_cert_url": "https://www.googleapis.com/oauth2/v1/certs",
                "client_x509_cert_url": "https://www.googleapis.com/robot/v1/metadata/x509/your-service-account%40your-project.iam.gserviceaccount.com"
            },
            "_instructions": "Remove the examples above and use one of the authentication methods. For development, service account is recommended."
        };

        if (!this.credentialsPath) {
            console.warn('GOOGLE_SHEETS_CREDENTIALS_PATH not set; skipping template write. On Vercel, set GOOGLE_SHEETS_OAUTH_JSON.');
            return;
        }
        await fs.writeFile(this.credentialsPath, JSON.stringify(template, null, 2));
        console.log('Created Google Sheets credentials template at:', this.credentialsPath);
        console.log('Please configure your Google Sheets credentials using either OAuth2 or Service Account method.');
    }

    async testConnection() {
        try {
            if (this.mockMode) {
                console.log('Google Sheets running in mock mode - connection test skipped');
                return true;
            }

            if (!this.sheets) {
                await this.authenticate();
            }

            // Test by reading spreadsheet metadata
            const response = await this.sheets.spreadsheets.get({
                spreadsheetId: this.spreadsheetId
            });

            // Removed success log to reduce console spam
            // console.log('Google Sheets connection test successful');
            console.log('Spreadsheet title:', response.data.properties.title);
            console.log('Sheet count:', response.data.sheets.length);

            return true;
        } catch (error) {
            console.error('Google Sheets connection test failed:', error.message);
            console.log('Tip: Set GOOGLE_SHEETS_MOCK=true in .env to run in mock mode for development');
            return false;
        }
    }

    async appendRow(businessData) {
        const startTime = Date.now();
        const context = {
            operation: 'appendRow',
            businessName: businessData.name,
            spreadsheetId: this.spreadsheetId
        };

        try {
            this.errorHandler.logProgress('appendRow', {
                status: 'started',
                businessName: businessData.name,
                mockMode: this.mockMode
            });

            if (this.mockMode) {
                this.errorHandler.logProgress('appendRow', {
                    status: 'mock_mode',
                    businessName: businessData.name,
                    message: 'Running in mock mode - no actual save to Google Sheets'
                });
                return {
                    updatedRows: 1,
                    businessName: businessData.name,
                    mock: true
                };
            }

            if (!this.sheets) {
                await this.authenticate();
            }

            // Prepare row data with proper formatting, include first email if available
            const firstEmail = Array.isArray(businessData.contact && businessData.contact.emails)
                ? (businessData.contact.emails[0] || '')
                : '';
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

            const request = {
                spreadsheetId: this.spreadsheetId,
                range: 'Sheet1!A:K',
                valueInputOption: 'RAW',
                resource: {
                    values: values
                }
            };

            const response = await this.sheets.spreadsheets.values.append(request);
            const duration = Date.now() - startTime;

            this.errorHandler.logDataSave('Google Sheets', businessData, 1);
            this.errorHandler.logProgress('appendRow', {
                status: 'completed',
                businessName: businessData.name,
                updatedRows: response.data.updates.updatedRows,
                updatedRange: response.data.updates.updatedRange,
                duration: `${duration}ms`
            });

            return {
                updatedRows: response.data.updates.updatedRows,
                updatedRange: response.data.updates.updatedRange,
                businessName: businessData.name,
                placeId: businessData.placeId,
                timestamp: new Date().toISOString()
            };

        } catch (error) {
            this.errorHandler.logDataSaveFailure('Google Sheets', error, businessData);
            this.errorHandler.logAndContinue(error, context);

            // Re-throw with enhanced context for upstream error handling
            const enhancedError = new Error(`Google Sheets save failed for ${businessData.name}: ${error.message}`);
            enhancedError.originalError = error;
            enhancedError.businessData = businessData;
            enhancedError.errorCode = error.code;

            throw enhancedError;
        }
    }

    /**
     * Batch append multiple rows to improve performance
     * @param {Array} businessDataArray - Array of business data objects
     * @returns {Object} - Result with updated rows count
     */
    async batchAppendRows(businessDataArray) {
        if (!businessDataArray || businessDataArray.length === 0) {
            return { updatedRows: 0, batchSize: 0 };
        }

        const startTime = Date.now();
        const context = {
            operation: 'batchAppendRows',
            batchSize: businessDataArray.length,
            spreadsheetId: this.spreadsheetId
        };

        try {
            this.errorHandler.logProgress('batchAppendRows', {
                status: 'started',
                batchSize: businessDataArray.length,
                mockMode: this.mockMode
            });

            if (this.mockMode) {
                console.log(`[MOCK] Would batch append ${businessDataArray.length} rows to Google Sheets`);
                return {
                    updatedRows: businessDataArray.length,
                    batchSize: businessDataArray.length,
                    mockMode: true
                };
            }

            if (!this.sheets) {
                const authResult = await this.authenticate();
                if (!authResult) {
                    // Authentication failed, switch to mock mode
                    this.mockMode = true;
                    console.log(`[MOCK] Google Sheets authentication failed, switching to mock mode for ${businessDataArray.length} rows`);
                    return {
                        updatedRows: businessDataArray.length,
                        batchSize: businessDataArray.length,
                        mockMode: true
                    };
                }
            }

            // Convert all business data to rows
            const values = businessDataArray.map(businessData => {
                const firstEmail = Array.isArray(businessData.contact && businessData.contact.emails)
                    ? (businessData.contact.emails[0] || '')
                    : '';
                const socials = businessData.socialProfiles || businessData.socials || {};
                return [
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
                ];
            });

            const request = {
                spreadsheetId: this.spreadsheetId,
                range: 'Sheet1!A:K',
                valueInputOption: 'RAW',
                resource: {
                    values: values
                }
            };

            const response = await this.sheets.spreadsheets.values.append(request);
            const duration = Date.now() - startTime;

            // Log batch save
            this.errorHandler.logProgress('batchAppendRows', {
                status: 'completed',
                batchSize: businessDataArray.length,
                updatedRows: response.data.updates.updatedRows,
                updatedRange: response.data.updates.updatedRange,
                duration: `${duration}ms`,
                avgPerRow: `${Math.round(duration / businessDataArray.length)}ms`
            });

            console.log(`📊 BATCH SAVE: ${businessDataArray.length} rows in ${duration}ms (${Math.round(duration / businessDataArray.length)}ms per row)`);

            return {
                updatedRows: response.data.updates.updatedRows,
                updatedRange: response.data.updates.updatedRange,
                batchSize: businessDataArray.length,
                duration: duration,
                avgPerRow: Math.round(duration / businessDataArray.length)
            };

        } catch (error) {
            this.errorHandler.logAndContinue(error, context);
            throw new Error(`Google Sheets batch save failed: ${error.message}`);
        }
    }

    async createHeaders() {
        try {
            if (!this.sheets) {
                await this.authenticate();
            }

            const headers = [['Name', 'Address', 'Phone', 'Website', 'Email', 'LinkedIn', 'Facebook', 'Instagram', 'Twitter', 'YouTube', 'TikTok']];

            const request = {
                spreadsheetId: this.spreadsheetId,
                range: 'Sheet1!A1:K1',
                valueInputOption: 'RAW',
                resource: {
                    values: headers
                }
            };

            await this.sheets.spreadsheets.values.update(request);
            console.log('Headers created in Google Sheets');

            return true;
        } catch (error) {
            console.error('Error creating headers:', error.message);
            throw error;
        }
    }
}

module.exports = GoogleSheetsService;