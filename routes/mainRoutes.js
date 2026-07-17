const express = require('express');
const router = express.Router();
const ProcessingService = require('../services/processingService');

// Initialize processing service
const processingService = new ProcessingService();

// Utility: Discover Chrome executable path (Render-aware)
function discoverChromePath() {
    const fs = require('fs');
    const path = require('path');
    const exists = (p) => {
        try { return !!(p && fs.existsSync(p)); } catch { return false; }
    };
    let execPath = process.env.PUPPETEER_EXECUTABLE_PATH || process.env.CHROME_EXECUTABLE_PATH || '';
    if (execPath && !exists(execPath)) execPath = '';
    // Try puppeteer.executablePath() without hard dependency
    if (!execPath) {
        try {
            const puppeteer = require('puppeteer');
            const p = typeof puppeteer.executablePath === 'function' ? puppeteer.executablePath() : '';
            if (exists(p)) execPath = p;
        } catch (_) { }
    }
    // Cache scan (Render and general): search multiple bases including project-local cache
    const cacheBases = [
        process.env.PUPPETEER_CACHE_DIR,
        '/opt/render/project/src/.cache/puppeteer',
        path.resolve('.cache/puppeteer'),
        '/opt/render/.cache/puppeteer'
    ].filter(Boolean);
    let matchedBase = '';
    if (!execPath) {
        for (const base of cacheBases) {
            try {
                const chromeRoot = path.join(base, 'chrome');
                if (fs.existsSync(chromeRoot)) {
                    const entries = fs.readdirSync(chromeRoot).filter(Boolean);
                    if (entries.length) {
                        const latest = entries.sort().reverse()[0];
                        const platDir = path.join(chromeRoot, latest);
                        const candidates = [
                            path.join(platDir, 'chrome-linux64', 'chrome'),
                            path.join(platDir, 'chrome-mac', 'Chromium.app', 'Contents', 'MacOS', 'Chromium')
                        ];
                        for (const c of candidates) {
                            if (exists(c)) { execPath = c; matchedBase = base; break; }
                        }
                    }
                }
                if (execPath) break;
            } catch (_) { }
        }
    }

    return { executablePath: execPath || '', valid: exists(execPath), cacheBase: matchedBase || cacheBases[0] || '', cacheBases };
}

// Legacy HTML routes - now return JSON with deprecation notice
router.get('/oauth/google-sheets/setup', (req, res) => {
    res.status(410).json({
        error: 'Deprecated',
        message: 'This HTML endpoint is deprecated. Use the JSON API endpoints instead.',
        alternatives: {
            oauth: '/oauth/authorize',
            multiTenant: '/multi-tenant-sheets/auth/connect',
            apiDocs: '/api-docs'
        },
        timestamp: new Date().toISOString()
    });
});

router.get('/', (req, res) => {
    res.status(410).json({
        error: 'Deprecated',
        message: 'This HTML endpoint is deprecated. Use the JSON API endpoints instead.',
        alternatives: {
            jobControl: '/search-service',
            jobStatus: '/status/:jobId',
            apiDocs: '/api-docs'
        },
        timestamp: new Date().toISOString()
    });
});

router.get('/saas', (req, res) => {
    res.status(410).json({
        error: 'Deprecated',
        message: 'This HTML endpoint is deprecated. Use the JSON API endpoints instead.',
        alternatives: {
            apiKeys: '/api-keys/create',
            multiTenant: '/multi-tenant-sheets/auth/connect',
            saasApi: '/api/v1/search-service',
            apiDocs: '/api-docs'
        },
        timestamp: new Date().toISOString()
    });
});

router.get('/dashboard', (req, res) => {
    res.status(410).json({
        error: 'Deprecated',
        message: 'This HTML endpoint is deprecated. Use the JSON API endpoints instead.',
        alternatives: {
            multiTenant: '/multi-tenant-sheets/auth/connect',
            userData: '/user-data/summary',
            apiDocs: '/api-docs'
        },
        timestamp: new Date().toISOString()
    });
});

// Enhanced health check endpoint for system monitoring
router.get('/health', async (req, res) => {
    try {
        const jobManager = processingService.getJobManager();
        const activeJobs = await jobManager.getActiveJobs();
        const allJobs = await jobManager.getAllJobs();

        // Calculate system statistics
        const completedJobs = allJobs.filter(job => job.status === 'completed').length;
        const errorJobs = allJobs.filter(job => job.status === 'error').length;

        // Get performance metrics
        const performanceMetrics = processingService.getPerformanceMetrics();
        const streamingStatus = processingService.getStreamingStatus();

        // Check API key configuration
        const apiKeysConfigured = {
            gemini: !!process.env.GEMINI_API_KEY,
            googleMaps: !!process.env.GOOGLE_MAPS_API_KEY,
            googleSheets: !!process.env.GOOGLE_SHEETS_SPREADSHEET_ID
        };

        const allApiKeysConfigured = Object.values(apiKeysConfigured).every(configured => configured);

        const chromeInfo = discoverChromePath();
        res.json({
            status: allApiKeysConfigured ? 'OK' : 'WARNING',
            message: 'Local Business Scraper API is running',
            timestamp: new Date().toISOString(),
            uptime: process.uptime(),
            system: {
                nodeVersion: process.version,
                platform: process.platform,
                memoryUsage: process.memoryUsage(),
                pid: process.pid,
                chrome: chromeInfo
            },
            api: {
                keysConfigured: apiKeysConfigured,
                allKeysConfigured: allApiKeysConfigured
            },
            jobs: {
                active: activeJobs.length,
                total: allJobs.length,
                completed: completedJobs,
                errors: errorJobs,
                isProcessing: processingService.isProcessing
            },
            performance: {
                apiResponseTimes: {
                    gemini: performanceMetrics.apiCalls.gemini.avgResponseTime,
                    googleMapsSearch: performanceMetrics.apiCalls.googleMapsSearch.avgResponseTime,
                    googlePlaceDetails: performanceMetrics.apiCalls.googlePlaceDetails.avgResponseTime,
                    googleSheets: performanceMetrics.apiCalls.googleSheets.avgResponseTime
                },
                memoryUsage: performanceMetrics.memoryUsageMB,
                processingStats: {
                    jobCompletionRate: performanceMetrics.processing.jobsStarted > 0 ?
                        Math.round((performanceMetrics.processing.jobsCompleted / performanceMetrics.processing.jobsStarted) * 100) : 0,
                    avgJobDuration: Math.round(performanceMetrics.processing.avgJobDuration / 1000),
                    saveSuccessRate: performanceMetrics.processing.saveSuccessRate
                },
                streaming: streamingStatus
            },
            endpoints: [
                'GET /health - System health check with performance metrics',
                'POST /search-service - Start lead generation',
                'GET /status/:jobId - Get specific job status',
                'GET /status - Get all active jobs',
                'GET /jobs - Get all jobs',
                'POST /jobs/:jobId/pause - Pause a running job',
                'POST /jobs/:jobId/resume - Resume a paused job',
                'POST /jobs/:jobId/stop - Stop a running job',
                'GET /performance - Get detailed performance metrics',
                'POST /performance/gc - Force garbage collection',
                'GET /debug/:jobId - Debug job processing issues',
                'GET /api-docs - API documentation'
            ],
            saasEndpoints: [
                'POST /api-keys/create - Create new API key',
                'GET /api-keys/plans - Get available plans',
                'GET /api-keys/:apiKey/stats - Get API key usage statistics',
                'PUT /api-keys/:apiKey/plan - Update API key plan',
                'DELETE /api-keys/:apiKey - Deactivate API key',
                'GET /api-keys/user/:userEmail - Get user API keys',
                'POST /api/v1/search-service - Start lead generation (requires API key)',
                'GET /api/v1/status/:jobId - Get job status (requires API key)',
                'GET /api/v1/status - Get active jobs (requires API key)',
                'GET /api/v1/jobs - Get all jobs (requires API key)',
                'GET /api/v1/performance - Get performance metrics (requires API key)',
                'POST /api/v1/jobs/:jobId/pause - Pause job (requires API key)',
                'POST /api/v1/jobs/:jobId/resume - Resume job (requires API key)',
                'POST /api/v1/jobs/:jobId/stop - Stop job (requires API key)',
                'GET /api/v1/debug/:jobId - Debug job (requires API key)'
            ]
        });
    } catch (error) {
        console.error('Error in health check:', error);
        res.status(500).json({
            status: 'ERROR',
            message: 'Health check failed',
            error: error.message,
            timestamp: new Date().toISOString()
        });
    }
});

module.exports = router;
