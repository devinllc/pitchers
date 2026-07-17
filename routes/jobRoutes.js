const express = require('express');
const router = express.Router();
const ProcessingService = require('../services/processingService');

// Initialize processing service
const processingService = new ProcessingService();

// Enhanced input validation middleware
const validateSearchInput = (req, res, next) => {
    const { city, keyword, method, scraper, phrases } = req.body;
    const errors = [];

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

    // Validate phrases options when provided (only maxPhrases)
    if (phrases !== undefined) {
        if (typeof phrases !== 'object' || Array.isArray(phrases)) {
            errors.push('Phrases options must be an object');
        } else {
            const { maxPhrases } = phrases;
            if (maxPhrases !== undefined && (!Number.isInteger(maxPhrases) || maxPhrases < 1 || maxPhrases > 1000)) {
                errors.push('phrases.maxPhrases must be an integer between 1 and 1000');
            }
        }
    }

    // Validate scraper options when provided
    if (scraper !== undefined) {
        if (typeof scraper !== 'object' || Array.isArray(scraper)) {
            errors.push('Scraper options must be an object');
        } else {
            const { maxResults, maxScrollPages, headless, wantWebsite, wantEmail, emailDeepPaths } = scraper;
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

// POST /search endpoint - Multi-tenant search with user-specific sheet saving
router.post('/search', async (req, res) => {
    try {
        const { keywords, location, maxResults, userEmail, targetSheetId } = req.body;

        // Validate required fields
        if (!keywords || !location || !userEmail || !targetSheetId) {
            return res.status(400).json({
                success: false,
                message: 'Missing required fields: keywords, location, userEmail, targetSheetId'
            });
        }

        console.log(`Multi-tenant job initiated for user: ${userEmail}, location: ${location}, keywords: ${keywords}`);

        // Start processing with multi-tenant support
        const processingPromise = processingService.processLeadGeneration(location, keywords, {
            method: 'api',
            scraper: { maxResults: maxResults || 50 },
            userEmail: userEmail,
            targetSheetId: targetSheetId
        });

        // Ensure we get the correct jobId
        let jobId = processingService.currentJob?.jobId;
        if (!jobId) {
            await new Promise(resolve => setTimeout(resolve, 50));
            jobId = processingService.currentJob?.jobId || `job_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
        }

        // Handle the processing result asynchronously
        processingPromise
            .then(results => {
                console.log(`Multi-tenant job completed for ${userEmail}:`, results.summary);
            })
            .catch(error => {
                console.error(`Multi-tenant job failed for ${userEmail}:`, error.message);
            });

        // Return immediate response
        res.json({
            success: true,
            jobId: jobId,
            status: 'started',
            message: 'Lead generation job initiated',
            userEmail: userEmail,
            location: location,
            keywords: keywords,
            maxResults: maxResults || 50
        });

    } catch (error) {
        console.error('Error in /search endpoint:', error);
        res.status(500).json({
            success: false,
            error: 'Internal server error',
            message: 'An unexpected error occurred while processing your request'
        });
    }
});

// POST /search-service endpoint (existing single-tenant functionality)
router.post('/search-service', validateSearchInput, async (req, res) => {
    try {
        const { city, keyword, method, scraper, phrases } = req.body;

        console.log(`Lead generation job initiated for city: ${city}, keyword: ${keyword}, method: ${method || 'api'}`);

        // Start processing and get job info
        // We don't await the whole thing, but we need the jobId which is created synchronously or near-synchronously
        const processingPromise = processingService.processLeadGeneration(city, keyword, {
            method: method || 'api',
            scraper: scraper || {},
            phrases: phrases || {}
        });

        // Small delay or check to ensure jobId is assigned
        let jobId = processingService.currentJob?.jobId;
        if (!jobId) {
            // Fallback: wait a tiny bit for the async creation if needed
            await new Promise(resolve => setTimeout(resolve, 50));
            jobId = processingService.currentJob?.jobId || `job_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
        }

        // Handle the processing result asynchronously
        processingPromise
            .then(results => {
                console.log(`Job completed successfully:`, results.summary);
            })
            .catch(error => {
                console.error(`Job failed:`, error.message);
            });

        // Return immediate response
        res.json({
            jobId: jobId,
            status: 'started',
            message: 'Lead generation job initiated',
            city: city,
            keyword: keyword,
            method: method || 'api',
            scraper: scraper || {},
            phrases: phrases || {}
        });

    } catch (error) {
        console.error('Error in /search-service endpoint:', error);
        res.status(500).json({
            error: 'Internal server error',
            message: 'An unexpected error occurred while processing your request'
        });
    }
});

// GET /status/:jobId endpoint - Check processing progress
router.get('/status/:jobId', async (req, res) => {
    try {
        const { jobId } = req.params;
        const jobManager = processingService.getJobManager();
        const jobStatus = await jobManager.getJobStatus(jobId);

        if (!jobStatus) {
            return res.status(404).json({
                success: false,
                error: 'Job not found',
                message: `Job with ID ${jobId} was not found`
            });
        }

        // Get current job stats from processing service
        const stats = processingService.currentJobStats || {};
        
        // Add time estimates if job is active
        if (jobStatus.status === 'started' || jobStatus.status === 'paused' || jobStatus.status === 'processing') {
            const processingStatus = processingService.getProcessingStatus ? processingService.getProcessingStatus() : {};
            jobStatus.timeEstimates = processingStatus.timeEstimates;
            jobStatus.controls = {
                canPause: jobStatus.status === 'started' || jobStatus.status === 'processing',
                canResume: jobStatus.status === 'paused',
                canStop: jobStatus.status === 'started' || jobStatus.status === 'processing' || jobStatus.status === 'paused'
            };
        }

        // Format response for dashboard
        res.json({
            success: true,
            status: jobStatus.status,
            processed: jobStatus.progress?.savedBusinesses || stats.savedBusinesses || 0,
            total: jobStatus.progress?.totalBusinesses || stats.totalBusinesses || 0,
            startTime: jobStatus.startTime || jobStatus.createdAt || '-',
            method: jobStatus.method || 'api',
            saveStats: stats.saveStats || {
                postgresql: { success: 0, failed: 0 },
                googleSheets: { success: 0, failed: 0 },
                bothSucceeded: 0
            },
            ...jobStatus
        });

    } catch (error) {
        console.error('Error in /status endpoint:', error);
        res.status(500).json({
            success: false,
            error: 'Internal server error',
            message: 'An unexpected error occurred while retrieving job status'
        });
    }
});

// GET /status endpoint - Get all active jobs
router.get('/status', async (req, res) => {
    try {
        const jobManager = processingService.getJobManager();
        const activeJobs = await jobManager.getActiveJobs();

        res.json({
            activeJobs: activeJobs,
            totalActiveJobs: activeJobs.length
        });

    } catch (error) {
        console.error('Error in /status endpoint:', error);
        res.status(500).json({
            error: 'Internal server error',
            message: 'An unexpected error occurred while retrieving job statuses'
        });
    }
});

// GET /jobs endpoint - Get all jobs
router.get('/jobs', async (req, res) => {
    try {
        const jobManager = processingService.getJobManager();
        const allJobs = await jobManager.getAllJobs();

        res.json({
            jobs: allJobs,
            totalJobs: allJobs.length
        });

    } catch (error) {
        console.error('Error in /jobs endpoint:', error);
        res.status(500).json({
            error: 'Internal server error',
            message: 'An unexpected error occurred while retrieving jobs'
        });
    }
});

// POST /pause/:jobId endpoint - Pause a job
router.post('/pause/:jobId', async (req, res) => {
    try {
        const { jobId } = req.params;
        
        // Check if this is the current job
        if (processingService.currentJob && processingService.currentJob.jobId === jobId) {
            const result = await processingService.pauseJob();
            res.json(result);
        } else {
            res.status(404).json({
                success: false,
                error: 'Job not found or not current',
                message: `Job with ID ${jobId} is not the current active job`
            });
        }
    } catch (error) {
        console.error('Error in /pause endpoint:', error);
        res.status(500).json({
            success: false,
            error: 'Internal server error',
            message: 'An unexpected error occurred while pausing the job'
        });
    }
});

// POST /resume/:jobId endpoint - Resume a job
router.post('/resume/:jobId', async (req, res) => {
    try {
        const { jobId } = req.params;
        
        // Check if this is the current job
        if (processingService.currentJob && processingService.currentJob.jobId === jobId) {
            const result = await processingService.resumeJob();
            res.json(result);
        } else {
            res.status(404).json({
                success: false,
                error: 'Job not found or not current',
                message: `Job with ID ${jobId} is not the current active job`
            });
        }
    } catch (error) {
        console.error('Error in /resume endpoint:', error);
        res.status(500).json({
            success: false,
            error: 'Internal server error',
            message: 'An unexpected error occurred while resuming the job'
        });
    }
});

// POST /stop/:jobId endpoint - Stop a job
router.post('/stop/:jobId', async (req, res) => {
    try {
        const { jobId } = req.params;
        
        // Check if this is the current job
        if (processingService.currentJob && processingService.currentJob.jobId === jobId) {
            const result = await processingService.stopJob();
            res.json(result);
        } else {
            res.status(404).json({
                success: false,
                error: 'Job not found or not current',
                message: `Job with ID ${jobId} is not the current active job`
            });
        }
    } catch (error) {
        console.error('Error in /stop endpoint:', error);
        res.status(500).json({
            success: false,
            error: 'Internal server error',
            message: 'An unexpected error occurred while stopping the job'
        });
    }
});

// POST /jobs/:jobId/pause endpoint - Pause a running job
router.post('/jobs/:jobId/pause', async (req, res) => {
    try {
        const result = await processingService.pauseJob();

        if (result.success) {
            res.json({
                success: true,
                message: result.message,
                timestamp: new Date().toISOString()
            });
        } else {
            res.status(400).json({
                success: false,
                message: result.message,
                timestamp: new Date().toISOString()
            });
        }

    } catch (error) {
        console.error('Error in /jobs/:jobId/pause endpoint:', error);
        res.status(500).json({
            success: false,
            message: 'An unexpected error occurred while pausing the job'
        });
    }
});

// POST /jobs/:jobId/resume endpoint - Resume a paused job
router.post('/jobs/:jobId/resume', async (req, res) => {
    try {
        const result = await processingService.resumeJob();

        if (result.success) {
            res.json({
                success: true,
                message: result.message,
                timestamp: new Date().toISOString()
            });
        } else {
            res.status(400).json({
                success: false,
                message: result.message,
                timestamp: new Date().toISOString()
            });
        }

    } catch (error) {
        console.error('Error in /jobs/:jobId/resume endpoint:', error);
        res.status(500).json({
            success: false,
            message: 'An unexpected error occurred while resuming the job'
        });
    }
});

// POST /jobs/:jobId/stop endpoint - Stop a running job
router.post('/jobs/:jobId/stop', async (req, res) => {
    try {
        const result = await processingService.stopJob();

        if (result.success) {
            res.json({
                success: true,
                message: result.message,
                timestamp: new Date().toISOString()
            });
        } else {
            res.status(400).json({
                success: false,
                message: result.message,
                timestamp: new Date().toISOString()
            });
        }

    } catch (error) {
        console.error('Error in /jobs/:jobId/stop endpoint:', error);
        res.status(500).json({
            success: false,
            message: 'An unexpected error occurred while stopping the job'
        });
    }
});

// GET /debug/:jobId endpoint - Debug job processing issues
router.get('/debug/:jobId', async (req, res) => {
    try {
        const { jobId } = req.params;
        const jobManager = processingService.getJobManager();
        const jobStatus = await jobManager.getJobStatus(jobId);

        if (!jobStatus) {
            return res.status(404).json({
                error: 'Job not found',
                message: `Job with ID ${jobId} was not found`
            });
        }

        // Get additional debug information
        const processingStatus = processingService.getProcessingStatus();
        const performanceMetrics = processingService.getPerformanceMetrics();

        res.json({
            job: jobStatus,
            processing: processingStatus,
            performance: {
                apiCalls: performanceMetrics.apiCalls,
                memoryUsage: performanceMetrics.memoryUsageMB
            },
            debug: {
                isProcessing: processingService.isProcessing,
                currentJob: processingService.currentJob,
                apiKeysConfigured: {
                    gemini: !!process.env.GEMINI_API_KEY,
                    googleMaps: !!process.env.GOOGLE_MAPS_API_KEY,
                    googleSheets: !!process.env.GOOGLE_SHEETS_SPREADSHEET_ID
                }
            },
            timestamp: new Date().toISOString()
        });

    } catch (error) {
        console.error('Error in /debug endpoint:', error);
        res.status(500).json({
            error: 'Internal server error',
            message: 'An unexpected error occurred while retrieving debug information'
        });
    }
});

module.exports = router;

