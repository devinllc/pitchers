const MultiTenantGoogleSheetsService = require('../services/multiTenantGoogleSheets');
const DatabaseService = require('../services/database');

class MultiTenantSheetsController {
    constructor(databaseService) {
        this.databaseService = databaseService || new DatabaseService();
        this.multiTenantSheetsService = new MultiTenantGoogleSheetsService(this.databaseService);
        this.initialized = false;

        // Initialize API key model for auto-generation
        const ApiKey = require('../models/ApiKey');
        this.apiKeyModel = new ApiKey(this.databaseService);
    }

    // Initialize service if not already done
    async ensureInitialized() {
        if (!this.initialized) {
            await this.multiTenantSheetsService.initialize();
            this.initialized = true;
        }
    }

    // Generate OAuth URL for user to connect Google account
    async generateAuthUrl(req, res) {
        try {
            await this.ensureInitialized();
            const { userEmail } = req;
            const { state } = req.query;

            const authUrl = this.multiTenantSheetsService.generateAuthUrl(userEmail, state);

            res.json({
                success: true,
                authUrl,
                userEmail,
                message: 'Visit the auth URL to connect your Google account'
            });

        } catch (error) {
            console.error('Error generating auth URL:', error);
            res.status(500).json({
                success: false,
                error: 'Failed to generate auth URL',
                message: error.message,
                timestamp: new Date().toISOString()
            });
        }
    }

    // Initiate OAuth flow for user (returns OAuth URL)
    async initiateOAuthFlow(req, res) {
        try {
            await this.ensureInitialized();
            const { userEmail } = req;
            const redirectTarget =
                req.body?.redirectTo ||
                req.body?.redirect_to ||
                req.body?.redirectUri ||
                req.body?.callbackUrl ||
                req.query?.redirect_to ||
                req.query?.redirectTo ||
                null;

            const authUrl = this.multiTenantSheetsService.generateAuthUrl(userEmail, userEmail, redirectTarget);

            // Return OAuth URL for client-side redirect
            res.json({
                success: true,
                authUrl: authUrl,
                userEmail: userEmail,
                redirectTo: redirectTarget,
                oauthConfig: this.multiTenantSheetsService.getOAuthConfigSummary(),
                message: 'OAuth URL generated successfully. Redirect user to this URL to complete OAuth flow.'
            });

        } catch (error) {
            console.error('Error initiating OAuth flow:', error);
            res.status(500).json({
                success: false,
                error: 'Failed to initiate OAuth flow',
                message: error.message,
                timestamp: new Date().toISOString()
            });
        }
    }

    // Handle OAuth callback and save user credentials
    async handleOAuthCallback(req, res) {
        try {
            const { code, state } = req.query;

            if (!code) {
                return {
                    success: false,
                    error: 'Authorization code required',
                    message: 'OAuth callback must include authorization code'
                };
            }

            if (!state) {
                return {
                    success: false,
                    error: 'State parameter required',
                    message: 'OAuth callback must include state parameter'
                };
            }

            const result = await this.multiTenantSheetsService.handleOAuthCallback(code, state);

            return {
                success: true,
                userEmail: state,
                message: 'Google account connected successfully',
                timestamp: new Date().toISOString()
            };

        } catch (error) {
            console.error('Error handling OAuth callback:', error);
            return {
                success: false,
                error: 'OAuth callback failed',
                message: error.message,
                timestamp: new Date().toISOString()
            };
        }
    }

    // Check if user has connected Google account
    async checkUserConnection(req, res) {
        try {
            await this.ensureInitialized();
            const { userEmail } = req;

            const isConnected = await this.multiTenantSheetsService.isUserConnected(userEmail);

            res.json({
                success: true,
                userEmail,
                isConnected,
                message: isConnected ? 'User has connected Google account' : 'User needs to connect Google account'
            });

        } catch (error) {
            console.error('Error checking user connection:', error);
            res.status(500).json({
                success: false,
                error: 'Failed to check user connection',
                message: error.message,
                timestamp: new Date().toISOString()
            });
        }
    }

    // Get user's available Google Sheets
    async getUserGoogleSheetsList(req, res) {
        try {
            await this.ensureInitialized();
            const { userEmail } = req;

            const sheets = await this.multiTenantSheetsService.getUserGoogleSheetsList(userEmail);

            res.json({
                success: true,
                userEmail,
                sheets,
                count: sheets.length,
                message: `Found ${sheets.length} Google Sheets for user`
            });

        } catch (error) {
            console.error('Error getting user Google Sheets list:', error);
            res.status(500).json({
                success: false,
                error: 'Failed to get Google Sheets list',
                message: error.message,
                timestamp: new Date().toISOString()
            });
        }
    }

    // Create new Google Sheet for user
    async createUserGoogleSheet(req, res) {
        try {
            await this.ensureInitialized();
            const { userEmail } = req;
            const { sheetName } = req.body;

            if (!sheetName) {
                return res.status(400).json({
                    success: false,
                    error: 'Sheet name required',
                    message: 'Please provide a name for the new Google Sheet'
                });
            }

            const sheet = await this.multiTenantSheetsService.createUserGoogleSheet(userEmail, sheetName);

            res.json({
                success: true,
                userEmail,
                sheet,
                message: `Google Sheet "${sheetName}" created successfully`
            });

        } catch (error) {
            console.error('Error creating user Google Sheet:', error);
            res.status(500).json({
                success: false,
                error: 'Failed to create Google Sheet',
                message: error.message,
                timestamp: new Date().toISOString()
            });
        }
    }

    // Connect existing Google Sheet for user
    async connectUserGoogleSheet(req, res) {
        try {
            await this.ensureInitialized();
            const { userEmail, sheetId } = req;

            if (!sheetId) {
                return res.status(400).json({
                    success: false,
                    error: 'Sheet ID required',
                    message: 'Please provide the Google Sheet ID to connect'
                });
            }

            const sheet = await this.multiTenantSheetsService.connectUserGoogleSheet(userEmail, sheetId);

            res.json({
                success: true,
                userEmail,
                sheet,
                message: `Google Sheet connected successfully`
            });

        } catch (error) {
            console.error('Error connecting user Google Sheet:', error);
            res.status(500).json({
                success: false,
                error: 'Failed to connect Google Sheet',
                message: error.message,
                timestamp: new Date().toISOString()
            });
        }
    }

    // Get user's connected Google Sheets
    async getUserConnectedSheets(req, res) {
        try {
            await this.ensureInitialized();
            const { userEmail } = req;

            const sheets = await this.multiTenantSheetsService.getUserConnectedSheets(userEmail);

            res.json({
                success: true,
                userEmail,
                sheets,
                count: sheets.length,
                message: `Found ${sheets.length} connected Google Sheets`
            });

        } catch (error) {
            console.error('Error getting user connected sheets:', error);
            res.status(500).json({
                success: false,
                error: 'Failed to get connected sheets',
                message: error.message,
                timestamp: new Date().toISOString()
            });
        }
    }

    // Get user's business data with pagination and filters
    async getUserBusinessData(req, res) {
        try {
            await this.ensureInitialized();
            const { userEmail, pagination, dateRange } = req;
            const { jobId, sheetId, city, keyword } = req.query;

            const options = {
                limit: pagination.limit,
                offset: pagination.offset,
                jobId,
                sheetId,
                city,
                keyword,
                startDate: dateRange?.startDate,
                endDate: dateRange?.endDate
            };

            const [data, totalCount] = await Promise.all([
                this.multiTenantSheetsService.getUserBusinessData(userEmail, options),
                this.multiTenantSheetsService.getUserBusinessDataCount(userEmail, options)
            ]);

            const totalPages = Math.ceil(totalCount / pagination.limit);

            res.json({
                success: true,
                userEmail,
                data,
                pagination: {
                    page: pagination.page,
                    limit: pagination.limit,
                    totalCount,
                    totalPages,
                    hasNextPage: pagination.page < totalPages,
                    hasPrevPage: pagination.page > 1
                },
                filters: {
                    jobId,
                    sheetId,
                    city,
                    keyword,
                    dateRange
                },
                message: `Retrieved ${data.length} business records`
            });

        } catch (error) {
            console.error('Error getting user business data:', error);
            res.status(500).json({
                success: false,
                error: 'Failed to get business data',
                message: error.message,
                timestamp: new Date().toISOString()
            });
        }
    }

    // Get user's business data summary/stats
    async getUserBusinessDataStats(req, res) {
        try {
            await this.ensureInitialized();
            const { userEmail, dateRange } = req;

            const options = {
                startDate: dateRange?.startDate,
                endDate: dateRange?.endDate
            };

            const totalCount = await this.multiTenantSheetsService.getUserBusinessDataCount(userEmail, options);
            const connectedSheets = await this.multiTenantSheetsService.getUserConnectedSheets(userEmail);

            // Get data by sheet
            const sheetStats = await Promise.all(
                connectedSheets.map(async (sheet) => {
                    const count = await this.multiTenantSheetsService.getUserBusinessDataCount(userEmail, {
                        ...options,
                        sheetId: sheet.sheet_id
                    });
                    return {
                        sheetId: sheet.sheet_id,
                        sheetName: sheet.sheet_name,
                        businessCount: count
                    };
                })
            );

            res.json({
                success: true,
                userEmail,
                stats: {
                    totalBusinessRecords: totalCount,
                    connectedSheetsCount: connectedSheets.length,
                    sheetStats,
                    dateRange
                },
                message: 'Business data statistics retrieved successfully'
            });

        } catch (error) {
            console.error('Error getting user business data stats:', error);
            res.status(500).json({
                success: false,
                error: 'Failed to get business data statistics',
                message: error.message,
                timestamp: new Date().toISOString()
            });
        }
    }

    // Disconnect user's Google account (remove OAuth credentials)
    async disconnectUserAccount(req, res) {
        try {
            await this.ensureInitialized();
            const { userEmail } = req;

            // Delete OAuth credentials
            const result = await this.multiTenantSheetsService.deleteUserGoogleSheet(userEmail, 'oauth_credentials');

            res.json({
                success: true,
                userEmail,
                message: 'Google account disconnected successfully'
            });

        } catch (error) {
            console.error('Error disconnecting user account:', error);
            res.status(500).json({
                success: false,
                error: 'Failed to disconnect Google account',
                message: error.message,
                timestamp: new Date().toISOString()
            });
        }
    }

    // Delete user's Google Sheet connection
    async deleteUserGoogleSheet(req, res) {
        try {
            await this.ensureInitialized();
            const { userEmail, sheetId } = req;

            if (!sheetId) {
                return res.status(400).json({
                    success: false,
                    error: 'Sheet ID required',
                    message: 'Please provide the Google Sheet ID to disconnect'
                });
            }

            const result = await this.multiTenantSheetsService.deleteUserGoogleSheet(userEmail, sheetId);

            if (!result) {
                return res.status(404).json({
                    success: false,
                    error: 'Sheet not found',
                    message: 'Google Sheet connection not found for this user'
                });
            }

            res.json({
                success: true,
                userEmail,
                sheetId,
                message: 'Google Sheet disconnected successfully'
            });

        } catch (error) {
            console.error('Error deleting user Google Sheet:', error);
            res.status(500).json({
                success: false,
                error: 'Failed to disconnect Google Sheet',
                message: error.message,
                timestamp: new Date().toISOString()
            });
        }
    }

    // Ensure user has an API key (auto-generate if needed)
    async ensureUserApiKey(userEmail) {
        try {
            // Check if user already has an API key
            const existingKeys = await this.apiKeyModel.getUserApiKeys(userEmail);

            if (existingKeys && existingKeys.length > 0) {
                console.log(`User ${userEmail} already has ${existingKeys.length} API key(s)`);
                return existingKeys[0]; // Return first active key
            }

            // Create new API key with free plan for new users
            console.log(`Creating new API key for user: ${userEmail}`);
            const newApiKey = await this.apiKeyModel.createApiKey(userEmail, 'free');
            console.log(`✅ API key created for ${userEmail}: ${newApiKey.api_key.substring(0, 12)}...`);

            return newApiKey;
        } catch (error) {
            console.error(`Error ensuring API key for ${userEmail}:`, error);
            throw error;
        }
    }

    // Save business data to user's specific sheet (for API usage)
    async saveBusinessDataToUserSheet(req, res) {
        try {
            await this.ensureInitialized();
            const { userEmail, sheetId } = req;
            const { businessData, jobId } = req.body;

            if (!businessData) {
                return res.status(400).json({
                    success: false,
                    error: 'Business data required',
                    message: 'Please provide business data to save'
                });
            }

            if (!sheetId) {
                return res.status(400).json({
                    success: false,
                    error: 'Sheet ID required',
                    message: 'Please provide the target Google Sheet ID'
                });
            }

            const result = await this.multiTenantSheetsService.saveBusinessDataToUserSheet(
                userEmail,
                sheetId,
                businessData,
                jobId
            );

            res.json({
                success: true,
                userEmail,
                sheetId,
                result,
                message: 'Business data saved successfully'
            });

        } catch (error) {
            console.error('Error saving business data to user sheet:', error);
            res.status(500).json({
                success: false,
                error: 'Failed to save business data',
                message: error.message,
                timestamp: new Date().toISOString()
            });
        }
    }
}

module.exports = MultiTenantSheetsController;
