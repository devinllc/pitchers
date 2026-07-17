const express = require('express');
const router = express.Router();
const JWTAuthMiddleware = require('../middleware/jwtAuth');
const SubscriptionCheckMiddleware = require('../middleware/subscriptionCheck');
const UsageTrackingMiddleware = require('../middleware/usageTracking');
const MultiTenantSheetsController = require('../controllers/multiTenantSheetsController');
const DatabaseService = require('../services/database');

// Initialize middleware
const jwtAuth = new JWTAuthMiddleware();
const subscriptionCheck = new SubscriptionCheckMiddleware();
const usageTracking = new UsageTrackingMiddleware();
const dbService = new DatabaseService();
const sheetsController = new MultiTenantSheetsController(dbService);

// Initialize tables
usageTracking.initialize().catch(console.error);

// Middleware stack for protected routes
const protectedRoute = [
    jwtAuth.authenticate(),
    subscriptionCheck.checkActiveSubscription(),
    usageTracking.checkUsageLimits(),
    usageTracking.addRateLimitHeaders()
];

// Connect Google Sheets account
router.get('/sheets/connect', jwtAuth.authenticate(), async (req, res) => {
    try {
        // Use user email from JWT
        req.userEmail = req.user.email;
        
        // Generate OAuth URL
        await sheetsController.initiateOAuthFlow(req, res);
    } catch (error) {
        console.error('Error connecting Google Sheets:', error);
        return res.status(500).json({
            success: false,
            error: 'Failed to connect Google Sheets',
            message: error.message
        });
    }
});

// Check Google Sheets connection status
router.get('/sheets/status', jwtAuth.authenticate(), async (req, res) => {
    try {
        // Use user email from JWT
        req.userEmail = req.user.email;
        
        // Check connection status
        await sheetsController.checkUserConnection(req, res);
    } catch (error) {
        console.error('Error checking Google Sheets connection:', error);
        return res.status(500).json({
            success: false,
            error: 'Failed to check Google Sheets connection',
            message: error.message
        });
    }
});

// Get available Google Sheets
router.get('/sheets/available', ...protectedRoute, async (req, res) => {
    try {
        // Use user email from JWT
        req.userEmail = req.user.email;
        
        // Get available sheets
        await sheetsController.getUserGoogleSheetsList(req, res);
    } catch (error) {
        console.error('Error getting Google Sheets list:', error);
        return res.status(500).json({
            success: false,
            error: 'Failed to get Google Sheets list',
            message: error.message
        });
    }
});

// Get connected Google Sheets
router.get('/sheets/connected', ...protectedRoute, async (req, res) => {
    try {
        // Use user email from JWT
        req.userEmail = req.user.email;
        
        // Get connected sheets
        await sheetsController.getUserConnectedSheets(req, res);
    } catch (error) {
        console.error('Error getting connected Google Sheets:', error);
        return res.status(500).json({
            success: false,
            error: 'Failed to get connected Google Sheets',
            message: error.message
        });
    }
});

// Create new Google Sheet
router.post('/sheets/create', ...protectedRoute, async (req, res) => {
    try {
        // Use user email from JWT
        req.userEmail = req.user.email;
        
        // Create new sheet
        await sheetsController.createUserGoogleSheet(req, res);
    } catch (error) {
        console.error('Error creating Google Sheet:', error);
        return res.status(500).json({
            success: false,
            error: 'Failed to create Google Sheet',
            message: error.message
        });
    }
});

// Connect existing Google Sheet
router.post('/sheets/connect', ...protectedRoute, async (req, res) => {
    try {
        // Use user email from JWT
        req.userEmail = req.user.email;
        req.sheetId = req.body.sheetId;
        
        // Connect sheet
        await sheetsController.connectUserGoogleSheet(req, res);
    } catch (error) {
        console.error('Error connecting Google Sheet:', error);
        return res.status(500).json({
            success: false,
            error: 'Failed to connect Google Sheet',
            message: error.message
        });
    }
});

// Disconnect Google Sheet
router.delete('/sheets/:sheetId', ...protectedRoute, async (req, res) => {
    try {
        // Use user email from JWT
        req.userEmail = req.user.email;
        req.sheetId = req.params.sheetId;
        
        // Disconnect sheet
        await sheetsController.deleteUserGoogleSheet(req, res);
    } catch (error) {
        console.error('Error disconnecting Google Sheet:', error);
        return res.status(500).json({
            success: false,
            error: 'Failed to disconnect Google Sheet',
            message: error.message
        });
    }
});

// Get business data from Google Sheets
router.get('/sheets/data', ...protectedRoute, async (req, res) => {
    try {
        // Use user email from JWT
        req.userEmail = req.user.email;
        
        // Add pagination
        req.pagination = {
            page: parseInt(req.query.page || 1),
            limit: parseInt(req.query.limit || 100),
            offset: (parseInt(req.query.page || 1) - 1) * parseInt(req.query.limit || 100)
        };
        
        // Add date range
        if (req.query.startDate || req.query.endDate) {
            req.dateRange = {};
            
            if (req.query.startDate) {
                req.dateRange.startDate = new Date(req.query.startDate);
            }
            
            if (req.query.endDate) {
                req.dateRange.endDate = new Date(req.query.endDate);
            }
        }
        
        // Get business data
        await sheetsController.getUserBusinessData(req, res);
    } catch (error) {
        console.error('Error getting business data:', error);
        return res.status(500).json({
            success: false,
            error: 'Failed to get business data',
            message: error.message
        });
    }
});

// Get business data statistics
router.get('/sheets/data/stats', ...protectedRoute, async (req, res) => {
    try {
        // Use user email from JWT
        req.userEmail = req.user.email;
        
        // Add date range
        if (req.query.startDate || req.query.endDate) {
            req.dateRange = {};
            
            if (req.query.startDate) {
                req.dateRange.startDate = new Date(req.query.startDate);
            }
            
            if (req.query.endDate) {
                req.dateRange.endDate = new Date(req.query.endDate);
            }
        }
        
        // Get business data statistics
        await sheetsController.getUserBusinessDataStats(req, res);
    } catch (error) {
        console.error('Error getting business data statistics:', error);
        return res.status(500).json({
            success: false,
            error: 'Failed to get business data statistics',
            message: error.message
        });
    }
});

// Save business data to Google Sheet
router.post('/sheets/data/save', ...protectedRoute, async (req, res) => {
    try {
        // Use user email from JWT
        req.userEmail = req.user.email;
        req.sheetId = req.body.sheetId;
        
        // Save business data
        await sheetsController.saveBusinessDataToUserSheet(req, res);
    } catch (error) {
        console.error('Error saving business data:', error);
        return res.status(500).json({
            success: false,
            error: 'Failed to save business data',
            message: error.message
        });
    }
});

// Disconnect Google account
router.post('/sheets/disconnect', jwtAuth.authenticate(), async (req, res) => {
    try {
        // Use user email from JWT
        req.userEmail = req.user.email;
        
        // Disconnect Google account
        await sheetsController.disconnectUserAccount(req, res);
    } catch (error) {
        console.error('Error disconnecting Google account:', error);
        return res.status(500).json({
            success: false,
            error: 'Failed to disconnect Google account',
            message: error.message
        });
    }
});

module.exports = router;
