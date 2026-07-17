const express = require('express');
const UserDataController = require('../controllers/userDataController');
const UserEmailAuthMiddleware = require('../middleware/userEmailAuth');

const router = express.Router();
const controller = new UserDataController();
const userAuth = new UserEmailAuthMiddleware();

// Data Fetching Routes - All require user email

// POST /user-data/all - Get all user's business data with pagination and filters
router.post('/all',
    userAuth.extractUserEmail(),
    userAuth.requireUserEmail(),
    userAuth.validatePagination(),
    userAuth.validateDateRange(),
    userAuth.logUserActivity(),
    (req, res) => controller.getAllUserData(req, res)
);

// POST /user-data/summary - Get user's data summary with statistics
router.post('/summary',
    userAuth.extractUserEmail(),
    userAuth.requireUserEmail(),
    userAuth.validateDateRange(),
    userAuth.logUserActivity(),
    (req, res) => controller.getUserDataSummary(req, res)
);

// POST /user-data/by-city - Get user's data grouped by city
router.post('/by-city',
    userAuth.extractUserEmail(),
    userAuth.requireUserEmail(),
    userAuth.validateDateRange(),
    userAuth.logUserActivity(),
    (req, res) => controller.getUserDataByCity(req, res)
);

// POST /user-data/by-keyword - Get user's data grouped by keyword
router.post('/by-keyword',
    userAuth.extractUserEmail(),
    userAuth.requireUserEmail(),
    userAuth.validateDateRange(),
    userAuth.logUserActivity(),
    (req, res) => controller.getUserDataByKeyword(req, res)
);

// POST /user-data/recent - Get user's recent activity
router.post('/recent',
    userAuth.extractUserEmail(),
    userAuth.requireUserEmail(),
    userAuth.logUserActivity(),
    (req, res) => controller.getUserRecentActivity(req, res)
);

// POST /user-data/export/csv - Export user's data to CSV
router.post('/export/csv',
    userAuth.extractUserEmail(),
    userAuth.requireUserEmail(),
    userAuth.validateDateRange(),
    userAuth.logUserActivity(),
    (req, res) => controller.exportUserDataToCSV(req, res)
);

module.exports = router;
