const express = require('express');
const SaasController = require('../controllers/saasController');
const ApiKeyAuthMiddleware = require('../middleware/apiKeyAuth');

const router = express.Router();
const saasController = new SaasController();
const apiKeyAuth = new ApiKeyAuthMiddleware();

// Apply API key authentication to all SaaS routes
router.use(apiKeyAuth.authenticate());

// Enhanced input validation middleware (same as original)
const validateSearchInput = (req, res, next) => {
    const { city, keyword, method, scraper } = req.body;
    const errors = [];

    // Debug: Log the request body to see what we're receiving
    console.log(`🔍 Route Debug: Request body =`, JSON.stringify(req.body, null, 2));
    console.log(`🔍 Route Debug: scraper =`, JSON.stringify(scraper, null, 2));

    // Validate city
    if (!city) {
        errors.push('City is required');
    } else if (typeof city !== 'string') {
        errors.push('City must be a string');
    } else if (city.trim().length === 0) {
        errors.push('City cannot be empty');
    } else if (city.trim().length < 2) {
        errors.push('City must be at least 2 characters long');
    } else if (city.trim().length > 100) {
        errors.push('City must be less than 100 characters long');
    } else if (!/^[a-zA-Z\s\-'.,]+$/.test(city.trim())) {
        errors.push('City contains invalid characters. Only letters, spaces, hyphens, apostrophes, commas, and periods are allowed');
    }

    // Validate keyword
    if (!keyword) {
        errors.push('Keyword is required');
    } else if (typeof keyword !== 'string') {
        errors.push('Keyword must be a string');
    } else if (keyword.trim().length === 0) {
        errors.push('Keyword cannot be empty');
    } else if (keyword.trim().length < 2) {
        errors.push('Keyword must be at least 2 characters long');
    } else if (keyword.trim().length > 200) {
        errors.push('Keyword must be less than 200 characters long');
    } else if (!/^[a-zA-Z0-9\s\-'.,&]+$/.test(keyword.trim())) {
        errors.push('Keyword contains invalid characters. Only letters, numbers, spaces, hyphens, apostrophes, commas, periods, and ampersands are allowed');
    }

    // Validate method (optional, defaults to 'api')
    if (method !== undefined) {
        if (typeof method !== 'string') {
            errors.push('Method must be a string ("api" or "web")');
        } else if (!['api', 'web'].includes(method)) {
            errors.push('Method must be either "api" or "web"');
        }
    }

    // Validate scraper options when provided
    if (scraper !== undefined) {
        if (typeof scraper !== 'object' || Array.isArray(scraper)) {
            errors.push('Scraper options must be an object');
        } else {
            const { 
                maxResults, 
                maxScrollPages, 
                headless, 
                wantWebsite, 
                wantEmail, 
                emailDeepPaths,
                // New flexible parameters
                targetDataCount,
                maxPhrases,
                pageRange
            } = scraper;
            if (maxResults !== undefined && (!Number.isInteger(maxResults) || maxResults < 1 || maxResults > 500)) {
                errors.push('scraper.maxResults must be an integer between 1 and 500');
            }
            if (maxScrollPages !== undefined && (!Number.isInteger(maxScrollPages) || maxScrollPages < 0 || maxScrollPages > 50)) {
                errors.push('scraper.maxScrollPages must be an integer between 0 and 50');
            }
            if (headless !== undefined && typeof headless !== 'boolean') {
                errors.push('scraper.headless must be a boolean');
            }
            if (wantWebsite !== undefined && typeof wantWebsite !== 'boolean') {
                errors.push('scraper.wantWebsite must be a boolean');
            }
            if (wantEmail !== undefined && typeof wantEmail !== 'boolean') {
                errors.push('scraper.wantEmail must be a boolean');
            }
            if (emailDeepPaths !== undefined && typeof emailDeepPaths !== 'boolean') {
                errors.push('scraper.emailDeepPaths must be a boolean');
            }
            
            // Validate new flexible parameters
            if (targetDataCount !== undefined && (!Number.isInteger(targetDataCount) || targetDataCount < 1 || targetDataCount > 10000)) {
                errors.push('scraper.targetDataCount must be an integer between 1 and 10000');
            }
            if (maxPhrases !== undefined && (!Number.isInteger(maxPhrases) || maxPhrases < 1 || maxPhrases > 100)) {
                errors.push('scraper.maxPhrases must be an integer between 1 and 100');
            }
            if (pageRange !== undefined) {
                if (typeof pageRange !== 'object' || Array.isArray(pageRange)) {
                    errors.push('scraper.pageRange must be an object');
                } else {
                    const { start, end } = pageRange;
                    if (start !== undefined && (!Number.isInteger(start) || start < 1 || start > 50)) {
                        errors.push('scraper.pageRange.start must be an integer between 1 and 50');
                    }
                    if (end !== undefined && (!Number.isInteger(end) || end < 1 || end > 50)) {
                        errors.push('scraper.pageRange.end must be an integer between 1 and 50');
                    }
                    if (start !== undefined && end !== undefined && start >= end) {
                        errors.push('scraper.pageRange.start must be less than scraper.pageRange.end');
                    }
                }
            }
        }
    }

    if (errors.length > 0) {
        return res.status(400).json({
            error: 'Validation failed',
            details: errors,
            message: 'Please provide valid city and keyword parameters',
            timestamp: new Date().toISOString()
        });
    }

    // Trim and normalize inputs
    req.body.city = city.trim();
    req.body.keyword = keyword.trim();

    next();
};

// SaaS API Routes (all require API key authentication)

// POST /api/v1/search-service - Start lead generation with API key
router.post('/search-service', validateSearchInput, (req, res) => {
    saasController.searchService(req, res);
});

// GET /api/v1/status/:jobId - Get job status with API key
router.get('/status/:jobId', (req, res) => {
    saasController.getJobStatus(req, res);
});

// GET /api/v1/status - Get all active jobs with API key
router.get('/status', (req, res) => {
    saasController.getActiveJobs(req, res);
});

// GET /api/v1/jobs - Get all jobs with API key
router.get('/jobs', (req, res) => {
    saasController.getAllJobs(req, res);
});

// GET /api/v1/performance - Get performance metrics with API key
router.get('/performance', (req, res) => {
    saasController.getPerformance(req, res);
});

// POST /api/v1/jobs/:jobId/pause - Pause job with API key
router.post('/jobs/:jobId/pause', (req, res) => {
    saasController.pauseJob(req, res);
});

// POST /api/v1/jobs/:jobId/resume - Resume job with API key
router.post('/jobs/:jobId/resume', (req, res) => {
    saasController.resumeJob(req, res);
});

// POST /api/v1/jobs/:jobId/stop - Stop job with API key
router.post('/jobs/:jobId/stop', (req, res) => {
    saasController.stopJob(req, res);
});

// GET /api/v1/debug/:jobId - Debug job with API key
router.get('/debug/:jobId', (req, res) => {
    saasController.getDebugInfo(req, res);
});

// NEW SaaS endpoints for user management and admin

// GET /api/v1/user/jobs - Get user's job history
router.get('/user/jobs', (req, res) => {
    saasController.getUserJobs(req, res);
});

// GET /api/v1/user/sheets - Get user's connected sheets
router.post('/user/sheets', (req, res) => {
    saasController.getUserSheets(req, res);
});

// GET /api/v1/admin/stats - Get admin statistics (requires admin API key)
router.get('/admin/stats', (req, res) => {
    saasController.getAdminStats(req, res);
});

module.exports = router;
