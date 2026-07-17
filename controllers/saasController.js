const ProcessingService = require('../services/processingService');
const DatabaseJobManager = require('../services/databaseJobManager');
const MultiTenantGoogleSheetsService = require('../services/multiTenantGoogleSheets');
const DatabaseService = require('../services/database');
const ApiKey = require('../models/ApiKey');

class SaasController {
    constructor() {
        this.processingService = new ProcessingService();
        this.databaseJobManager = DatabaseJobManager.getInstance(); // Add background job manager
        this.dbService = new DatabaseService();
        this.multiTenantSheetsService = new MultiTenantGoogleSheetsService(this.dbService);
        this.apiKeyModel = new ApiKey(this.dbService);
        this.userJobs = new Map(); // Track jobs per user
    }

    // SaaS version of search-service endpoint with user tracking and sheet selection
    async searchService(req, res) {
        try {
            const { 
                city, 
                keyword, 
                method, 
                scraper, 
                sheetId, 
                targetSheetId: reqTargetSheetId,
                createNewSheet, 
                sheetName
            } = req.body;
            const userEmail = req.apiKey.data.user_email;

            console.log(`SaaS Lead generation job initiated for user: ${userEmail}, city: ${city}, keyword: ${keyword}`);

            // Validate user has connected Google Sheets
            const isConnected = await this.multiTenantSheetsService.isUserConnected(userEmail);
            if (!isConnected) {
                return res.status(400).json({
                    error: 'Google Sheets not connected',
                    message: 'Please connect your Google Sheets account first',
                    connectUrl: `/multi-tenant-sheets/auth/connect?userEmail=${encodeURIComponent(userEmail)}`
                });
            }

            // Handle sheet selection/creation
            let targetSheetId = sheetId || reqTargetSheetId;
            if (createNewSheet && sheetName) {
                try {
                    const newSheet = await this.multiTenantSheetsService.createUserGoogleSheet(userEmail, sheetName);
                    targetSheetId = newSheet.sheetId;
                    console.log(`Created new sheet for user ${userEmail}: ${sheetName} (${targetSheetId})`);
                } catch (error) {
                    console.error('Error creating new sheet:', error);
                    return res.status(400).json({
                        error: 'Failed to create new sheet',
                        message: error.message
                    });
                }
            }

            // Debug logging
            console.log(`🔍 Controller Debug: scraper =`, JSON.stringify(scraper, null, 2));
            console.log(`🔍 Controller Debug: targetDataCount = ${scraper?.targetDataCount}, maxPhrases = ${scraper?.maxPhrases}, pageRange =`, scraper?.pageRange);

            // Create job using background job manager (replaces normal ProcessingService)
            const jobInfo = await this.databaseJobManager.createJob(city, keyword, userEmail, {
                method: method || 'web',
                targetSheetId,
                maxResults: scraper?.maxResults || 50,
                wantEmail: req.body.wantEmail || scraper?.wantEmail || false,
                emailDeepPaths: req.body.emailDeepPaths || scraper?.emailDeepPaths || false,
                apiKeyPlan: req.apiKey.data.plan_type,
                scraper: scraper || {},
                // New flexible parameters from scraper object
                targetDataCount: scraper?.targetDataCount || null,  // Total businesses to extract
                maxPhrases: scraper?.maxPhrases || null,           // Limit Gemini phrases
                pageRange: scraper?.pageRange || null              // Pagination control
            });

            const jobId = jobInfo.jobId;

            // Track job for this user (keep existing SaaS tracking logic)
            if (!this.userJobs.has(userEmail)) {
                this.userJobs.set(userEmail, []);
            }

            const jobMetadata = {
                jobId,
                userEmail,
                city,
                keyword,
                method: method || 'web',
                targetSheetId,
                startTime: new Date().toISOString(),
                status: 'started',
                apiKeyPlan: req.apiKey.data.plan_type
            };

            this.userJobs.get(userEmail).push(jobMetadata);

            // Background job manager handles the processing automatically
            // We'll monitor the job status through the database
            console.log(`SaaS Background job created for ${userEmail}: ${jobId}`);

            // Increment API usage
            await this.apiKeyModel.incrementUsage(req.apiKey.key);

            // Return immediate response with comprehensive info
            res.json({
                jobId: jobId,
                status: 'started',
                message: 'Lead generation job initiated via SaaS API',
                user: {
                    email: userEmail,
                    plan: req.apiKey.data.plan_type
                },
                job: {
                    city: city,
                    keyword: keyword,
                    method: method || 'web',
                    targetSheetId: targetSheetId
                },
                apiKey: {
                    plan: req.apiKey.data.plan_type,
                    currentUsage: req.apiKey.data.usage_count,
                    usageLimit: req.apiKey.data.usage_limit,
                    remainingRequests: req.apiKey.data.usage_limit - req.apiKey.data.usage_count - 1,
                    automationLimit: req.apiKey.data.automation_limit,
                    autoReplyLimit: req.apiKey.data.auto_reply_limit
                },
                timestamp: new Date().toISOString()
            });

        } catch (error) {
            console.error('Error in SaaS /search-service endpoint:', error);
            res.status(500).json({
                error: 'Internal server error',
                message: 'An unexpected error occurred while processing your request'
            });
        }
    }

    // Track job completion with detailed metrics
    trackJobCompletion(userEmail, jobId, results, status, errorMessage = null) {
        try {
            const userJobs = this.userJobs.get(userEmail);
            if (userJobs) {
                const job = userJobs.find(j => j.jobId === jobId);
                if (job) {
                    job.status = status;
                    job.endTime = new Date().toISOString();
                    job.duration = new Date(job.endTime) - new Date(job.startTime);

                    if (results) {
                        job.results = {
                            phrasesProcessed: results.totalPhrasesProcessed || 0,
                            businessesFound: results.totalBusinessesFound || 0,
                            businessesSaved: results.totalBusinessesSaved || 0,
                            totalErrors: results.totalErrors || 0,
                            saveEfficiency: results.saveEfficiency || {}
                        };
                    }

                    if (errorMessage) {
                        job.errorMessage = errorMessage;
                    }

                    console.log(`Job ${jobId} completed for user ${userEmail} with status: ${status}`);
                }
            }
        } catch (error) {
            console.error('Error tracking job completion:', error);
        }
    }

    // Get user's job history
    async getUserJobs(req, res) {
        try {
            const userEmail = req.apiKey.data.user_email;
            const userJobs = this.userJobs.get(userEmail) || [];

            // Calculate user statistics
            const stats = {
                totalJobs: userJobs.length,
                completedJobs: userJobs.filter(j => j.status === 'completed').length,
                failedJobs: userJobs.filter(j => j.status === 'failed').length,
                totalPhrasesProcessed: userJobs.reduce((sum, j) => sum + (j.results?.phrasesProcessed || 0), 0),
                totalBusinessesFound: userJobs.reduce((sum, j) => sum + (j.results?.businessesFound || 0), 0),
                totalBusinessesSaved: userJobs.reduce((sum, j) => sum + (j.results?.businessesSaved || 0), 0)
            };

            res.json({
                user: {
                    email: userEmail,
                    plan: req.apiKey.data.plan_type
                },
                jobs: userJobs,
                statistics: stats,
                apiKey: {
                    plan: req.apiKey.data.plan_type,
                    currentUsage: req.apiKey.data.usage_count,
                    usageLimit: req.apiKey.data.usage_limit,
                    remainingRequests: req.apiKey.data.usage_limit - req.apiKey.data.usage_count,
                    automationLimit: req.apiKey.data.automation_limit,
                    autoReplyLimit: req.apiKey.data.auto_reply_limit
                },
                timestamp: new Date().toISOString()
            });

        } catch (error) {
            console.error('Error getting user jobs:', error);
            res.status(500).json({
                error: 'Internal server error',
                message: 'Failed to retrieve user job history'
            });
        }
    }

    // Get user's connected sheets
    async getUserSheets(req, res) {
        try {
            const userEmail = req.apiKey.data.user_email;
            const sheets = await this.multiTenantSheetsService.getUserConnectedSheets(userEmail);

            res.json({
                user: {
                    email: userEmail,
                    plan: req.apiKey.data.plan_type
                },
                sheets: sheets,
                totalSheets: sheets.length,
                timestamp: new Date().toISOString()
            });

        } catch (error) {
            console.error('Error getting user sheets:', error);
            res.status(500).json({
                error: 'Internal server error',
                message: 'Failed to retrieve user sheets'
            });
        }
    }

    // Admin endpoint - Get all users' activity (requires admin API key)
    async getAdminStats(req, res) {
        try {
            // Check if this is an admin API key (you can implement admin key logic)
            const isAdmin = req.apiKey.data.plan_type === 'enterprise' || req.apiKey.data.user_email.includes('admin');

            if (!isAdmin) {
                return res.status(403).json({
                    error: 'Access denied',
                    message: 'Admin privileges required'
                });
            }

            // Collect all user statistics
            const allUserStats = [];
            let totalSystemStats = {
                totalUsers: this.userJobs.size,
                totalJobs: 0,
                totalCompletedJobs: 0,
                totalFailedJobs: 0,
                totalPhrasesProcessed: 0,
                totalBusinessesFound: 0,
                totalBusinessesSaved: 0
            };

            for (const [userEmail, jobs] of this.userJobs.entries()) {
                const userStats = {
                    userEmail,
                    totalJobs: jobs.length,
                    completedJobs: jobs.filter(j => j.status === 'completed').length,
                    failedJobs: jobs.filter(j => j.status === 'failed').length,
                    totalPhrasesProcessed: jobs.reduce((sum, j) => sum + (j.results?.phrasesProcessed || 0), 0),
                    totalBusinessesFound: jobs.reduce((sum, j) => sum + (j.results?.businessesFound || 0), 0),
                    totalBusinessesSaved: jobs.reduce((sum, j) => sum + (j.results?.businessesSaved || 0), 0),
                    lastJobDate: jobs.length > 0 ? jobs[jobs.length - 1].startTime : null,
                    planType: jobs.length > 0 ? jobs[0].apiKeyPlan : 'unknown'
                };

                allUserStats.push(userStats);

                // Add to system totals
                totalSystemStats.totalJobs += userStats.totalJobs;
                totalSystemStats.totalCompletedJobs += userStats.completedJobs;
                totalSystemStats.totalFailedJobs += userStats.failedJobs;
                totalSystemStats.totalPhrasesProcessed += userStats.totalPhrasesProcessed;
                totalSystemStats.totalBusinessesFound += userStats.totalBusinessesFound;
                totalSystemStats.totalBusinessesSaved += userStats.totalBusinessesSaved;
            }

            // Get performance metrics
            const performanceMetrics = this.processingService.getPerformanceMetrics();

            res.json({
                systemStats: totalSystemStats,
                userStats: allUserStats,
                performance: performanceMetrics,
                timestamp: new Date().toISOString()
            });

        } catch (error) {
            console.error('Error getting admin stats:', error);
            res.status(500).json({
                error: 'Internal server error',
                message: 'Failed to retrieve admin statistics'
            });
        }
    }

    // SaaS version of status endpoint
    async getJobStatus(req, res) {
        try {
            const { jobId } = req.params;
            const jobStatus = await this.databaseJobManager.getJobStatus(jobId);

            if (!jobStatus) {
                return res.status(404).json({
                    error: 'Job not found',
                    message: `Job with ID ${jobId} was not found`
                });
            }

            // Verify user owns this job (SaaS security)
            if (jobStatus.userEmail !== req.apiKey.data.user_email) {
                return res.status(403).json({
                    error: 'Access denied',
                    message: 'You can only view your own jobs'
                });
            }

            // Add time estimates if job is active (keep existing SaaS logic)
            if (jobStatus.status === 'started' || jobStatus.status === 'processing') {
                jobStatus.controls = {
                    canPause: jobStatus.status === 'started',
                    canResume: jobStatus.status === 'processing',
                    canStop: jobStatus.status === 'started' || jobStatus.status === 'processing'
                };
            }

            // Add API key usage info (keep existing SaaS logic)
            jobStatus.apiKey = {
                plan: req.apiKey.data.plan_type,
                currentUsage: req.apiKey.data.usage_count,
                usageLimit: req.apiKey.data.usage_limit,
                remainingRequests: req.apiKey.data.usage_limit - req.apiKey.data.usage_count,
                automationLimit: req.apiKey.data.automation_limit,
                autoReplyLimit: req.apiKey.data.auto_reply_limit
            };

            res.json(jobStatus);

        } catch (error) {
            console.error('Error in SaaS /status endpoint:', error);
            res.status(500).json({
                error: 'Internal server error',
                message: 'An unexpected error occurred while retrieving job status'
            });
        }
    }

    // SaaS version of active jobs endpoint
    async getActiveJobs(req, res) {
        try {
            const activeJobs = await this.databaseJobManager.getActiveJobs();
            
            // Filter to user's jobs only (SaaS security)
            const userEmail = req.apiKey.data.user_email;
            const userActiveJobs = activeJobs.filter(job => job.userEmail === userEmail);

            res.json({
                activeJobs: userActiveJobs,
                totalActiveJobs: userActiveJobs.length,
                apiKey: {
                    plan: req.apiKey.data.plan_type,
                    currentUsage: req.apiKey.data.usage_count,
                    usageLimit: req.apiKey.data.usage_limit,
                    remainingRequests: req.apiKey.data.usage_limit - req.apiKey.data.usage_count,
                    automationLimit: req.apiKey.data.automation_limit,
                    autoReplyLimit: req.apiKey.data.auto_reply_limit
                }
            });

        } catch (error) {
            console.error('Error in SaaS /status endpoint:', error);
            res.status(500).json({
                error: 'Internal server error',
                message: 'An unexpected error occurred while retrieving job statuses'
            });
        }
    }

    // SaaS version of all jobs endpoint
    async getAllJobs(req, res) {
        try {
            const userEmail = req.apiKey.data.user_email;
            const userJobs = await this.databaseJobManager.getUserJobs(userEmail);

            res.json({
                jobs: userJobs,
                totalJobs: userJobs.length,
                apiKey: {
                    plan: req.apiKey.data.plan_type,
                    currentUsage: req.apiKey.data.usage_count,
                    usageLimit: req.apiKey.data.usage_limit,
                    remainingRequests: req.apiKey.data.usage_limit - req.apiKey.data.usage_count,
                    automationLimit: req.apiKey.data.automation_limit,
                    autoReplyLimit: req.apiKey.data.auto_reply_limit
                }
            });

        } catch (error) {
            console.error('Error in SaaS /jobs endpoint:', error);
            res.status(500).json({
                error: 'Internal server error',
                message: 'An unexpected error occurred while retrieving jobs'
            });
        }
    }

    // SaaS version of performance endpoint
    async getPerformance(req, res) {
        try {
            const performanceMetrics = this.processingService.getPerformanceMetrics();
            const streamingStatus = this.processingService.getStreamingStatus();

            res.json({
                performance: performanceMetrics,
                streaming: streamingStatus,
                timestamp: new Date().toISOString(),
                apiKey: {
                    plan: req.apiKey.data.plan_type,
                    currentUsage: req.apiKey.data.usage_count,
                    usageLimit: req.apiKey.data.usage_limit,
                    remainingRequests: req.apiKey.data.usage_limit - req.apiKey.data.usage_count,
                    automationLimit: req.apiKey.data.automation_limit,
                    autoReplyLimit: req.apiKey.data.auto_reply_limit
                }
            });

        } catch (error) {
            console.error('Error in SaaS /performance endpoint:', error);
            res.status(500).json({
                error: 'Internal server error',
                message: 'An unexpected error occurred while retrieving performance metrics'
            });
        }
    }

    // SaaS version of job control endpoints
    async pauseJob(req, res) {
        try {
            const { jobId } = req.params;
            const userEmail = req.apiKey.data.user_email;
            
            // Verify user owns this job
            const jobStatus = await this.databaseJobManager.getJobStatus(jobId);
            if (!jobStatus || jobStatus.userEmail !== userEmail) {
                return res.status(403).json({
                    success: false,
                    message: 'Access denied or job not found'
                });
            }

            // Check if job can be paused
            if (jobStatus.status !== 'processing' && jobStatus.status !== 'started') {
                return res.status(400).json({
                    success: false,
                    message: `Job cannot be paused. Current status: ${jobStatus.status}`
                });
            }

            const success = await this.databaseJobManager.pauseJob(jobId);

            if (success) {
                res.json({
                    success: true,
                    message: 'Job paused successfully',
                    timestamp: new Date().toISOString(),
                    apiKey: {
                        plan: req.apiKey.data.plan_type,
                        currentUsage: req.apiKey.data.usage_count,
                        usageLimit: req.apiKey.data.usage_limit
                    }
                });
            } else {
                res.status(400).json({
                    success: false,
                    message: 'Failed to pause job',
                    timestamp: new Date().toISOString()
                });
            }

        } catch (error) {
            console.error('Error in SaaS /jobs/:jobId/pause endpoint:', error);
            res.status(500).json({
                success: false,
                message: 'An unexpected error occurred while pausing the job'
            });
        }
    }

    async resumeJob(req, res) {
        try {
            const { jobId } = req.params;
            const userEmail = req.apiKey.data.user_email;
            
            // Verify user owns this job
            const jobStatus = await this.databaseJobManager.getJobStatus(jobId);
            if (!jobStatus || jobStatus.userEmail !== userEmail) {
                return res.status(403).json({
                    success: false,
                    message: 'Access denied or job not found'
                });
            }

            // Check if job can be resumed
            if (jobStatus.status !== 'paused') {
                return res.status(400).json({
                    success: false,
                    message: `Job cannot be resumed. Current status: ${jobStatus.status}`
                });
            }

            const success = await this.databaseJobManager.resumeJob(jobId);

            if (success) {
                res.json({
                    success: true,
                    message: 'Job resumed successfully',
                    timestamp: new Date().toISOString(),
                    apiKey: {
                        plan: req.apiKey.data.plan_type,
                        currentUsage: req.apiKey.data.usage_count,
                        usageLimit: req.apiKey.data.usage_limit
                    }
                });
            } else {
                res.status(400).json({
                    success: false,
                    message: 'Failed to resume job',
                    timestamp: new Date().toISOString()
                });
            }

        } catch (error) {
            console.error('Error in SaaS /jobs/:jobId/resume endpoint:', error);
            res.status(500).json({
                success: false,
                message: 'An unexpected error occurred while resuming the job'
            });
        }
    }

    async stopJob(req, res) {
        try {
            const { jobId } = req.params;
            const userEmail = req.apiKey.data.user_email;
            
            // Verify user owns this job
            const jobStatus = await this.databaseJobManager.getJobStatus(jobId);
            if (!jobStatus || jobStatus.userEmail !== userEmail) {
                return res.status(403).json({
                    success: false,
                    message: 'Access denied or job not found'
                });
            }

            // Check if job can be stopped
            if (jobStatus.status === 'completed' || jobStatus.status === 'failed') {
                return res.status(400).json({
                    success: false,
                    message: `Job cannot be stopped. Current status: ${jobStatus.status}`
                });
            }

            const success = await this.databaseJobManager.stopJob(jobId);

            if (success) {
                res.json({
                    success: true,
                    message: 'Job stopped successfully',
                    timestamp: new Date().toISOString(),
                    apiKey: {
                        plan: req.apiKey.data.plan_type,
                        currentUsage: req.apiKey.data.usage_count,
                        usageLimit: req.apiKey.data.usage_limit
                    }
                });
            } else {
                res.status(400).json({
                    success: false,
                    message: 'Failed to stop job',
                    timestamp: new Date().toISOString()
                });
            }

        } catch (error) {
            console.error('Error in SaaS /jobs/:jobId/stop endpoint:', error);
            res.status(500).json({
                success: false,
                message: 'An unexpected error occurred while stopping the job'
            });
        }
    }

    // SaaS version of debug endpoint
    async getDebugInfo(req, res) {
        try {
            const { jobId } = req.params;
            const jobStatus = await this.databaseJobManager.getJobStatus(jobId);

            if (!jobStatus) {
                return res.status(404).json({
                    error: 'Job not found',
                    message: `Job with ID ${jobId} was not found`
                });
            }

            // Verify user owns this job (SaaS security)
            if (jobStatus.userEmail !== req.apiKey.data.user_email) {
                return res.status(403).json({
                    error: 'Access denied',
                    message: 'You can only view your own jobs'
                });
            }

            // Get worker statistics
            const workerStats = this.databaseJobManager.getWorkerStatistics();

            res.json({
                job: jobStatus,
                workerStats: workerStats,
                debug: {
                    jobId: jobId,
                    userEmail: jobStatus.userEmail,
                    apiKeysConfigured: {
                        gemini: !!process.env.GEMINI_API_KEY,
                        googleMaps: !!process.env.GOOGLE_MAPS_API_KEY,
                        googleSheets: !!process.env.GOOGLE_SHEETS_SPREADSHEET_ID
                    }
                },
                apiKey: {
                    plan: req.apiKey.data.plan_type,
                    currentUsage: req.apiKey.data.usage_count,
                    usageLimit: req.apiKey.data.usage_limit,
                    remainingRequests: req.apiKey.data.usage_limit - req.apiKey.data.usage_count,
                    automationLimit: req.apiKey.data.automation_limit,
                    autoReplyLimit: req.apiKey.data.auto_reply_limit
                },
                timestamp: new Date().toISOString()
            });

        } catch (error) {
            console.error('Error in SaaS /debug endpoint:', error);
            res.status(500).json({
                error: 'Internal server error',
                message: 'An unexpected error occurred while retrieving debug information'
            });
        }
    }
}

module.exports = SaasController;
