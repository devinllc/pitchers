/**
 * SocialJobManager - Handles job tracking and progress for B2C & C2C social lead extraction
 * 100% isolated and separated from the traditional B2B maps scraper job manager.
 */
const SocialJob = require('../models/SocialJob');
const DatabaseService = require('./database');

class SocialJobManager {
    constructor() {
        this.databaseService = new DatabaseService();
        this.socialJobModel = new SocialJob(this.databaseService);
        this.socialJobModel.createSocialJobsTable().catch(console.error);
        
        // In-memory active jobs tracking for speed
        this.jobs = new Map();
        this.activeJobs = new Map();
    }

    /**
     * Create a new social extraction job
     */
    async createJob(platform, segment, searchType, searchValue, userEmail = null) {
        const jobId = `social_job_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;

        const job = {
            jobId,
            platform,
            segment,
            searchType,
            searchValue,
            status: 'started',
            progress: {
                total: 0,
                processed: 0,
                currentStep: 'initializing'
            },
            statistics: {
                saved: 0,
                failed: 0,
                errors: []
            },
            createdAt: new Date(),
            updatedAt: new Date(),
            error: null
        };

        try {
            await this.socialJobModel.createSocialJob({
                jobId,
                userEmail,
                platform,
                segment,
                searchType,
                searchValue,
                status: 'started'
            });
        } catch (error) {
            console.error('Error saving social job to database:', error);
        }

        this.jobs.set(jobId, job);
        this.activeJobs.set(jobId, job);

        console.log(`📋 [SOCIAL JOB] Created: ${jobId} | Platform: ${platform} | Segment: ${segment} | Search: ${searchType}=${searchValue}`);

        return {
            jobId,
            status: job.status,
            message: 'Social extraction job initiated successfully',
            platform,
            segment,
            searchType,
            searchValue
        };
    }

    /**
     * Update job progress and status
     */
    async updateProgress(jobId, updates) {
        const job = this.jobs.get(jobId);
        if (!job) {
            console.error(`Social job not found in memory: ${jobId}`);
            return;
        }

        if (updates.progress) {
            Object.assign(job.progress, updates.progress);
        }

        if (updates.status) {
            job.status = updates.status;
        }

        if (updates.statistics) {
            if (updates.statistics.saved !== undefined) job.statistics.saved = updates.statistics.saved;
            if (updates.statistics.failed !== undefined) job.statistics.failed = updates.statistics.failed;
            if (updates.statistics.errors) {
                job.statistics.errors.push(...updates.statistics.errors);
            }
        }

        if (updates.error) {
            job.error = updates.error;
        }

        job.updatedAt = new Date();

        // Persist final states or significant updates to DB
        if (updates.status && ['completed', 'failed', 'stopped', 'error'].includes(updates.status)) {
            try {
                const dbUpdates = {
                    status: updates.status === 'error' ? 'failed' : updates.status,
                    progress: job.progress,
                    statistics: job.statistics,
                    error_message: updates.error || job.error,
                    end_time: new Date()
                };
                
                await this.socialJobModel.updateSocialJob(jobId, dbUpdates);
            } catch (error) {
                console.error('Error updating social job in database:', error);
            }
        }

        // Print progress
        this.logProgressUpdate(job);

        // Remove from active jobs if finished
        if (updates.status === 'completed' || updates.status === 'failed' || updates.status === 'error') {
            this.activeJobs.delete(jobId);
        }
    }

    /**
     * Get job status
     */
    async getJobStatus(jobId) {
        const job = this.jobs.get(jobId);
        if (job) {
            return {
                jobId: job.jobId,
                platform: job.platform,
                segment: job.segment,
                searchType: job.searchType,
                searchValue: job.searchValue,
                status: job.status,
                progress: {
                    ...job.progress,
                    percent: job.progress.total > 0 ? Math.round((job.progress.processed / job.progress.total) * 100) : 0
                },
                statistics: job.statistics,
                createdAt: job.createdAt,
                updatedAt: job.updatedAt,
                error: job.error,
                duration: Date.now() - job.createdAt.getTime()
            };
        }

        try {
            const dbJob = await this.socialJobModel.getSocialJob(jobId);
            if (dbJob) {
                return {
                    jobId: dbJob.job_id,
                    platform: dbJob.platform,
                    segment: dbJob.segment,
                    searchType: dbJob.search_type,
                    searchValue: dbJob.search_value,
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
            console.error('Error fetching social job from DB:', error);
        }

        return null;
    }

    /**
     * Get active social jobs
     */
    async getActiveJobs() {
        const activePromises = Array.from(this.activeJobs.keys()).map(jobId => this.getJobStatus(jobId));
        const activeResults = await Promise.all(activePromises);
        return activeResults.filter(j => j !== null);
    }

    /**
     * Get all social jobs
     */
    async getAllJobs() {
        try {
            const dbJobs = await this.socialJobModel.getAllSocialJobs(100, 0);
            return dbJobs.map(dbJob => ({
                jobId: dbJob.job_id,
                platform: dbJob.platform,
                segment: dbJob.segment,
                searchType: dbJob.search_type,
                searchValue: dbJob.search_value,
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
            console.error('Error fetching all social jobs from DB:', error);
            const memoryPromises = Array.from(this.jobs.keys()).map(jobId => this.getJobStatus(jobId));
            const memoryResults = await Promise.all(memoryPromises);
            return memoryResults.filter(j => j !== null);
        }
    }

    /**
     * Log progress details
     */
    logProgressUpdate(job) {
        const progress = job.progress;
        const stats = job.statistics;
        console.log(`🔄 [SOCIAL JOB ${job.jobId}] Step: ${progress.currentStep} | Progress: ${progress.processed}/${progress.total} | Saved: ${stats.saved} | Errors: ${stats.errors.length}`);
    }

    /**
     * Complete job successfully
     */
    completeJob(jobId, finalStats = {}) {
        this.updateProgress(jobId, {
            status: 'completed',
            progress: {
                currentStep: 'completed',
                processed: finalStats.total || 0,
                total: finalStats.total || 0
            },
            statistics: {
                saved: finalStats.saved || 0,
                failed: finalStats.failed || 0
            }
        });
        console.log(`✅ [SOCIAL JOB] Completed: ${jobId}`);
    }

    /**
     * Fail job with error
     */
    failJob(jobId, error) {
        this.updateProgress(jobId, {
            status: 'error',
            error: error,
            progress: {
                currentStep: 'failed'
            }
        });
        console.log(`❌ [SOCIAL JOB] Failed: ${jobId} - Reason: ${error}`);
    }
}

module.exports = new SocialJobManager();
