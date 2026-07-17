const JobManager = require('../../../services/jobManager');

describe('JobManager', () => {
    let jobManager;
    let consoleSpy;

    beforeEach(() => {
        jobManager = new JobManager();
        consoleSpy = jest.spyOn(console, 'log').mockImplementation();
    });

    afterEach(() => {
        consoleSpy.mockRestore();
    });

    describe('constructor', () => {
        it('should initialize with empty job maps', () => {
            expect(jobManager.jobs.size).toBe(0);
            expect(jobManager.activeJobs.size).toBe(0);
        });
    });

    describe('createJob', () => {
        it('should create a new job with unique ID', () => {
            const result = jobManager.createJob('Delhi', 'restaurant');

            expect(result).toEqual({
                jobId: expect.stringMatching(/^job_\d+_[a-z0-9]+$/),
                status: 'started',
                message: 'Lead generation job initiated',
                city: 'Delhi',
                keyword: 'restaurant'
            });

            expect(jobManager.jobs.size).toBe(1);
            expect(jobManager.activeJobs.size).toBe(1);
        });

        it('should create jobs with different IDs', () => {
            const job1 = jobManager.createJob('Delhi', 'restaurant');
            const job2 = jobManager.createJob('Mumbai', 'cafe');

            expect(job1.jobId).not.toBe(job2.jobId);
            expect(jobManager.jobs.size).toBe(2);
            expect(jobManager.activeJobs.size).toBe(2);
        });

        it('should initialize job with default progress structure', () => {
            const result = jobManager.createJob('Delhi', 'restaurant');
            const job = jobManager.jobs.get(result.jobId);

            expect(job.progress).toEqual({
                totalPhrases: 0,
                processedPhrases: 0,
                currentPhrase: null,
                totalBusinesses: 0,
                savedBusinesses: 0,
                currentStep: 'initializing'
            });

            expect(job.statistics).toEqual({
                saveStats: {
                    postgresql: { success: 0, failed: 0 },
                    googleSheets: { success: 0, failed: 0 },
                    bothSucceeded: 0,
                    bothFailed: 0,
                    partialSuccess: 0
                },
                errors: []
            });
        });
    });

    describe('updateProgress', () => {
        let jobId;

        beforeEach(() => {
            const result = jobManager.createJob('Delhi', 'restaurant');
            jobId = result.jobId;
        });

        it('should update job progress', () => {
            const updates = {
                progress: {
                    totalPhrases: 10,
                    processedPhrases: 5,
                    currentPhrase: 'Connaught Place restaurant'
                }
            };

            jobManager.updateProgress(jobId, updates);

            const job = jobManager.jobs.get(jobId);
            expect(job.progress.totalPhrases).toBe(10);
            expect(job.progress.processedPhrases).toBe(5);
            expect(job.progress.currentPhrase).toBe('Connaught Place restaurant');
        });

        it('should update job status', () => {
            jobManager.updateProgress(jobId, { status: 'generating_phrases' });

            const job = jobManager.jobs.get(jobId);
            expect(job.status).toBe('generating_phrases');
        });

        it('should update statistics', () => {
            const updates = {
                statistics: {
                    saveStats: {
                        postgresql: { success: 5, failed: 1 }
                    },
                    errors: [{ message: 'Test error' }]
                }
            };

            jobManager.updateProgress(jobId, updates);

            const job = jobManager.jobs.get(jobId);
            expect(job.statistics.saveStats.postgresql.success).toBe(5);
            expect(job.statistics.saveStats.postgresql.failed).toBe(1);
            expect(job.statistics.errors).toHaveLength(1);
        });

        it('should update error field', () => {
            jobManager.updateProgress(jobId, { error: 'Something went wrong' });

            const job = jobManager.jobs.get(jobId);
            expect(job.error).toBe('Something went wrong');
        });

        it('should remove from active jobs when completed', () => {
            jobManager.updateProgress(jobId, { status: 'completed' });

            expect(jobManager.activeJobs.has(jobId)).toBe(false);
            expect(jobManager.jobs.has(jobId)).toBe(true);
        });

        it('should remove from active jobs when error', () => {
            jobManager.updateProgress(jobId, { status: 'error' });

            expect(jobManager.activeJobs.has(jobId)).toBe(false);
            expect(jobManager.jobs.has(jobId)).toBe(true);
        });

        it('should handle non-existent job ID', () => {
            const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation();

            jobManager.updateProgress('non-existent-id', { status: 'completed' });

            expect(consoleErrorSpy).toHaveBeenCalledWith('Job not found: non-existent-id');
            consoleErrorSpy.mockRestore();
        });

        it('should update updatedAt timestamp', () => {
            const job = jobManager.jobs.get(jobId);
            const originalUpdatedAt = job.updatedAt;

            // Wait a bit to ensure timestamp difference
            setTimeout(() => {
                jobManager.updateProgress(jobId, { status: 'processing' });
                const updatedJob = jobManager.jobs.get(jobId);
                expect(updatedJob.updatedAt.getTime()).toBeGreaterThan(originalUpdatedAt.getTime());
            }, 10);
        });
    });

    describe('getJobStatus', () => {
        let jobId;

        beforeEach(() => {
            const result = jobManager.createJob('Delhi', 'restaurant');
            jobId = result.jobId;
        });

        it('should return job status with calculated progress', () => {
            // Update job with some progress
            jobManager.updateProgress(jobId, {
                progress: {
                    totalPhrases: 10,
                    processedPhrases: 5,
                    totalBusinesses: 20,
                    savedBusinesses: 15
                }
            });

            const status = jobManager.getJobStatus(jobId);

            expect(status).toEqual({
                jobId: jobId,
                city: 'Delhi',
                keyword: 'restaurant',
                status: 'started',
                progress: {
                    totalPhrases: 10,
                    processedPhrases: 5,
                    currentPhrase: null,
                    totalBusinesses: 20,
                    savedBusinesses: 15,
                    currentStep: 'initializing',
                    phrasesProgress: 50, // 5/10 * 100
                    saveSuccessRate: 75  // 15/20 * 100
                },
                statistics: {
                    saveStats: {
                        postgresql: { success: 0, failed: 0 },
                        googleSheets: { success: 0, failed: 0 },
                        bothSucceeded: 0,
                        bothFailed: 0,
                        partialSuccess: 0
                    },
                    errors: [],
                    totalErrors: 0
                },
                createdAt: expect.any(Date),
                updatedAt: expect.any(Date),
                error: null,
                duration: expect.any(Number)
            });
        });

        it('should handle zero totals in progress calculation', () => {
            const status = jobManager.getJobStatus(jobId);

            expect(status.progress.phrasesProgress).toBe(0);
            expect(status.progress.saveSuccessRate).toBe(0);
        });

        it('should return null for non-existent job', () => {
            const status = jobManager.getJobStatus('non-existent-id');
            expect(status).toBeNull();
        });
    });

    describe('getActiveJobs', () => {
        it('should return empty array when no active jobs', () => {
            const activeJobs = jobManager.getActiveJobs();
            expect(activeJobs).toEqual([]);
        });

        it('should return active jobs only', () => {
            const job1 = jobManager.createJob('Delhi', 'restaurant');
            const job2 = jobManager.createJob('Mumbai', 'cafe');

            // Complete one job
            jobManager.updateProgress(job1.jobId, { status: 'completed' });

            const activeJobs = jobManager.getActiveJobs();
            expect(activeJobs).toHaveLength(1);
            expect(activeJobs[0].jobId).toBe(job2.jobId);
        });
    });

    describe('getAllJobs', () => {
        it('should return all jobs including completed ones', () => {
            const job1 = jobManager.createJob('Delhi', 'restaurant');
            const job2 = jobManager.createJob('Mumbai', 'cafe');

            // Complete one job
            jobManager.updateProgress(job1.jobId, { status: 'completed' });

            const allJobs = jobManager.getAllJobs();
            expect(allJobs).toHaveLength(2);
        });
    });

    describe('updateCurrentPhrase', () => {
        let jobId;

        beforeEach(() => {
            const result = jobManager.createJob('Delhi', 'restaurant');
            jobId = result.jobId;
        });

        it('should update current phrase and progress', () => {
            jobManager.updateCurrentPhrase(jobId, 'Connaught Place restaurant', 2, 10);

            const job = jobManager.jobs.get(jobId);
            expect(job.progress.currentPhrase).toBe('Connaught Place restaurant');
            expect(job.progress.processedPhrases).toBe(2);
            expect(job.progress.totalPhrases).toBe(10);
            expect(job.progress.currentStep).toBe('processing_phrases');
        });
    });

    describe('updateBusinessProgress', () => {
        let jobId;

        beforeEach(() => {
            const result = jobManager.createJob('Delhi', 'restaurant');
            jobId = result.jobId;
        });

        it('should update business progress', () => {
            jobManager.updateBusinessProgress(jobId, 50, 25);

            const job = jobManager.jobs.get(jobId);
            expect(job.progress.totalBusinesses).toBe(50);
            expect(job.progress.savedBusinesses).toBe(25);
            expect(job.progress.currentStep).toBe('processing_businesses');
        });
    });

    describe('updateSaveStats', () => {
        let jobId;

        beforeEach(() => {
            const result = jobManager.createJob('Delhi', 'restaurant');
            jobId = result.jobId;
        });

        it('should update save statistics for both successful', () => {
            const saveResult = {
                postgresql: { success: true },
                googleSheets: { success: true }
            };

            jobManager.updateSaveStats(jobId, saveResult);

            const job = jobManager.jobs.get(jobId);
            expect(job.statistics.saveStats.postgresql.success).toBe(1);
            expect(job.statistics.saveStats.googleSheets.success).toBe(1);
            expect(job.statistics.saveStats.bothSucceeded).toBe(1);
        });

        it('should update save statistics for both failed', () => {
            const saveResult = {
                postgresql: { success: false },
                googleSheets: { success: false }
            };

            jobManager.updateSaveStats(jobId, saveResult);

            const job = jobManager.jobs.get(jobId);
            expect(job.statistics.saveStats.postgresql.failed).toBe(1);
            expect(job.statistics.saveStats.googleSheets.failed).toBe(1);
            expect(job.statistics.saveStats.bothFailed).toBe(1);
        });

        it('should update save statistics for partial success', () => {
            const saveResult = {
                postgresql: { success: true },
                googleSheets: { success: false }
            };

            jobManager.updateSaveStats(jobId, saveResult);

            const job = jobManager.jobs.get(jobId);
            expect(job.statistics.saveStats.postgresql.success).toBe(1);
            expect(job.statistics.saveStats.googleSheets.failed).toBe(1);
            expect(job.statistics.saveStats.partialSuccess).toBe(1);
        });

        it('should handle non-existent job gracefully', () => {
            jobManager.updateSaveStats('non-existent', {});
            // Should not throw error
        });
    });

    describe('addError', () => {
        let jobId;

        beforeEach(() => {
            const result = jobManager.createJob('Delhi', 'restaurant');
            jobId = result.jobId;
        });

        it('should add error to job', () => {
            const error = { message: 'Test error', step: 'test_step' };

            jobManager.addError(jobId, error);

            const job = jobManager.jobs.get(jobId);
            expect(job.statistics.errors).toContain(error);
        });
    });

    describe('completeJob', () => {
        let jobId;

        beforeEach(() => {
            const result = jobManager.createJob('Delhi', 'restaurant');
            jobId = result.jobId;
        });

        it('should mark job as completed', () => {
            const finalStats = { totalBusinesses: 100, savedBusinesses: 95 };

            jobManager.completeJob(jobId, finalStats);

            const job = jobManager.jobs.get(jobId);
            expect(job.status).toBe('completed');
            expect(job.progress.currentStep).toBe('completed');
            expect(job.progress.currentPhrase).toBeNull();
            expect(job.progress.totalBusinesses).toBe(100);
            expect(job.progress.savedBusinesses).toBe(95);
            expect(jobManager.activeJobs.has(jobId)).toBe(false);
        });
    });

    describe('failJob', () => {
        let jobId;

        beforeEach(() => {
            const result = jobManager.createJob('Delhi', 'restaurant');
            jobId = result.jobId;
        });

        it('should mark job as failed', () => {
            jobManager.failJob(jobId, 'Something went wrong');

            const job = jobManager.jobs.get(jobId);
            expect(job.status).toBe('error');
            expect(job.error).toBe('Something went wrong');
            expect(job.progress.currentStep).toBe('failed');
            expect(job.progress.currentPhrase).toBeNull();
            expect(jobManager.activeJobs.has(jobId)).toBe(false);
        });
    });

    describe('cleanupOldJobs', () => {
        it('should keep jobs under limit', () => {
            // Create 50 jobs (under limit)
            for (let i = 0; i < 50; i++) {
                jobManager.createJob(`City${i}`, `keyword${i}`);
            }

            jobManager.cleanupOldJobs();

            expect(jobManager.jobs.size).toBe(50);
        });

        it('should remove old jobs when over limit', () => {
            // Create 105 jobs (over limit of 100)
            for (let i = 0; i < 105; i++) {
                jobManager.createJob(`City${i}`, `keyword${i}`);
            }

            jobManager.cleanupOldJobs();

            expect(jobManager.jobs.size).toBe(100);
        });

        it('should keep most recent jobs', () => {
            // Create jobs with different timestamps
            const oldJobIds = [];
            const newJobIds = [];

            // Create 50 old jobs
            for (let i = 0; i < 50; i++) {
                const result = jobManager.createJob(`OldCity${i}`, `oldkeyword${i}`);
                oldJobIds.push(result.jobId);
                // Manually set older timestamp
                const job = jobManager.jobs.get(result.jobId);
                job.createdAt = new Date(Date.now() - (105 - i) * 1000);
            }

            // Create 55 new jobs
            for (let i = 0; i < 55; i++) {
                const result = jobManager.createJob(`NewCity${i}`, `newkeyword${i}`);
                newJobIds.push(result.jobId);
            }

            jobManager.cleanupOldJobs();

            expect(jobManager.jobs.size).toBe(100);

            // Check that newer jobs are kept
            newJobIds.forEach(jobId => {
                expect(jobManager.jobs.has(jobId)).toBe(true);
            });
        });
    });

    describe('logProgressUpdate', () => {
        let jobId;

        beforeEach(() => {
            const result = jobManager.createJob('Delhi', 'restaurant');
            jobId = result.jobId;
        });

        it('should log progress with current phrase', () => {
            jobManager.updateProgress(jobId, {
                progress: {
                    currentStep: 'processing_phrases',
                    currentPhrase: 'Connaught Place restaurant',
                    totalPhrases: 10,
                    processedPhrases: 5,
                    totalBusinesses: 20,
                    savedBusinesses: 15
                }
            });

            expect(consoleSpy).toHaveBeenCalledWith(
                expect.stringContaining('Job ' + jobId + ' Progress:')
            );
            expect(consoleSpy).toHaveBeenCalledWith(
                expect.stringContaining('[PROCESSING_PHRASES]')
            );
            expect(consoleSpy).toHaveBeenCalledWith(
                expect.stringContaining('Processing: "Connaught Place restaurant"')
            );
            expect(consoleSpy).toHaveBeenCalledWith(
                expect.stringContaining('Phrases: 5/10 (50%)')
            );
            expect(consoleSpy).toHaveBeenCalledWith(
                expect.stringContaining('Businesses: 15/20 saved (75%)')
            );
        });

        it('should log save statistics when businesses are processed', () => {
            jobManager.updateProgress(jobId, {
                progress: { totalBusinesses: 10, savedBusinesses: 8 },
                statistics: {
                    saveStats: {
                        postgresql: { success: 7, failed: 1 },
                        googleSheets: { success: 6, failed: 2 },
                        bothSucceeded: 5,
                        partialSuccess: 3
                    }
                }
            });

            expect(consoleSpy).toHaveBeenCalledWith(
                expect.stringContaining('Save Stats - PostgreSQL: 7✓/1✗ | Google Sheets: 6✓/2✗ | Both: 5 | Partial: 3')
            );
        });
    });
});