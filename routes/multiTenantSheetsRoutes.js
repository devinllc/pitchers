const express = require('express');
const MultiTenantSheetsController = require('../controllers/multiTenantSheetsController');
const UserEmailAuthMiddleware = require('../middleware/userEmailAuth');
const DatabaseService = require('../services/database');

const router = express.Router();
const dbService = new DatabaseService();
const controller = new MultiTenantSheetsController(dbService);
const userAuth = new UserEmailAuthMiddleware();

// Google Sheets OAuth Routes

// GET /multi-tenant-sheets/auth/url - Generate OAuth URL for user
router.post('/auth/url',
    userAuth.extractUserEmail(),
    userAuth.requireUserEmail(),
    userAuth.logUserActivity(),
    (req, res) => controller.generateAuthUrl(req, res)
);

// GET /multi-tenant-sheets/auth/connect - Initiate OAuth flow for user
router.post('/auth/connect',
    userAuth.extractUserEmail(),
    userAuth.requireUserEmail(),
    userAuth.logUserActivity(),
    (req, res) => controller.initiateOAuthFlow(req, res)
);

// Note: OAuth callback is handled by existing /oauth/google-sheets/callback route
// This route is kept for API consistency but redirects to the main callback handler

// GET /multi-tenant-sheets/auth/status - Check if user has connected Google account
router.post('/auth/status',
    userAuth.extractUserEmail(),
    userAuth.requireUserEmail(),
    userAuth.logUserActivity(),
    (req, res) => controller.checkUserConnection(req, res)
);

// Google Sheets Management Routes

// GET /multi-tenant-sheets/available - Get user's available Google Sheets from their account
router.post('/available',
    userAuth.extractUserEmail(),
    userAuth.requireUserEmail(),
    userAuth.logUserActivity(),
    (req, res) => controller.getUserGoogleSheetsList(req, res)
);

// POST /multi-tenant-sheets/create - Create new Google Sheet for user
router.post('/create',
    userAuth.extractUserEmail(),
    userAuth.requireUserEmail(),
    userAuth.logUserActivity(),
    (req, res) => controller.createUserGoogleSheet(req, res)
);

// POST /multi-tenant-sheets/connect - Connect existing Google Sheet for user
router.post('/connect',
    userAuth.extractUserEmail(),
    userAuth.requireUserEmail(),
    userAuth.validateSheetId(),
    userAuth.logUserActivity(),
    (req, res) => controller.connectUserGoogleSheet(req, res)
);

// POST /multi-tenant-sheets/auth/disconnect - Disconnect user's Google account
router.post('/auth/disconnect',
    userAuth.extractUserEmail(),
    userAuth.requireUserEmail(),
    userAuth.logUserActivity(),
    (req, res) => controller.disconnectUserAccount(req, res)
);

// GET /multi-tenant-sheets/connected - Get user's connected Google Sheets
router.post('/connected',
    userAuth.extractUserEmail(),
    userAuth.requireUserEmail(),
    userAuth.logUserActivity(),
    (req, res) => controller.getUserConnectedSheets(req, res)
);

// DELETE /multi-tenant-sheets/:sheetId - Disconnect Google Sheet
router.delete('/:sheetId',
    userAuth.extractUserEmail(),
    userAuth.requireUserEmail(),
    userAuth.validateSheetId(),
    userAuth.logUserActivity(),
    (req, res) => controller.deleteUserGoogleSheet(req, res)
);

// Data Management Routes

// GET /multi-tenant-sheets/data - Get user's business data with pagination and filters
router.post('/data',
    userAuth.extractUserEmail(),
    userAuth.requireUserEmail(),
    userAuth.validatePagination(),
    userAuth.validateDateRange(),
    userAuth.logUserActivity(),
    (req, res) => controller.getUserBusinessData(req, res)
);

// GET /multi-tenant-sheets/data/stats - Get user's business data statistics
router.post('/data/stats',
    userAuth.extractUserEmail(),
    userAuth.requireUserEmail(),
    userAuth.validateDateRange(),
    userAuth.logUserActivity(),
    (req, res) => controller.getUserBusinessDataStats(req, res)
);

// POST /multi-tenant-sheets/data/save - Save business data to user's specific sheet
router.post('/data/save',
    userAuth.extractUserEmail(),
    userAuth.requireUserEmail(),
    userAuth.validateSheetId(),
    userAuth.logUserActivity(),
    (req, res) => controller.saveBusinessDataToUserSheet(req, res)
);

module.exports = router;
