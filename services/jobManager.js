/**
 * JobManager - Handles job tracking with current query and total progress
 * Requirements: 7.5, 6.2
 */
const Job = require('../models/Job');
const DatabaseService = require('./database');

class JobManager {
    constructor() {
        // Initialize Job model for database persistence
        this.databaseService = new DatabaseService();
        this.jobModel = new Job(this.databaseService);
        this.jobModel.createJobsTable().catch(console.error);
        
        // In-memory job storage for active jobs (for performance)
        this.jobs = new Map();
        this.activeJobs = new Map();
    }

    /**
     * Create a new job and initialize tracking
     * @param {string} city - The city name
     * @param {string} keyword - The business keyword
     * @param {string} userEmail - User email (optional)
     * @returns {Object} Job information with ID
     */
    async createJob(city, keyword, userEmail = null) {
        const jobId = `job_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;

        const job = {
            jobId,
            city,
            keyword,
            method: null,
            status: 'started',
            progress: {
                totalPhrases: 0,
                processedPhrases: 0,
                currentPhrase: null,
                totalBusinesses: 0,
                savedBusinesses: 0,
                currentStep: 'initializing'
            },
            statistics: {
                saveStats: {
                    postgresql: { success: 0, failed: 0 },
                    googleSheets: { success: 0, failed: 0 },
                    bothSucceeded: 0,
                    bothFailed: 0,
                    partialSuccess: 0
                },
                errors: []
            },
            createdAt: new Date(),
            updatedAt: new Date(),
            error: null
        };

        // Save to database
        try {
            await this.jobModel.createJob({
                jobId,
                userEmail,
                city,
                keyword,
                method: 'api',
                status: 'started'
            });
        } catch (error) {
            console.error('Error saving job to database:', error);
            // Continue with in-memory storage even if database fails
        }

        this.jobs.set(jobId, job);
        this.activeJobs.set(jobId, job);

        console.log(`📋 Job created: ${jobId} for city: ${city}, keyword: ${keyword}`);

        return {
            jobId,
            status: job.status,
            message: 'Lead generation job initiated',
            city,
            keyword
        };
    }

    /**
     * Update job progress and status
     * @param {string} jobId - Job ID
     * @param {Object} updates - Progress updates
     */
    async updateProgress(jobId, updates) {
        const job = this.jobs.get(jobId);
        if (!job) {
            console.error(`Job not found: ${jobId}`);
            return;
        }

        // Update progress fields
        if (updates.progress) {
            Object.assign(job.progress, updates.progress);
        }

        // Update status if provided
        if (updates.status) {
            job.status = updates.status;
        }

        // Update method if provided
        if (typeof updates.method === 'string') {
            job.method = updates.method;
        }

        // Update statistics if provided
        if (updates.statistics) {
            if (updates.statistics.saveStats) {
                Object.assign(job.statistics.saveStats, updates.statistics.saveStats);
            }
            if (updates.statistics.errors) {
                job.statistics.errors.push(...updates.statistics.errors);
            }
        }

        // Update error if provided
        if (updates.error) {
            job.error = updates.error;
        }

        job.updatedAt = new Date();

        // Persist to database (only for important status changes)
        if (updates.status && ['completed', 'failed', 'stopped'].includes(updates.status)) {
            try {
                const dbUpdates = {
                    status: updates.status,
                    progress: job.progress,
                    statistics: job.statistics,
                    error_message: updates.error || job.error,
                    end_time: updates.status === 'completed' ? new Date() : null
                };
                
                await this.jobModel.updateJob(jobId, dbUpdates);
            } catch (error) {
                console.error('Error updating job in database:', error);
            }
        }

        // Log real-time progress updates
        this.logProgressUpdate(job);

        // Remove from active jobs if completed or failed
        if (updates.status === 'completed' || updates.status === 'error') {
            this.activeJobs.delete(jobId);
        }
    }

    /**
     * Get current job status
     * @param {string} jobId - Job ID
     * @returns {Object|null} Job status or null if not found
     */
    async getJobStatus(jobId) {
        const job = this.jobs.get(jobId);
        if (job) {
            return {
                jobId: job.jobId,
                city: job.city,
                keyword: job.keyword,
                method: job.method,
                status: job.status,
                progress: {
                    ...job.progress,
                    phrasesProgress: job.progress.totalPhrases > 0 ?
                        Math.round((job.progress.processedPhrases / job.progress.totalPhrases) * 100) : 0,
                    saveSuccessRate: job.progress.totalBusinesses > 0 ?
                        Math.round((job.progress.savedBusinesses / job.progress.totalBusinesses) * 100) : 0
                },
                statistics: {
                    ...job.statistics,
                    totalErrors: job.statistics.errors.length
                },
                createdAt: job.createdAt,
                updatedAt: job.updatedAt,
                error: job.error,
                duration: Date.now() - job.createdAt.getTime()
            };
        }

        // If not found in memory, check database
        try {
            const dbJob = await this.jobModel.getJob(jobId);
            if (dbJob) {
                return {
                    jobId: dbJob.job_id,
                    city: dbJob.city,
                    keyword: dbJob.keyword,
                    method: dbJob.method,
                    status: dbJob.status,
                    progress: dbJob.progress || {},
                    statistics: dbJob.statistics || {},
                    createdAt: dbJob.created_at,
                    updatedAt: dbJob.updated_at,
                    error: dbJob.error_message,
                    duration: dbJob.end_time ? 
                        new Date(dbJob.end_time).getTime() - new Date(dbJob.created_at).getTime() : 
                        Date.now() - new Date(dbJob.created_at).getTime()
                };
            }
        } catch (error) {
            console.error('Error getting job from database:', error);
        }

        return null;
    }

    /**
     * Get all active jobs
     * @returns {Array} Array of active job statuses
     */
    async getActiveJobs() {
        const activeJobs = Array.from(this.activeJobs.keys()).map(jobId => this.getJobStatus(jobId));
        const activeJobsResults = await Promise.all(activeJobs);
        return activeJobsResults.filter(job => job !== null);
    }

    /**
     * Get all jobs (active and completed)
     * @returns {Array} Array of all job statuses
     */
    async getAllJobs() {
        try {
            // Get from database for complete history
            const dbJobs = await this.jobModel.getAllJobs(100, 0);
            return dbJobs.map(dbJob => ({
                jobId: dbJob.job_id,
                city: dbJob.city,
                keyword: dbJob.keyword,
                method: dbJob.method,
                status: dbJob.status,
                progress: dbJob.progress || {},
                statistics: dbJob.statistics || {},
                createdAt: dbJob.created_at,
                updatedAt: dbJob.updated_at,
                error: dbJob.error_message,
                duration: dbJob.end_time ? 
                    new Date(dbJob.end_time).getTime() - new Date(dbJob.created_at).getTime() : 
                    Date.now() - new Date(dbJob.created_at).getTime()
            }));
        } catch (error) {
            console.error('Error getting all jobs from database:', error);
            // Fallback to in-memory jobs
            const memoryJobs = Array.from(this.jobs.keys()).map(jobId => this.getJobStatus(jobId));
            const memoryJobsResults = await Promise.all(memoryJobs);
            return memoryJobsResults.filter(job => job !== null);
        }
    }

    /**
     * Log real-time progress updates showing current phrase and records saved
     * Requirements: 7.5, 6.2
     * @param {Object} job - Job object
     */
    logProgressUpdate(job) {
        const progress = job.progress;
        const stats = job.statistics;

        // Create progress message based on current step
        let progressMessage = `🔄 Job ${job.jobId} Progress:`;

        if (progress.currentStep) {
            progressMessage += ` [${progress.currentStep.toUpperCase()}]`;
        }

        if (progress.currentPhrase) {
            progressMessage += ` Processing: "${progress.currentPhrase}"`;
        }

        if (progress.totalPhrases > 0) {
            const phrasesPercent = Math.round((progress.processedPhrases / progress.totalPhrases) * 100);
            progressMessage += ` | Phrases: ${progress.processedPhrases}/${progress.totalPhrases} (${phrasesPercent}%)`;
        }

        if (progress.totalBusinesses > 0) {
            const savePercent = progress.savedBusinesses > 0 ?
                Math.round((progress.savedBusinesses / progress.totalBusinesses) * 100) : 0;
            progressMessage += ` | Businesses: ${progress.savedBusinesses}/${progress.totalBusinesses} saved (${savePercent}%)`;
        }

        if (stats.errors.length > 0) {
            progressMessage += ` | Errors: ${stats.errors.length}`;
        }

        console.log(progressMessage);

        // Log detailed save statistics if there are businesses processed
        if (progress.totalBusinesses > 0) {
            const saveStats = stats.saveStats;
            // Removed success log to reduce console spam
            // console.log(`📊 Save Stats - PostgreSQL: ${saveStats.postgresql.success}✓/${saveStats.postgresql.failed}✗ | Google Sheets: ${saveStats.googleSheets.success}✓/${saveStats.googleSheets.failed}✗ | Both: ${saveStats.bothSucceeded} | Partial: ${saveStats.partialSuccess}`);
        }
    }

    /**
     * Update current phrase being processed
     * @param {string} jobId - Job ID
     * @param {string} phrase - Current phrase
     * @param {number} phraseIndex - Current phrase index (0-based)
     * @param {number} totalPhrases - Total number of phrases
     */
    updateCurrentPhrase(jobId, phrase, phraseIndex, totalPhrases) {
        this.updateProgress(jobId, {
            progress: {
                currentPhrase: phrase,
                processedPhrases: phraseIndex,
                totalPhrases: totalPhrases,
                currentStep: 'processing_phrases'
            }
        });
    }

    /**
     * Update business processing progress
     * @param {string} jobId - Job ID
     * @param {number} totalBusinesses - Total businesses found
     * @param {number} savedBusinesses - Businesses saved so far
     */
    updateBusinessProgress(jobId, totalBusinesses, savedBusinesses) {
        this.updateProgress(jobId, {
            progress: {
                totalBusinesses,
                savedBusinesses,
                currentStep: 'processing_businesses'
            }
        });
    }

    /**
     * Update save statistics
     * @param {string} jobId - Job ID
     * @param {Object} saveResult - Save result from business data save
     */
    updateSaveStats(jobId, saveResult) {
        const job = this.jobs.get(jobId);
        if (!job) return;

        const saveStats = job.statistics.saveStats;

        // Update individual destination statistics
        if (saveResult.postgresql && saveResult.postgresql.success) {
            saveStats.postgresql.success++;
        } else if (saveResult.postgresql) {
            saveStats.postgresql.failed++;
        }

        if (saveResult.googleSheets && saveResult.googleSheets.success) {
            saveStats.googleSheets.success++;
        } else if (saveResult.googleSheets) {
            saveStats.googleSheets.failed++;
        }

        // Update combined statistics
        const pgSuccess = saveResult.postgresql && saveResult.postgresql.success;
        const sheetsSuccess = saveResult.googleSheets && saveResult.googleSheets.success;

        if (pgSuccess && sheetsSuccess) {
            saveStats.bothSucceeded++;
        } else if (!pgSuccess && !sheetsSuccess) {
            saveStats.bothFailed++;
        } else {
            saveStats.partialSuccess++;
        }

        // Update the job
        this.updateProgress(jobId, {
            statistics: { saveStats }
        });
    }

    /**
     * Add error to job
     * @param {string} jobId - Job ID
     * @param {Object} error - Error information
     */
    addError(jobId, error) {
        this.updateProgress(jobId, {
            statistics: {
                errors: [error]
            }
        });
    }

    /**
     * Mark job as completed
     * @param {string} jobId - Job ID
     * @param {Object} finalStats - Final processing statistics
     */
    completeJob(jobId, finalStats = {}) {
        this.updateProgress(jobId, {
            status: 'completed',
            progress: {
                currentStep: 'completed',
                currentPhrase: null,
                ...finalStats
            }
        });

        console.log(`✅ Job completed: ${jobId}`);
    }

    /**
     * Mark job as failed
     * @param {string} jobId - Job ID
     * @param {string} error - Error message
     */
    failJob(jobId, error) {
        this.updateProgress(jobId, {
            status: 'error',
            error: error,
            progress: {
                currentStep: 'failed',
                currentPhrase: null
            }
        });

        console.log(`❌ Job failed: ${jobId} - ${error}`);
    }

    /**
     * Clean up old completed jobs (keep last 100)
     */
    cleanupOldJobs() {
        const allJobs = Array.from(this.jobs.entries())
            .sort((a, b) => b[1].createdAt - a[1].createdAt);

        if (allJobs.length > 100) {
            const jobsToRemove = allJobs.slice(100);
            jobsToRemove.forEach(([jobId]) => {
                this.jobs.delete(jobId);
                this.activeJobs.delete(jobId);
            });
            console.log(`🧹 Cleaned up ${jobsToRemove.length} old jobs`);
        }
    }
}

module.exports = JobManager;