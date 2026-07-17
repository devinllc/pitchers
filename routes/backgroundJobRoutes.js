const express = require('express');
const DatabaseJobManager = require('../services/databaseJobManager');
const UserEmailAuthMiddleware = require('../middleware/userEmailAuth');

const router = express.Router();
const jobManager = DatabaseJobManager.getInstance();
const userAuth = new UserEmailAuthMiddleware();

/**
 * Background Job Processing Routes
 * Enables concurrent job processing with database-based state management
 */

// POST /jobs/create - Create and start a new job in background worker
router.post('/create',
    userAuth.extractUserEmail(),
    userAuth.requireUserEmail(),
    userAuth.logUserActivity(),
    async (req, res) => {
        try {
            const { userEmail } = req;
            const { city, keyword, method = 'web', targetSheetId, maxResults = 50, wantEmail = false, emailDeepPaths = false } = req.body;

            if (!city || !keyword) {
                return res.status(400).json({
                    success: false,
                    error: 'Missing required fields',
                    message: 'City and keyword are required'
                });
            }

            // Create job with background processing
            const jobInfo = await jobManager.createJob(city, keyword, userEmail, {
                method,
                targetSheetId,
                maxResults,
                wantEmail,
                emailDeepPaths
            });

            res.json({
                success: true,
                jobId: jobInfo.jobId,
                status: jobInfo.status,
                message: jobInfo.message,
                city: jobInfo.city,
                keyword: jobInfo.keyword,
                userEmail: jobInfo.userEmail,
                workerStats: jobManager.getWorkerStatistics()
            });

        } catch (error) {
            console.error('Error creating job:', error);
            res.status(500).json({
                success: false,
                error: 'Failed to create job',
                message: error.message,
                timestamp: new Date().toISOString()
            });
        }
    }
);

// GET /jobs/:jobId/status - Get job status from database
router.get('/:jobId/status',
    userAuth.extractUserEmail(),
    userAuth.requireUserEmail(),
    userAuth.logUserActivity(),
    async (req, res) => {
        try {
            const { jobId } = req.params;
            const { userEmail } = req;

            const jobStatus = await jobManager.getJobStatus(jobId);
            
            if (!jobStatus) {
                return res.status(404).json({
                    success: false,
                    error: 'Job not found',
                    message: 'Job does not exist or has been cleaned up'
                });
            }

            // Verify user owns this job
            if (jobStatus.userEmail !== userEmail) {
                return res.status(403).json({
                    success: false,
                    error: 'Access denied',
                    message: 'You can only view your own jobs'
                });
            }

            res.json({
                success: true,
                job: jobStatus,
                workerStats: jobManager.getWorkerStatistics()
            });

        } catch (error) {
            console.error('Error getting job status:', error);
            res.status(500).json({
                success: false,
                error: 'Failed to get job status',
                message: error.message,
                timestamp: new Date().toISOString()
            });
        }
    }
);

// GET /jobs/active - Get all active jobs for user
router.get('/active',
    userAuth.extractUserEmail(),
    userAuth.requireUserEmail(),
    userAuth.logUserActivity(),
    async (req, res) => {
        try {
            const { userEmail } = req;
            const activeJobs = await jobManager.getActiveJobs();
            
            // Filter to user's jobs only
            const userActiveJobs = activeJobs.filter(job => job.userEmail === userEmail);

            res.json({
                success: true,
                jobs: userActiveJobs,
                count: userActiveJobs.length,
                workerStats: jobManager.getWorkerStatistics()
            });

        } catch (error) {
            console.error('Error getting active jobs:', error);
            res.status(500).json({
                success: false,
                error: 'Failed to get active jobs',
                message: error.message,
                timestamp: new Date().toISOString()
            });
        }
    }
);

// GET /jobs/history - Get job history for user
router.get('/history',
    userAuth.extractUserEmail(),
    userAuth.requireUserEmail(),
    userAuth.logUserActivity(),
    async (req, res) => {
        try {
            const { userEmail } = req;
            const { limit = 50, offset = 0 } = req.query;

            const userJobs = await jobManager.getUserJobs(userEmail, parseInt(limit), parseInt(offset));

            res.json({
                success: true,
                jobs: userJobs,
                count: userJobs.length,
                pagination: {
                    limit: parseInt(limit),
                    offset: parseInt(offset),
                    hasMore: userJobs.length === parseInt(limit)
                },
                workerStats: jobManager.getWorkerStatistics()
            });

        } catch (error) {
            console.error('Error getting job history:', error);
            res.status(500).json({
                success: false,
                error: 'Failed to get job history',
                message: error.message,
                timestamp: new Date().toISOString()
            });
        }
    }
);

// POST /jobs/:jobId/cancel - Cancel a job
router.post('/:jobId/cancel',
    userAuth.extractUserEmail(),
    userAuth.requireUserEmail(),
    userAuth.logUserActivity(),
    async (req, res) => {
        try {
            const { jobId } = req.params;
            const { userEmail } = req;

            // Verify user owns this job
            const jobStatus = await jobManager.getJobStatus(jobId);
            if (!jobStatus) {
                return res.status(404).json({
                    success: false,
                    error: 'Job not found',
                    message: 'Job does not exist'
                });
            }

            if (jobStatus.userEmail !== userEmail) {
                return res.status(403).json({
                    success: false,
                    error: 'Access denied',
                    message: 'You can only cancel your own jobs'
                });
            }

            const success = await jobManager.cancelJob(jobId);

            res.json({
                success,
                message: success ? 'Job cancelled successfully' : 'Failed to cancel job',
                workerStats: jobManager.getWorkerStatistics()
            });

        } catch (error) {
            console.error('Error cancelling job:', error);
            res.status(500).json({
                success: false,
                error: 'Failed to cancel job',
                message: error.message,
                timestamp: new Date().toISOString()
            });
        }
    }
);

// GET /jobs/statistics - Get job statistics for user
router.get('/statistics',
    userAuth.extractUserEmail(),
    userAuth.requireUserEmail(),
    userAuth.logUserActivity(),
    async (req, res) => {
        try {
            const { userEmail } = req;
            const statistics = await jobManager.getJobStatistics(userEmail);
            const workerStats = jobManager.getWorkerStatistics();

            res.json({
                success: true,
                statistics: {
                    totalJobs: parseInt(statistics.total_jobs),
                    completedJobs: parseInt(statistics.completed_jobs),
                    failedJobs: parseInt(statistics.failed_jobs),
                    activeJobs: parseInt(statistics.active_jobs),
                    averageDurationSeconds: parseFloat(statistics.avg_duration_seconds) || 0
                },
                workerStats
            });

        } catch (error) {
            console.error('Error getting job statistics:', error);
            res.status(500).json({
                success: false,
                error: 'Failed to get job statistics',
                message: error.message,
                timestamp: new Date().toISOString()
            });
        }
    }
);

// POST /jobs/cleanup - Clean up old completed jobs (admin only)
router.post('/cleanup',
    userAuth.extractUserEmail(),
    userAuth.requireUserEmail(),
    userAuth.logUserActivity(),
    async (req, res) => {
        try {
            const { daysToKeep = 30 } = req.body;
            const cleanedCount = await jobManager.cleanupOldJobs(daysToKeep);

            res.json({
                success: true,
                message: `Cleaned up ${cleanedCount} old jobs`,
                cleanedCount,
                workerStats: jobManager.getWorkerStatistics()
            });

        } catch (error) {
            console.error('Error cleaning up jobs:', error);
            res.status(500).json({
                success: false,
                error: 'Failed to clean up jobs',
                message: error.message,
                timestamp: new Date().toISOString()
            });
        }
    }
);

module.exports = router;
