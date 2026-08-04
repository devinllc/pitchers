const express = require('express');
const MultiTenantSheetsController = require('../controllers/multiTenantSheetsController');
const UserEmailAuthMiddleware = require('../middleware/userEmailAuth');
const DatabaseService = require('../services/database');

const router = express.Router();
const dbService = new DatabaseService();
const controller = new MultiTenantSheetsController(dbService);
const userAuth = new UserEmailAuthMiddleware();

// Google Sheets OAuth Routes

// Google Sheets OAuth Routes

// GET & POST /multi-tenant-sheets/auth/url - Generate OAuth URL for user
router.all('/auth/url',
    userAuth.extractUserEmail(),
    userAuth.requireUserEmail(),
    userAuth.logUserActivity(),
    (req, res) => controller.generateAuthUrl(req, res)
);

// GET & POST /multi-tenant-sheets/auth/connect - Initiate OAuth flow for user
router.all('/auth/connect',
    userAuth.extractUserEmail(),
    userAuth.requireUserEmail(),
    userAuth.logUserActivity(),
    (req, res) => controller.initiateOAuthFlow(req, res)
);

// GET & POST /multi-tenant-sheets/auth/status - Check if user has connected Google account
router.all('/auth/status',
    userAuth.extractUserEmail(),
    userAuth.requireUserEmail(),
    userAuth.logUserActivity(),
    (req, res) => controller.checkUserConnection(req, res)
);

// Google Sheets Management Routes

// GET & POST /multi-tenant-sheets/available - Get user's available Google Sheets from their account
router.all('/available',
    userAuth.extractUserEmail(),
    userAuth.requireUserEmail(),
    userAuth.logUserActivity(),
    (req, res) => controller.getUserGoogleSheetsList(req, res)
);

// POST /multi-tenant-sheets/create - Create new Google Sheet for user
router.all('/create',
    userAuth.extractUserEmail(),
    userAuth.requireUserEmail(),
    userAuth.logUserActivity(),
    (req, res) => controller.createUserGoogleSheet(req, res)
);

// POST /multi-tenant-sheets/connect - Connect existing Google Sheet for user
router.all('/connect',
    userAuth.extractUserEmail(),
    userAuth.requireUserEmail(),
    userAuth.validateSheetId(),
    userAuth.logUserActivity(),
    (req, res) => controller.connectUserGoogleSheet(req, res)
);

// POST /multi-tenant-sheets/auth/disconnect - Revoke user's Google account
router.all('/auth/disconnect',
    userAuth.extractUserEmail(),
    userAuth.requireUserEmail(),
    userAuth.logUserActivity(),
    (req, res) => controller.disconnectUserAccount(req, res)
);

// GET & POST /multi-tenant-sheets/connected - Get user's connected Google Sheets
router.all('/connected',
    userAuth.extractUserEmail(),
    userAuth.requireUserEmail(),
    userAuth.logUserActivity(),
    (req, res) => controller.getUserConnectedSheets(req, res)
);

// DELETE & POST /multi-tenant-sheets/:sheetId - Disconnect Google Sheet
router.all('/:sheetId',
    userAuth.extractUserEmail(),
    userAuth.requireUserEmail(),
    userAuth.validateSheetId(),
    userAuth.logUserActivity(),
    (req, res) => controller.deleteUserGoogleSheet(req, res)
);

// Data Management Routes

// GET & POST /multi-tenant-sheets/data - Get user's business data with pagination and filters
router.all('/data',
    userAuth.extractUserEmail(),
    userAuth.requireUserEmail(),
    userAuth.validatePagination(),
    userAuth.validateDateRange(),
    userAuth.logUserActivity(),
    (req, res) => controller.getUserBusinessData(req, res)
);

// GET & POST /multi-tenant-sheets/data/stats - Get user's business data statistics
router.all('/data/stats',
    userAuth.extractUserEmail(),
    userAuth.requireUserEmail(),
    userAuth.validateDateRange(),
    userAuth.logUserActivity(),
    (req, res) => controller.getUserBusinessDataStats(req, res)
);

// POST /multi-tenant-sheets/data/save - Save business data to user's specific sheet
router.all('/data/save',
    userAuth.extractUserEmail(),
    userAuth.requireUserEmail(),
    userAuth.validateSheetId(),
    userAuth.logUserActivity(),
    (req, res) => controller.saveBusinessDataToUserSheet(req, res)
);

module.exports = router;
