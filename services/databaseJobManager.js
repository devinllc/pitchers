/**
 * Database-Based Job Manager
 * Handles job tracking with database persistence only (no in-memory state)
 * Enables concurrent job processing and better performance
 */
const Job = require('../models/Job');
const DatabaseService = require('./database');
const JobWorker = require('./jobWorker');
const LeadsCampaign = require('../models/LeadsCampaign');
const CampaignTemplate = require('../models/CampaignTemplate');
const CampaignExecution = require('../models/CampaignExecution');
const LeadSource = require('../models/LeadSource');
const WhatsAppConnection = require('../models/WhatsAppConnection');
const SmtpConnection = require('../models/SmtpConnection');

class DatabaseJobManager {
    static instance = null;

    static getInstance() {
        if (!DatabaseJobManager.instance) {
            DatabaseJobManager.instance = new DatabaseJobManager();
        }

        return DatabaseJobManager.instance;
    }

    constructor() {
        if (DatabaseJobManager.instance) {
            return DatabaseJobManager.instance;
        }

        // Initialize database services
        this.databaseService = new DatabaseService();
        this.jobModel = new Job(this.databaseService);
        this.jobWorker = new JobWorker();

        // Initialize database tables without blocking startup
        this.initializationPromise = (async () => {
            await this.jobModel.createJobsTable().catch(error => {
                console.error('[DB_JOB_MANAGER] Error initializing jobs table:', error);
            });

            await this.initializeCampaignTables();
        })();

        this.initializationPromise.catch(error => {
            console.error('[DB_JOB_MANAGER] Error during database bootstrap:', error);
        });

        // Job processing queue and status
        this.processingQueue = [];
        this.isProcessingQueue = false;

        console.log('[DB_JOB_MANAGER] Database-based job manager initialized');

        DatabaseJobManager.instance = this;
    }

    /**
     * Initialize campaign automation database tables
     */
    async initializeCampaignTables() {
        const tables = [
            ['leads_sources', () => new LeadSource(this.databaseService).createTable()],
            ['campaign_templates', () => new CampaignTemplate(this.databaseService).createTable()],
            ['leads_campaigns', () => new LeadsCampaign(this.databaseService).createTable()],
            ['campaign_executions', () => new CampaignExecution(this.databaseService).createTable()],
            ['whatsapp_connections', () => new WhatsAppConnection(this.databaseService).createTable()],
            ['smtp_connections', () => new SmtpConnection(this.databaseService).createTable()]
        ];

        for (const [tableName, initializer] of tables) {
            try {
                await initializer();
            } catch (error) {
                console.warn(`[DB_JOB_MANAGER] Skipping ${tableName} initialization: ${error.message}`);
            }
        }

        console.log('[DB_JOB_MANAGER] Campaign automation tables initialized');
    }

    /**
     * Create a new job and start processing immediately
     * @param {string} city - The city name
     * @param {string} keyword - The business keyword
     * @param {string} userEmail - User email
     * @param {Object} options - Additional options (method, targetSheetId, etc.)
     * @returns {Object} Job information with ID
     */
    async createJob(city, keyword, userEmail, options = {}) {
        const jobId = `job_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;

        const jobData = {
            jobId,
            userEmail,
            city,
            keyword,
            method: options.method || 'web',
            targetSheetId: options.targetSheetId || null,
            maxResults: options.maxResults || 50,
            wantEmail: options.wantEmail || false,
            emailDeepPaths: options.emailDeepPaths || false,
            // Explicitly include the new flexible parameters
            targetDataCount: options.targetDataCount || null,
            maxPhrases: options.maxPhrases || null,
            pageRange: options.pageRange || null,
            // Include all other options
            ...options
        };

        console.log(`🔍 DatabaseJobManager Debug: options =`, JSON.stringify(options, null, 2));
        console.log(`🔍 DatabaseJobManager Debug: jobData =`, JSON.stringify(jobData, null, 2));

        try {
            // Create job in database
            await this.jobModel.createJob({
                jobId,
                userEmail,
                city,
                keyword,
                method: jobData.method,
                status: 'started'
            });

            console.log(`📋 Job created: ${jobId} for city: ${city}, keyword: ${keyword}`);

            // Start processing immediately in background worker
            this.processJobInBackground(jobData).catch(error => {
                console.error(`[DB_JOB_MANAGER] Background processing failed for ${jobId}:`, error);
            });

            return {
                jobId,
                status: 'started',
                message: 'Lead generation job initiated',
                city,
                keyword,
                userEmail
            };

        } catch (error) {
            console.error('Error creating job:', error);
            throw error;
        }
    }

    /**
     * Process job in background worker thread
     * @param {Object} jobData - Job data
     */
    async processJobInBackground(jobData) {
        try {
            console.log(`[DB_JOB_MANAGER] Starting background processing for job: ${jobData.jobId}`);
            
            // Process job in worker thread
            const result = await this.jobWorker.processJob(jobData);
            
            console.log(`[DB_JOB_MANAGER] Job ${jobData.jobId} completed:`, {
                status: result.status,
                businessesFound: result.businessesFound,
                businessesSaved: result.businessesSaved,
                duration: result.duration
            });

        } catch (error) {
            console.error(`[DB_JOB_MANAGER] Job ${jobData.jobId} failed:`, error);
            
            // Update job status to failed in database
            try {
                await this.jobModel.updateJob(jobData.jobId, {
                    status: 'failed',
                    error_message: error.message,
                    end_time: new Date()
                });
            } catch (updateError) {
                console.error(`[DB_JOB_MANAGER] Failed to update job status:`, updateError);
            }
        }
    }

    /**
     * Get job status from database
     * @param {string} jobId - Job ID
     * @returns {Object|null} Job status or null if not found
     */
    async getJobStatus(jobId) {
        try {
            const dbJob = await this.jobModel.getJob(jobId);
            if (!dbJob) {
                return null;
            }

            const progress = dbJob.progress || {};
            const statistics = dbJob.statistics || {};

            return {
                jobId: dbJob.job_id,
                userEmail: dbJob.user_email,
                city: dbJob.city,
                keyword: dbJob.keyword,
                method: dbJob.method,
                status: dbJob.status,
                progress: {
                    ...progress,
                    phrasesProgress: progress.totalPhrases > 0 ?
                        Math.round((progress.processedPhrases / progress.totalPhrases) * 100) : 0,
                    saveSuccessRate: progress.totalBusinesses > 0 ?
                        Math.round((progress.savedBusinesses / progress.totalBusinesses) * 100) : 0
                },
                statistics: {
                    ...statistics,
                    totalErrors: statistics.errors ? statistics.errors.length : 0
                },
                createdAt: dbJob.created_at,
                updatedAt: dbJob.updated_at,
                error: dbJob.error_message,
                duration: dbJob.end_time ? 
                    new Date(dbJob.end_time).getTime() - new Date(dbJob.created_at).getTime() : 
                    Date.now() - new Date(dbJob.created_at).getTime()
            };

        } catch (error) {
            console.error('Error getting job status:', error);
            return null;
        }
    }

    /**
     * Get all active jobs from database
     * @returns {Array} Array of active job statuses
     */
    async getActiveJobs() {
        try {
            const dbJobs = await this.jobModel.getActiveJobs();
            return dbJobs.map(dbJob => this.formatJobStatus(dbJob));
        } catch (error) {
            console.error('Error getting active jobs:', error);
            return [];
        }
    }

    /**
     * Get all jobs for a user from database
     * @param {string} userEmail - User email
     * @param {number} limit - Limit results
     * @param {number} offset - Offset for pagination
     * @returns {Array} Array of job statuses
     */
    async getUserJobs(userEmail, limit = 50, offset = 0) {
        try {
            const dbJobs = await this.jobModel.getUserJobs(userEmail, limit, offset);
            return dbJobs.map(dbJob => this.formatJobStatus(dbJob));
        } catch (error) {
            console.error('Error getting user jobs:', error);
            return [];
        }
    }

    /**
     * Get all jobs from database
     * @param {number} limit - Limit results
     * @param {number} offset - Offset for pagination
     * @returns {Array} Array of all job statuses
     */
    async getAllJobs(limit = 50, offset = 0) {
        try {
            const dbJobs = await this.jobModel.getAllJobs(limit, offset);
            return dbJobs.map(dbJob => this.formatJobStatus(dbJob));
        } catch (error) {
            console.error('Error getting all jobs:', error);
            return [];
        }
    }

    /**
     * Get job statistics from database
     * @param {string} userEmail - User email (optional)
     * @returns {Object} Job statistics
     */
    async getJobStatistics(userEmail = null) {
        try {
            return await this.jobModel.getJobStatistics(userEmail);
        } catch (error) {
            console.error('Error getting job statistics:', error);
            return {
                total_jobs: 0,
                completed_jobs: 0,
                failed_jobs: 0,
                active_jobs: 0,
                avg_duration_seconds: 0
            };
        }
    }

    /**
     * Pause a job (mark as paused and send message to worker)
     * @param {string} jobId - Job ID
     * @returns {boolean} Success status
     */
    async pauseJob(jobId) {
        try {
            // Send pause message to worker thread
            const workerId = Array.from(this.jobWorker.activeWorkers.keys())
                .find(id => id.startsWith(jobId));
            
            if (workerId) {
                const worker = this.jobWorker.activeWorkers.get(workerId);
                if (worker) {
                    worker.postMessage({ type: 'pause' });
                    console.log(`[DB_JOB_MANAGER] Pause message sent to worker for job ${jobId}`);
                }
            }

            await this.jobModel.updateJob(jobId, {
                status: 'paused',
                progress: { currentStep: 'paused_by_user' }
            });
            
            console.log(`[DB_JOB_MANAGER] Job ${jobId} paused`);
            return true;
        } catch (error) {
            console.error(`[DB_JOB_MANAGER] Failed to pause job ${jobId}:`, error);
            return false;
        }
    }

    /**
     * Resume a paused job (send resume message to worker)
     * @param {string} jobId - Job ID
     * @returns {boolean} Success status
     */
    async resumeJob(jobId) {
        try {
            // Send resume message to worker thread
            const workerId = Array.from(this.jobWorker.activeWorkers.keys())
                .find(id => id.startsWith(jobId));
            
            if (workerId) {
                const worker = this.jobWorker.activeWorkers.get(workerId);
                if (worker) {
                    worker.postMessage({ type: 'resume' });
                    console.log(`[DB_JOB_MANAGER] Resume message sent to worker for job ${jobId}`);
                }
            }

            await this.jobModel.updateJob(jobId, {
                status: 'processing',
                progress: { currentStep: 'processing_phrases' }
            });
            
            console.log(`[DB_JOB_MANAGER] Job ${jobId} resumed`);
            return true;
        } catch (error) {
            console.error(`[DB_JOB_MANAGER] Failed to resume job ${jobId}:`, error);
            return false;
        }
    }

    /**
     * Stop a job immediately (mark as cancelled and terminate worker)
     * @param {string} jobId - Job ID
     * @returns {boolean} Success status
     */
    async stopJob(jobId) {
        try {
            // First, send stop message to worker thread
            const workerId = Array.from(this.jobWorker.activeWorkers.keys())
                .find(id => id.startsWith(jobId));
            
            if (workerId) {
                const worker = this.jobWorker.activeWorkers.get(workerId);
                if (worker) {
                    worker.postMessage({ type: 'stop' });
                    console.log(`[DB_JOB_MANAGER] Stop message sent to worker for job ${jobId}`);
                    
                    // Wait a bit for graceful shutdown, then terminate
                    setTimeout(() => {
                        worker.terminate();
                        this.jobWorker.activeWorkers.delete(workerId);
                        console.log(`[DB_JOB_MANAGER] Worker terminated for job ${jobId}`);
                    }, 5000); // 5 second grace period
                }
            }

            // Update job status to failed (since 'cancelled' is not allowed by DB constraint)
            await this.jobModel.updateJob(jobId, {
                status: 'failed',
                end_time: new Date(),
                progress: { currentStep: 'stopped_by_user' }
            });
            
            console.log(`[DB_JOB_MANAGER] Job ${jobId} stopped`);
            return true;
        } catch (error) {
            console.error(`[DB_JOB_MANAGER] Failed to stop job ${jobId}:`, error);
            return false;
        }
    }

    /**
     * Cancel a job (mark as cancelled)
     * @param {string} jobId - Job ID
     * @returns {boolean} Success status
     */
    async cancelJob(jobId) {
        return await this.stopJob(jobId);
    }

    /**
     * Clean up old completed jobs
     * @param {number} daysToKeep - Days to keep completed jobs
     * @returns {number} Number of jobs cleaned up
     */
    async cleanupOldJobs(daysToKeep = 30) {
        try {
            return await this.jobModel.cleanupOldJobs(daysToKeep);
        } catch (error) {
            console.error('Error cleaning up old jobs:', error);
            return 0;
        }
    }

    /**
     * Get worker statistics
     * @returns {Object} Worker statistics
     */
    getWorkerStatistics() {
        return {
            activeWorkers: this.jobWorker.getActiveWorkerCount(),
            maxConcurrentJobs: this.jobWorker.maxConcurrentJobs,
            queueLength: this.processingQueue.length
        };
    }

    /**
     * Terminate all workers (for graceful shutdown)
     */
    async terminateAllWorkers() {
        await this.jobWorker.terminateAllWorkers();
    }

    /**
     * Format job status from database record
     * @param {Object} dbJob - Database job record
     * @returns {Object} Formatted job status
     */
    formatJobStatus(dbJob) {
        const progress = dbJob.progress || {};
        const statistics = dbJob.statistics || {};

        return {
            jobId: dbJob.job_id,
            userEmail: dbJob.user_email,
            city: dbJob.city,
            keyword: dbJob.keyword,
            method: dbJob.method,
            status: dbJob.status,
            progress: {
                ...progress,
                phrasesProgress: progress.totalPhrases > 0 ?
                    Math.round((progress.processedPhrases / progress.totalPhrases) * 100) : 0,
                saveSuccessRate: progress.totalBusinesses > 0 ?
                    Math.round((progress.savedBusinesses / progress.totalBusinesses) * 100) : 0
            },
            statistics: {
                ...statistics,
                totalErrors: statistics.errors ? statistics.errors.length : 0
            },
            createdAt: dbJob.created_at,
            updatedAt: dbJob.updated_at,
            error: dbJob.error_message,
            duration: dbJob.end_time ? 
                new Date(dbJob.end_time).getTime() - new Date(dbJob.created_at).getTime() : 
                Date.now() - new Date(dbJob.created_at).getTime()
        };
    }
}

module.exports = DatabaseJobManager;
