const express = require('express');
const router = express.Router();
const JWTAuthMiddleware = require('../middleware/jwtAuth');
const SubscriptionCheckMiddleware = require('../middleware/subscriptionCheck');
const UsageTrackingMiddleware = require('../middleware/usageTracking');
const ProcessingService = require('../services/processingService');

// Initialize middleware
const jwtAuth = new JWTAuthMiddleware();
const subscriptionCheck = new SubscriptionCheckMiddleware();
const usageTracking = new UsageTrackingMiddleware();
const processingService = new ProcessingService();

// Middleware stack for protected routes
const protectedRoute = [
    jwtAuth.authenticate(),
    subscriptionCheck.checkActiveSubscription(),
    usageTracking.checkUsageLimits(),
    usageTracking.addRateLimitHeaders(),
    usageTracking.trackUsage()
];

// Create a new job
router.post('/create', ...protectedRoute, async (req, res) => {
    try {
        const { keywords, location, maxResults, targetSheetId } = req.body;
        const userEmail = req.user.email;

        // Validate required fields
        if (!keywords || !location) {
            return res.status(400).json({
                success: false,
                message: 'Missing required fields: keywords, location'
            });
        }

        console.log(`Job initiated for user: ${userEmail}, location: ${location}, keywords: ${keywords}`);

        // Check if user has reached job limit
        const jobLimit = req.subscription.features.max_jobs || 5;
        const jobManager = processingService.getJobManager();
        const userJobs = await jobManager.getUserActiveJobs(userEmail);
        
        if (userJobs.length >= jobLimit) {
            return res.status(429).json({
                success: false,
                error: 'Job limit reached',
                message: `You have reached your plan's limit of ${jobLimit} concurrent jobs`,
                code: 'job_limit_exceeded'
            });
        }

        // Start processing with multi-tenant support
        const processingPromise = processingService.processLeadGeneration(location, keywords, {
            method: 'api',
            scraper: { maxResults: maxResults || 50 },
            userEmail: userEmail,
            targetSheetId: targetSheetId
        });

        // Get the job ID from the current job
        const currentJob = processingService.currentJob;
        const jobId = currentJob ? currentJob.jobId : `job_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;

        // Handle the processing result asynchronously
        processingPromise
            .then(results => {
                console.log(`Job completed for ${userEmail}:`, results.summary);
                
                // Update usage with actual rows processed
                const rowsProcessed = results.summary?.totalBusinesses || 1;
                usageTracking.recordUsage({
                    userEmail,
                    endpoint: req.originalUrl,
                    method: req.method,
                    resourceType: 'job',
                    units: rowsProcessed
                }).catch(console.error);
            })
            .catch(error => {
                console.error(`Job failed for ${userEmail}:`, error.message);
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
        console.error('Error in /jobs/create endpoint:', error);
        res.status(500).json({
            success: false,
            error: 'Internal server error',
            message: 'An unexpected error occurred while processing your request'
        });
    }
});

// Get job status
router.get('/:jobId', ...protectedRoute, async (req, res) => {
    try {
        const { jobId } = req.params;
        const userEmail = req.user.email;
        const jobManager = processingService.getJobManager();
        const jobStatus = await jobManager.getJobStatus(jobId);

        // Check if job exists
        if (!jobStatus) {
            return res.status(404).json({
                success: false,
                error: 'Job not found',
                message: `Job with ID ${jobId} was not found`
            });
        }

        // Check if job belongs to user
        if (jobStatus.userEmail && jobStatus.userEmail !== userEmail) {
            return res.status(403).json({
                success: false,
                error: 'Access denied',
                message: 'You do not have permission to access this job'
            });
        }

        // Get current job stats from processing service
        const currentJob = processingService.currentJob;
        const stats = processingService.stats;
        
        // Add time estimates if job is active
        if (jobStatus.status === 'started' || jobStatus.status === 'paused') {
            const processingStatus = processingService.getProcessingStatus();
            jobStatus.timeEstimates = processingStatus.timeEstimates;
            jobStatus.controls = {
                canPause: jobStatus.status === 'started',
                canResume: jobStatus.status === 'paused',
                canStop: jobStatus.status === 'started' || jobStatus.status === 'paused'
            };
        }

        // Format response
        res.json({
            success: true,
            status: jobStatus.status,
            processed: stats.savedBusinesses || 0,
            total: stats.totalBusinesses || 0,
            startTime: jobStatus.startTime || currentJob?.startTime?.toISOString() || '-',
            method: currentJob?.method || jobStatus.method || 'api',
            saveStats: {
                postgresql: stats.saveStats?.postgresql || { success: 0, failed: 0 },
                googleSheets: stats.saveStats?.googleSheets || { success: 0, failed: 0 },
                bothSucceeded: stats.saveStats?.bothSucceeded || 0
            },
            ...jobStatus
        });

    } catch (error) {
        console.error('Error in /jobs/:jobId endpoint:', error);
        res.status(500).json({
            success: false,
            error: 'Internal server error',
            message: 'An unexpected error occurred while retrieving job status'
        });
    }
});

// Get all user jobs
router.get('/', ...protectedRoute, async (req, res) => {
    try {
        const userEmail = req.user.email;
        const jobManager = processingService.getJobManager();
        const userJobs = await jobManager.getUserJobs(userEmail);

        res.json({
            success: true,
            jobs: userJobs,
            totalJobs: userJobs.length
        });

    } catch (error) {
        console.error('Error in /jobs endpoint:', error);
        res.status(500).json({
            success: false,
            error: 'Internal server error',
            message: 'An unexpected error occurred while retrieving jobs'
        });
    }
});

// Pause a job
router.post('/:jobId/pause', ...protectedRoute, async (req, res) => {
    try {
        const { jobId } = req.params;
        const userEmail = req.user.email;
        const jobManager = processingService.getJobManager();
        const jobStatus = await jobManager.getJobStatus(jobId);

        // Check if job exists
        if (!jobStatus) {
            return res.status(404).json({
                success: false,
                error: 'Job not found',
                message: `Job with ID ${jobId} was not found`
            });
        }

        // Check if job belongs to user
        if (jobStatus.userEmail && jobStatus.userEmail !== userEmail) {
            return res.status(403).json({
                success: false,
                error: 'Access denied',
                message: 'You do not have permission to access this job'
            });
        }

        // Check if this is the current job
        if (processingService.currentJob && processingService.currentJob.jobId === jobId) {
            const result = await processingService.pauseJob();
            res.json(result);
        } else {
            res.status(400).json({
                success: false,
                error: 'Job not active',
                message: `Job with ID ${jobId} is not currently active`
            });
        }
    } catch (error) {
        console.error('Error in /jobs/:jobId/pause endpoint:', error);
        res.status(500).json({
            success: false,
            error: 'Internal server error',
            message: 'An unexpected error occurred while pausing the job'
        });
    }
});

// Resume a job
router.post('/:jobId/resume', ...protectedRoute, async (req, res) => {
    try {
        const { jobId } = req.params;
        const userEmail = req.user.email;
        const jobManager = processingService.getJobManager();
        const jobStatus = await jobManager.getJobStatus(jobId);

        // Check if job exists
        if (!jobStatus) {
            return res.status(404).json({
                success: false,
                error: 'Job not found',
                message: `Job with ID ${jobId} was not found`
            });
        }

        // Check if job belongs to user
        if (jobStatus.userEmail && jobStatus.userEmail !== userEmail) {
            return res.status(403).json({
                success: false,
                error: 'Access denied',
                message: 'You do not have permission to access this job'
            });
        }

        // Check if this is the current job
        if (processingService.currentJob && processingService.currentJob.jobId === jobId) {
            const result = await processingService.resumeJob();
            res.json(result);
        } else {
            res.status(400).json({
                success: false,
                error: 'Job not paused',
                message: `Job with ID ${jobId} is not currently paused`
            });
        }
    } catch (error) {
        console.error('Error in /jobs/:jobId/resume endpoint:', error);
        res.status(500).json({
            success: false,
            error: 'Internal server error',
            message: 'An unexpected error occurred while resuming the job'
        });
    }
});

// Stop a job
router.post('/:jobId/stop', ...protectedRoute, async (req, res) => {
    try {
        const { jobId } = req.params;
        const userEmail = req.user.email;
        const jobManager = processingService.getJobManager();
        const jobStatus = await jobManager.getJobStatus(jobId);

        // Check if job exists
        if (!jobStatus) {
            return res.status(404).json({
                success: false,
                error: 'Job not found',
                message: `Job with ID ${jobId} was not found`
            });
        }

        // Check if job belongs to user
        if (jobStatus.userEmail && jobStatus.userEmail !== userEmail) {
            return res.status(403).json({
                success: false,
                error: 'Access denied',
                message: 'You do not have permission to access this job'
            });
        }

        // Check if this is the current job
        if (processingService.currentJob && processingService.currentJob.jobId === jobId) {
            const result = await processingService.stopJob();
            res.json(result);
        } else {
            res.status(400).json({
                success: false,
                error: 'Job not active',
                message: `Job with ID ${jobId} is not currently active`
            });
        }
    } catch (error) {
        console.error('Error in /jobs/:jobId/stop endpoint:', error);
        res.status(500).json({
            success: false,
            error: 'Internal server error',
            message: 'An unexpected error occurred while stopping the job'
        });
    }
});

module.exports = router;
