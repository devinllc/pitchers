const GeminiService = require('./geminiService');
const GoogleMapsService = require('./googleMapsService');
const GoogleMapsWebService = require('./googleMapsWebService');
const DatabaseService = require('./database');
const RateLimiter = require('./rateLimiter');
const ErrorHandler = require('./errorHandler');
const DatabaseJobManager = require('./databaseJobManager');
const PerformanceMonitor = require('./performanceMonitor');
const StreamingProcessor = require('./streamingProcessor');

/**
 * ProcessingService - Main orchestrator for the local business scraper workflow
 * Implements the exact 14-step flow from design document
 * Requirements: 7.1, 7.2
 */
class ProcessingService {
    constructor() {
        // Core utilities
        this.errorHandler = new ErrorHandler();
        this.rateLimiter = new RateLimiter();
        this.performanceMonitor = new PerformanceMonitor();

        // Services
        this.geminiService = new GeminiService();
        // Set up pause/stop functions for GeminiService
        this.geminiService.isPaused = () => this.isPaused && this.isPaused();
        this.geminiService.shouldStop = () => this.shouldStop && this.shouldStop();
        this.googleMapsService = new GoogleMapsService();
        this.googleMapsWebService = null; // Will be created dynamically per job
        this.databaseService = new DatabaseService();
        // Database-based job management (no in-memory state)
        this.databaseJobManager = DatabaseJobManager.getInstance();
        this.streamingProcessor = new StreamingProcessor(5); // Process 5 items at a time for memory efficiency

        // Batch processing for Google Sheets performance optimization
        this.sheetsBatchQueue = [];
        this.batchSize = 50; // Larger batches amortize API overhead without noticeable latency
        this.batchTimeout = 750; // Faster grouping to reduce end-of-run drain time
        this.batchTimer = null;
        this.isProcessingBatch = false; // reentrancy guard

        // Processing state
        this.isProcessing = false;
        this.isPaused = false;
        this.shouldStop = false;
        this.currentJob = null;
        this.currentJobStats = {
            totalPhrases: 0,
            processedPhrases: 0,
            totalBusinesses: 0,
            savedBusinesses: 0,
            saveStats: {
                postgresql: { success: 0, failed: 0 },
                googleSheets: { success: 0, failed: 0 },
                bothSucceeded: 0,
                bothFailed: 0,
                partialSuccess: 0
            },
            errors: []
        };
    }

    /**
     * Main processing pipeline that orchestrates the entire workflow
     * @param {string} city - The city name
     * @param {string} keyword - The business keyword
     * @param {Object} options - Optional processing options { method?: 'api'|'web', scraper?: { maxResults?: number, maxScrollPages?: number, headless?: boolean } }
     * @returns {Promise<Object>} Processing results and statistics
     */
    async processLeadGeneration(city, keyword, options = {}) {
        // Use provided jobId if available (for worker threads), otherwise create new job
        let jobId;
        if (options.jobId) {
            jobId = options.jobId;
            console.log(`[PROCESSING_SERVICE] Using provided jobId: ${jobId}`);
        } else {
            // Create job with database-based tracking
            const jobInfo = await this.databaseJobManager.createJob(city, keyword, options.userEmail, options);
            jobId = jobInfo.jobId;
            console.log(`[PROCESSING_SERVICE] Created new jobId: ${jobId}`);
        }

        // Reset job-specific stats
        this.currentJobStats = {
            totalBusinesses: 0,
            savedBusinesses: 0,
            errors: []
        };

        const method = options.method === 'web' ? 'web' : 'api';
        this.currentJob = {
            jobId,
            city,
            keyword,
            method,
            options,
            startTime: new Date(),
            userEmail: options.userEmail,
            targetSheetId: options.targetSheetId,
            // New flexible parameters - ensure they are properly set
            targetDataCount: options.targetDataCount || null,
            maxPhrases: options.maxPhrases || null,
            pageRange: options.pageRange || null
        };

        console.log(`🔍 ProcessingService Debug: this.currentJob =`, JSON.stringify(this.currentJob, null, 2));

        // Track job start in performance monitor
        this.performanceMonitor.trackJobEvent('started', { city, keyword });
        this.errorHandler.logJobStatus(jobId, 'started', { city, keyword });

        try {
            // Step 1: User enters city and keyword (already provided)
            if (this.databaseJobManager && this.databaseJobManager.jobModel) {
                await this.databaseJobManager.jobModel.updateJob(jobId, {
                    progress: { currentStep: 'input_validated' }
                });
            }
            this.errorHandler.logProgress('processLeadGeneration', {
                status: 'step_1_complete',
                message: 'Input received - City and keyword validated',
                city: city,
                keyword: keyword
            });

            // Step 2: Pass to Gemini AI with specific prompt
            if (this.databaseJobManager && this.databaseJobManager.jobModel) {
                await this.databaseJobManager.jobModel.updateJob(jobId, {
                    progress: { currentStep: 'generating_phrases' }
                });
            }
            this.errorHandler.logProgress('processLeadGeneration', {
                status: 'step_2_started',
                message: 'Generating search phrases using Gemini AI'
            });

            console.log(`🔍 Debug: maxPhrases = ${this.currentJob.maxPhrases}, targetDataCount = ${this.currentJob.targetDataCount}`);
            console.log(`🔍 Debug: options.maxPhrases = ${options.maxPhrases}, options.targetDataCount = ${options.targetDataCount}`);

            const searchPhrases = await this.generateSearchPhrases(city, keyword, jobId, {
                maxPhrases: this.currentJob.maxPhrases || options.maxPhrases || null
            });

            // Step 3: AI converts to search phrases
            if (this.databaseJobManager && this.databaseJobManager.jobModel) {
                await this.databaseJobManager.jobModel.updateJob(jobId, {
                    progress: {
                        currentStep: 'phrases_generated',
                        totalPhrases: searchPhrases.length
                    }
                });
            }
            this.errorHandler.logProgress('processLeadGeneration', {
                status: 'step_3_complete',
                message: `Generated ${searchPhrases.length} search phrases`,
                phrasesGenerated: searchPhrases.length
            });

            // Step 4: Store all queries in array
            this.currentJobStats.totalPhrases = searchPhrases.length;
            this.errorHandler.logProgress('processLeadGeneration', {
                status: 'step_4_complete',
                message: 'Search phrases stored in processing queue',
                totalPhrases: this.currentJobStats.totalPhrases
            });

            // Step 5-14: Loop through each query and process
            if (this.databaseJobManager && this.databaseJobManager.jobModel) {
                await this.databaseJobManager.jobModel.updateJob(jobId, {
                    progress: { currentStep: 'processing_phrases' }
                });
            }
            this.errorHandler.logProgress('processLeadGeneration', {
                status: 'step_5_14_started',
                message: 'Processing search phrases sequentially'
            });

            await this.processSearchPhrases(searchPhrases, jobId, options);

            // Flush any remaining batched Google Sheets saves
            console.log('🔄 Flushing remaining batch queue...');
            await this.flushBatchQueue();

            // Complete processing
            const results = this.getProcessingResults();
            const jobDuration = Date.now() - this.currentJob.startTime.getTime();

            // Track job completion in performance monitor
            this.performanceMonitor.trackJobEvent('completed', {
                duration: jobDuration,
                phrasesProcessed: this.currentJobStats.processedPhrases || 0,
                businessesFound: this.currentJobStats.totalBusinesses || 0,
                businessesSaved: this.currentJobStats.savedBusinesses || 0
            });

            if (this.databaseJobManager && this.databaseJobManager.jobModel) {
                await this.databaseJobManager.jobModel.updateJob(jobId, {
                    status: 'completed',
                    progress: {
                        totalPhrases: this.currentJobStats.totalPhrases || 0,
                        processedPhrases: this.currentJobStats.processedPhrases || 0,
                        totalBusinesses: this.currentJobStats.totalBusinesses || 0,
                        savedBusinesses: this.currentJobStats.savedBusinesses || 0,
                        currentStep: 'completed'
                    },
                    statistics: this.currentJobStats.statistics || {},
                    end_time: new Date()
                });
            }

            this.errorHandler.logJobStatus(jobId, 'completed', {
                phrasesProcessed: this.currentJobStats.processedPhrases || 0,
                businessesFound: this.currentJobStats.totalBusinesses || 0,
                businessesSaved: this.currentJobStats.savedBusinesses || 0,
                totalErrors: this.currentJobStats.errors.length || 0,
                duration: jobDuration
            });

            return results;

        } catch (error) {
            // Track job failure in performance monitor
            this.performanceMonitor.trackJobEvent('failed', { error: error.message });

            if (this.databaseJobManager && this.databaseJobManager.jobModel) {
                await this.databaseJobManager.jobModel.updateJob(jobId, {
                    status: 'failed',
                    error_message: error.message,
                    end_time: new Date()
                });
            }

            this.errorHandler.logAndContinue(error, {
                operation: 'processLeadGeneration',
                jobId: jobId,
                city: city,
                keyword: keyword
            });

            this.currentJobStats.errors.push({
                step: 'main_pipeline',
                error: error.message,
                timestamp: new Date().toISOString()
            });

            this.errorHandler.logJobStatus(jobId, 'failed', {
                error: error.message,
                phrasesProcessed: this.currentJobStats.processedPhrases || 0,
                businessesFound: this.currentJobStats.totalBusinesses || 0,
                businessesSaved: this.currentJobStats.savedBusinesses || 0,
                totalErrors: this.currentJobStats.errors.length || 0
            });

            throw error;
        } finally {
            this.isProcessing = false;
            this.isPaused = false;
            this.shouldStop = false;
            this.currentJob = null;
        }

    }

    /**
     * Generate search phrases using Gemini AI
     * @param {string} city - The city name
     * @param {string} keyword - The business keyword
     * @param {string} jobId - Job ID for progress tracking
     * @returns {Promise<string[]>} Array of search phrases
     */
    async generateSearchPhrases(city, keyword, jobId, phraseOptions = {}) {
        const startTime = Date.now();

        try {
            const searchPhrases = await this.geminiService.generateSearchPhrases(city, keyword, {
                maxPhrases: typeof phraseOptions?.maxPhrases === 'number' ? phraseOptions.maxPhrases : undefined
            });
            const duration = Date.now() - startTime;

            // Track Gemini API performance
            this.performanceMonitor.trackApiCall('gemini', duration, true);

            // Validate search phrases for Google Maps API compatibility
            const validatedPhrases = this.geminiService.validateSearchPhrases(searchPhrases);

            if (validatedPhrases.length === 0) {
                throw new Error('No valid search phrases generated');
            }

            console.log(`Generated ${validatedPhrases.length} valid search phrases in ${duration}ms`);
            return validatedPhrases;

        } catch (error) {
            const duration = Date.now() - startTime;

            // Track Gemini API failure
            this.performanceMonitor.trackApiCall('gemini', duration, false);

            console.error('Error generating search phrases:', error.message);
            this.currentJobStats.errors.push({
                step: 'generate_phrases',
                error: error.message,
                timestamp: new Date().toISOString()
            });

            throw error;
        }
    }

    /**
     * Process all search phrases using streaming processing for memory efficiency
     * @param {string[]} searchPhrases - Array of search phrases to process
     * @param {string} jobId - Job ID for progress tracking
     */
    async processSearchPhrases(searchPhrases, jobId, options = {}) {
        console.log(`🌊 Starting flexible phrase processing: ${searchPhrases.length} phrases`);

        // Check if we have target data count - if so, we'll continue until we reach it
        const targetDataCount = this.currentJob?.targetDataCount;
        const pageRange = this.currentJob?.pageRange;

        if (targetDataCount) {
            console.log(`🎯 Target data count: ${targetDataCount} businesses`);
        }
        if (pageRange) {
            console.log(`📄 Page range: ${pageRange.start || 1} to ${pageRange.end || 'unlimited'}`);
        }

        // If using web scraper, default to single-phrase processing unless the caller explicitly
        // requests higher concurrency via options.phraseConcurrency > 1
        const isWeb = this.currentJob && this.currentJob.method === 'web';
        const requested = typeof options.phraseConcurrency === 'number' ? options.phraseConcurrency : 1;
        const phraseConcurrency = Math.max(1, Math.min(requested, 5));

        if (isWeb && phraseConcurrency > 1) {
            console.log(`🚀 Running phrase-level concurrency: ${phraseConcurrency} workers`);

            let index = 0;
            const total = searchPhrases.length;

            const worker = async () => {
                while (true) {
                    // Stop/pause handling
                    if (this.shouldStop && this.shouldStop()) break;
                    while (this.isPaused && this.isPaused()) {
                        console.log('⏸️  Processing paused - waiting for resume...');
                        await new Promise(resolve => setTimeout(resolve, 1000));
                        if (this.shouldStop && this.shouldStop()) return;
                    }

                    const i = index++;
                    if (i >= total) break;
                    const phrase = searchPhrases[i];
                    await this._processSinglePhrase(phrase, i, total, jobId, options, searchPhrases);
                }
            };

            const workers = Array.from({ length: phraseConcurrency }, () => worker());
            await Promise.all(workers);

            // Removed success log to reduce console spam
            // console.log(`✅ Phrase processing completed: ${this.currentJobStats.processedPhrases}/${searchPhrases.length} phrases processed`);
            return;
        }

        // Fallback: original sequential processing (API method or concurrency disabled)
        // Implement flexible data extraction - continue until target reached
        let phraseIndex = 0;
        let totalProcessedPhrases = 0;

        while (phraseIndex < searchPhrases.length) {
            // Check if we've reached target data count
            if (targetDataCount && this.currentJobStats.savedBusinesses >= targetDataCount) {
                console.log(`🎯 Target data count reached: ${this.currentJobStats.savedBusinesses}/${targetDataCount} businesses`);
                break;
            }

            // Check for stop request
            if (this.shouldStop && this.shouldStop()) {
                console.log('⏹️  Processing stopped by user request');
                if (jobId && this.databaseJobManager && this.databaseJobManager.jobModel) {
                    await this.databaseJobManager.jobModel.updateJob(jobId, {
                        status: 'stopped',
                        progress: { currentStep: 'stopped_by_user' }
                    });
                }
                break;
            }

            // Check for pause request
            while (this.isPaused && this.isPaused()) {
                console.log('⏸️  Processing paused - waiting for resume...');
                await new Promise(resolve => setTimeout(resolve, 1000));

                // Check if stop was requested while paused
                if (this.shouldStop && this.shouldStop()) {
                    console.log('⏹️  Processing stopped while paused');
                    if (jobId && this.databaseJobManager && this.databaseJobManager.jobModel) {
                        await this.databaseJobManager.jobModel.updateJob(jobId, {
                            status: 'stopped',
                            progress: { currentStep: 'stopped_by_user' }
                        });
                    }
                    return;
                }
            }

            const phrase = searchPhrases[phraseIndex];
            await this._processSinglePhrase(phrase, phraseIndex, searchPhrases.length, jobId, options, searchPhrases);

            phraseIndex++;
            totalProcessedPhrases++;

            // Update progress with flexible processing info
            if (jobId && this.databaseJobManager && this.databaseJobManager.jobModel) {
                const progressPercentage = targetDataCount
                    ? Math.min(100, Math.round((this.currentJobStats.savedBusinesses / targetDataCount) * 100))
                    : Math.round((totalProcessedPhrases / searchPhrases.length) * 100);

                await this.databaseJobManager.jobModel.updateJob(jobId, {
                    progress: {
                        processedPhrases: totalProcessedPhrases,
                        totalPhrases: searchPhrases.length,
                        totalBusinesses: this.currentJobStats.totalBusinesses,
                        savedBusinesses: this.currentJobStats.savedBusinesses,
                        currentStep: 'processing_phrases',
                        targetDataCount: targetDataCount,
                        progressPercentage: progressPercentage,
                        remainingTarget: targetDataCount ? Math.max(0, targetDataCount - this.currentJobStats.savedBusinesses) : null,
                        avgBusinessesPerPhrase: totalProcessedPhrases > 0 ? Math.round(this.currentJobStats.savedBusinesses / totalProcessedPhrases) : 0
                    }
                });

                // Log progress every 5 phrases or when target is reached
                if (totalProcessedPhrases % 5 === 0 || (targetDataCount && this.currentJobStats.savedBusinesses >= targetDataCount)) {
                    console.log(`📊 Progress: ${totalProcessedPhrases}/${searchPhrases.length} phrases, ${this.currentJobStats.savedBusinesses}/${targetDataCount || '∞'} businesses (${progressPercentage}%)`);
                }
            }
        }

        // Removed success log to reduce console spam
        // console.log(`✅ Phrase processing completed: ${this.currentJobStats.processedPhrases}/${searchPhrases.length} phrases processed`);
    }

    // Helper: process a single phrase (shared by sequential and concurrent paths)
    async _processSinglePhrase(phrase, index, total, jobId, options = {}, searchPhrases = []) {
        // Update current phrase being processed
        if (jobId && this.databaseJobManager && this.databaseJobManager.jobModel) {
            await this.databaseJobManager.jobModel.updateJob(jobId, {
                progress: {
                    currentPhrase: phrase,
                    processedPhrases: index,
                    totalPhrases: total,
                    currentStep: 'processing_phrases'
                }
            });
        }

        console.log(`\n--- Processing phrase ${index + 1}/${total}: "${phrase}" ---`);

        try {
            // Step 5: Adaptive delay only for sequential API path; keep light for web UI
            if (!this.currentJob || this.currentJob.method !== 'web') {
                if (index > 0) {
                    console.log('Applying adaptive rate limiting...');
                    await this.rateLimiter.delay();
                }
            }

            if (this.currentJob && this.currentJob.method === 'web') {
                // Create GoogleMapsWebService instance dynamically with correct options
                const scraper = options.scraper || {};
                this.googleMapsWebService = new GoogleMapsWebService({
                    errorHandler: this.errorHandler,
                    rateLimiter: this.rateLimiter,
                    performanceMonitor: this.performanceMonitor,
                    headless: scraper.headless !== undefined ? scraper.headless : false,
                    maxScrollPages: scraper.maxScrollPages || 10
                });

                // Set up pause/stop functions for GoogleMapsWebService
                this.googleMapsWebService.isPaused = () => this.isPaused && this.isPaused();
                this.googleMapsWebService.shouldStop = () => this.shouldStop && this.shouldStop();

                console.log(`🔍 Created GoogleMapsWebService with headless = ${this.googleMapsWebService.headless}`);

                // Calculate optimal maxResults based on target data count - MINIMUM 60 per phrase
                let maxResults = typeof scraper.maxResults === 'number' ? scraper.maxResults : 2000; // Default to 2000 for aggressive extraction

                // Override with targetDataCount if provided
                if (this.currentJob?.targetDataCount && this.currentJob.targetDataCount > 0) {
                    maxResults = this.currentJob.targetDataCount;
                    console.log(`🎯 Using targetDataCount as maxResults: ${maxResults}`);
                }

                console.log(`🔍 Debug Phrase ${index + 1}: targetDataCount = ${this.currentJob?.targetDataCount}, savedBusinesses = ${this.currentJobStats.savedBusinesses}`);

                // If we have a target data count, calculate the remaining target
                if (this.currentJob?.targetDataCount && this.currentJob.targetDataCount > 0) {
                    const remainingPhrases = searchPhrases.length - index;
                    const remainingTarget = this.currentJob.targetDataCount - this.currentJobStats.savedBusinesses;

                    console.log(`🔍 Debug: remainingPhrases = ${remainingPhrases}, remainingTarget = ${remainingTarget}`);

                    if (remainingTarget > 0) {
                        maxResults = Math.min(maxResults, remainingTarget);
                        console.log(`🎯 Phrase ${index + 1}: Targeting ${remainingTarget} remaining businesses (maxResults: ${maxResults})`);
                    } else {
                        maxResults = 0; // Target already reached
                    }
                }
                const wantWebsite = !!scraper.wantWebsite;
                const wantEmail = !!scraper.wantEmail || !!options.wantEmail;
                const emailDeepPaths = !!scraper.emailDeepPaths || !!options.emailDeepPaths;

                // Stream-save via callback as soon as a business is extracted
                let foundCount = 0;
                const onBusiness = async (businessData) => {
                    try {
                        // Add user context to business data for multi-tenant saving
                        const enrichedBusinessData = {
                            ...businessData,
                            userEmail: options.userEmail || 'default@example.com',
                            jobId: jobId,
                            sheetId: options.targetSheetId || null
                        };

                        // Removed debug log to reduce console spam
                        // console.log(`[DEBUG] Processing business for save:`, {
                        //     name: enrichedBusinessData.name,
                        //     userEmail: enrichedBusinessData.userEmail,
                        //     jobId: enrichedBusinessData.jobId,
                        //     sheetId: enrichedBusinessData.sheetId,
                        //     hasPhone: !!enrichedBusinessData.phone,
                        //     hasWebsite: !!enrichedBusinessData.website
                        // });

                        const saveResults = await this.saveBusinessData(enrichedBusinessData, jobId);
                        this.currentJobStats.totalBusinesses++;
                        if (saveResults.postgresql.success) {
                            this.currentJobStats.savedBusinesses++;
                        }
                        this.updateSaveStatistics(saveResults);
                        if (jobId && this.databaseJobManager && this.databaseJobManager.jobModel) {
                            // Update job progress in database
                            await this.databaseJobManager.jobModel.updateJob(jobId, {
                                progress: {
                                    totalBusinesses: this.currentJobStats.totalBusinesses,
                                    savedBusinesses: this.currentJobStats.savedBusinesses,
                                    currentStep: 'processing_businesses'
                                }
                            });
                        }
                        foundCount++;
                    } catch (err) {
                        console.error('Error saving business (web):', err.message);
                        console.error('Error details:', {
                            businessName: businessData.name,
                            error: err.message,
                            stack: err.stack
                        });
                        this.currentJobStats.errors.push({
                            step: 'save_business_web',
                            phrase: phrase,
                            error: err.message,
                            timestamp: new Date().toISOString()
                        });
                        if (jobId && this.databaseJobManager && this.databaseJobManager.jobModel) {
                            // Update job with error in database
                            await this.databaseJobManager.jobModel.updateJob(jobId, {
                                statistics: {
                                    errors: this.currentJobStats.errors
                                }
                            });
                        }
                    }
                };

                // Use fast path unless emails are requested
                console.log(`🔍 Debug: wantEmail = ${wantEmail}, emailDeepPaths = ${emailDeepPaths}`);
                if (wantEmail) {
                    console.log(`📧 Email enrichment enabled for phrase: "${phrase}"`);
                    const onBizWithEnrich = async (biz) => {
                        console.log(`📧 Processing business for email enrichment: ${biz.name}`);
                        console.log(`📧 Business data:`, JSON.stringify(biz, null, 2));

                        // Check for pause/stop before email enrichment
                        if (this.isPaused && this.isPaused()) {
                            console.log('⏸️ Email enrichment paused by user request');
                            while (this.isPaused && this.isPaused()) {
                                await new Promise(resolve => setTimeout(resolve, 1000));
                            }
                            console.log('▶️ Email enrichment resumed by user request');
                        }

                        if (this.shouldStop && this.shouldStop()) {
                            console.log('⏹️ Email enrichment stopped by user request');
                            return;
                        }

                        let enriched = biz;
                        if (wantEmail) {
                            try {
                                console.log(`📧 Starting email enrichment for: ${biz.name}`);
                                enriched = await this.googleMapsWebService.enrichBusinessEmail(biz, { deepPaths: emailDeepPaths });
                                console.log(`📧 Email enrichment completed for: ${biz.name}`);
                            } catch (e) {
                                console.log(`📧 Email enrichment failed for: ${biz.name} - ${e.message}`);
                                // continue with original biz if enrichment fails
                            }
                        }
                        console.log(`📧 Calling onBusiness for: ${biz.name}`);
                        await onBusiness(enriched);
                    };
                    await this.googleMapsWebService.collectContactsFast(phrase, { maxResults, onBusiness: onBizWithEnrich, wantEmail });
                    // Removed success log to reduce console spam
                    // console.log(`Found and streamed ${foundCount} businesses for phrase (web-click, email-enrich): "${phrase}"`);
                } else {
                    // Use fast path with optional email enrichment
                    if (wantEmail) {
                        const onBizWithEnrich = async (biz) => {
                            // Check for pause/stop before email enrichment
                            if (this.isPaused && this.isPaused()) {
                                console.log('⏸️ Email enrichment paused by user request');
                                while (this.isPaused && this.isPaused()) {
                                    await new Promise(resolve => setTimeout(resolve, 1000));
                                }
                                console.log('▶️ Email enrichment resumed by user request');
                            }

                            if (this.shouldStop && this.shouldStop()) {
                                console.log('⏹️ Email enrichment stopped by user request');
                                return;
                            }

                            let enriched = biz;
                            if (wantEmail) {
                                try {
                                    enriched = await this.googleMapsWebService.enrichBusinessEmail(biz, { deepPaths: emailDeepPaths });
                                } catch (e) {
                                    // continue with original biz if enrichment fails
                                }
                            }
                            await onBusiness(enriched);
                        };
                        await this.googleMapsWebService.collectContactsFast(phrase, {
                            maxResults,
                            onBusiness: onBizWithEnrich,
                            wantEmail,
                            pageRange: this.currentJob?.pageRange
                        });
                    } else {
                        await this.googleMapsWebService.collectContactsFast(phrase, {
                            maxResults,
                            onBusiness,
                            pageRange: this.currentJob?.pageRange
                        });
                    }
                    // Removed success log to reduce console spam
                    // console.log(`Found and streamed ${foundCount} businesses for phrase (web-fast, no-email): "${phrase}"`);
                }
            } else {
                // API method (existing flow)
                // Step 6-9: Google Maps Text Search with pagination
                let placeIds = await this.searchGoogleMaps(phrase, jobId);

                // If no results found, try a simpler fallback phrase
                if (placeIds.length === 0) {
                    const fallbackPhrase = `${this.currentJob.keyword} ${this.currentJob.city}`;
                    console.log(`No businesses found for phrase: "${phrase}". Trying fallback: "${fallbackPhrase}"`);

                    placeIds = await this.searchGoogleMaps(fallbackPhrase, jobId);

                    if (placeIds.length === 0) {
                        console.log(`No businesses found for fallback phrase either: "${fallbackPhrase}"`);
                        this.currentJobStats.processedPhrases++;

                        // Update job progress in database
                        if (jobId && this.databaseJobManager && this.databaseJobManager.jobModel) {
                            await this.databaseJobManager.jobModel.updateJob(jobId, {
                                progress: {
                                    processedPhrases: this.currentJobStats.processedPhrases,
                                    totalPhrases: this.currentJobStats.totalPhrases,
                                    totalBusinesses: this.currentJobStats.totalBusinesses,
                                    savedBusinesses: this.currentJobStats.savedBusinesses,
                                    currentStep: 'processing_phrases'
                                }
                            });
                        }
                        return;
                    } else {
                        // Removed success log to reduce console spam
                        // console.log(`✅ Fallback phrase found ${placeIds.length} businesses: "${fallbackPhrase}"`);
                    }
                }

                // Removed success log to reduce console spam
                // console.log(`Found ${placeIds.length} businesses for phrase: "${phrase}"`);

                // Apply per-phrase cap if provided via scraper.maxResults (to align API with web behavior)
                const apiMax = Number.isInteger(options?.scraper?.maxResults) && options.scraper.maxResults > 0
                    ? options.scraper.maxResults
                    : null;
                if (apiMax) {
                    placeIds = placeIds.slice(0, apiMax);
                    console.log(`Applying per-phrase cap: processing first ${placeIds.length} place_ids (scraper.maxResults=${apiMax})`);
                }

                // Step 10-12: Process each place_id to get details and save (with concurrency)
                await this.processPlaceIdsConcurrent(placeIds, phrase, jobId);
            }

            this.currentJobStats.processedPhrases++;
            console.log(`Completed processing phrase: "${phrase}"`);

            // Update job progress in database
            if (jobId && this.databaseJobManager && this.databaseJobManager.jobModel) {
                await this.databaseJobManager.jobModel.updateJob(jobId, {
                    progress: {
                        processedPhrases: this.currentJobStats.processedPhrases,
                        totalPhrases: this.currentJobStats.totalPhrases,
                        totalBusinesses: this.currentJobStats.totalBusinesses,
                        savedBusinesses: this.currentJobStats.savedBusinesses,
                        currentStep: 'processing_phrases'
                    }
                });
            }

            // Force garbage collection every 10 phrases to manage memory
            if (index > 0 && index % 10 === 0) {
                this.performanceMonitor.forceGarbageCollection();
            }

        } catch (error) {
            console.error(`Error processing phrase "${phrase}":`, error.message);
            
            // Check if this is a browser dependency error - if so, fallback to API mode
            if (this.currentJob && this.currentJob.method === 'web' && this.googleMapsWebService && this.googleMapsWebService.isBrowserDependencyError(error)) {
                console.log(`🔄 Browser dependency error detected for phrase "${phrase}". Falling back to API mode...`);
                try {
                    // Fallback: Use API method instead
                    let placeIds = await this.searchGoogleMaps(phrase, jobId);
                    
                    if (placeIds.length === 0) {
                        const fallbackPhrase = `${this.currentJob.keyword} ${this.currentJob.city}`;
                        console.log(`No businesses found for phrase via API: "${phrase}". Trying fallback: "${fallbackPhrase}"`);
                        placeIds = await this.searchGoogleMaps(fallbackPhrase, jobId);
                    }
                    
                    if (placeIds.length > 0) {
                        console.log(`✅ API fallback found ${placeIds.length} businesses for phrase: "${phrase}"`);
                        // Apply per-phrase cap if provided
                        const apiMax = Number.isInteger(options?.scraper?.maxResults) && options.scraper.maxResults > 0
                            ? options.scraper.maxResults
                            : null;
                        if (apiMax) {
                            placeIds = placeIds.slice(0, apiMax);
                        }
                        // Process the results from API fallback
                        await this.processPlaceIdsConcurrent(placeIds, phrase, jobId);
                    } else {
                        console.log(`No businesses found via API fallback for phrase: "${phrase}"`);
                    }
                } catch (fallbackError) {
                    console.error(`API fallback also failed for phrase "${phrase}":`, fallbackError.message);
                    this.currentJobStats.errors.push({
                        step: 'process_phrase_api_fallback',
                        phrase: phrase,
                        error: fallbackError.message,
                        timestamp: new Date().toISOString()
                    });
                }
            } else {
                // Not a browser error, or not in web mode - just log and continue
                this.currentJobStats.errors.push({
                    step: 'process_phrase',
                    phrase: phrase,
                    error: error.message,
                    timestamp: new Date().toISOString()
                });
            }

            // Continue processing
            this.currentJobStats.processedPhrases++;

            // Update job progress in database
            if (jobId && this.databaseJobManager && this.databaseJobManager.jobModel) {
                await this.databaseJobManager.jobModel.updateJob(jobId, {
                    progress: {
                        processedPhrases: this.currentJobStats.processedPhrases,
                        totalPhrases: this.currentJobStats.totalPhrases,
                        totalBusinesses: this.currentJobStats.totalBusinesses,
                        savedBusinesses: this.currentJobStats.savedBusinesses,
                        currentStep: 'processing_phrases'
                    }
                });
            }
        }
    }

    /**
     * Search Google Maps for a phrase with automatic pagination
     * @param {string} phrase - Search phrase
     * @param {string} jobId - Job ID for progress tracking
     * @returns {Promise<string[]>} Array of place_ids
     */
    async searchGoogleMaps(phrase, jobId) {
        const startTime = Date.now();

        try {
            // Step 6-9: Call Google Maps Text Search API with pagination
            const paginationResult = await this.googleMapsService.searchWithPagination(phrase, 3);
            const duration = Date.now() - startTime;

            // Track Google Maps search performance and update rate limiter
            const success = !paginationResult.error;
            this.performanceMonitor.trackApiCall('googleMapsSearch', duration, success);

            if (success) {
                this.rateLimiter.reportSuccess();
            } else {
                this.rateLimiter.reportError();
            }

            if (paginationResult.error) {
                console.error(`❌ Google Maps search failed for phrase "${phrase}": ${paginationResult.error}`);
                console.error(`   Duration: ${duration}ms`);
                console.error(`   API Key configured: ${!!process.env.GOOGLE_MAPS_API_KEY}`);
                return [];
            }

            console.log(`✅ Google Maps search completed in ${duration}ms: ${paginationResult.totalResults} place_ids from ${paginationResult.pagesProcessed} pages`);

            if (paginationResult.totalResults === 0) {
                console.warn(`⚠️  No results found for phrase "${phrase}" - this might indicate:`);
                console.warn(`   - Search phrase is too specific`);
                console.warn(`   - No businesses exist for this search in the area`);
                console.warn(`   - API quota/billing issues`);
            }

            return paginationResult.place_ids;

        } catch (error) {
            const duration = Date.now() - startTime;

            // Track Google Maps search failure
            this.performanceMonitor.trackApiCall('googleMapsSearch', duration, false);

            console.error(`Error in Google Maps search for phrase "${phrase}":`, error.message);
            this.currentJobStats.errors.push({
                step: 'google_maps_search',
                phrase: phrase,
                error: error.message,
                timestamp: new Date().toISOString()
            });

            // Return empty array to continue processing
            return [];
        }
    }

    /**
     * Process place_ids with controlled concurrency for speed optimization
     * @param {string[]} placeIds - Array of place_ids to process
     * @param {string} searchPhrase - The search phrase used to find these places
     * @param {string} jobId - Job ID for progress tracking
     * @returns {Promise<number>} Number of businesses processed
     */
    async processPlaceIdsConcurrent(placeIds, searchPhrase, jobId) {
        console.log(`🏢 Starting concurrent place ID processing: ${placeIds.length} places for phrase "${searchPhrase}"`);

        const concurrencyLimit = 3; // Process 3 places concurrently
        const results = [];

        // Process in batches with controlled concurrency
        for (let i = 0; i < placeIds.length; i += concurrencyLimit) {
            // Check for stop/pause requests
            if (this.shouldStop && this.shouldStop()) break;
            while (this.isPaused && this.isPaused()) {
                await new Promise(resolve => setTimeout(resolve, 1000));
                if (this.shouldStop && this.shouldStop()) return results.length;
            }

            const batch = placeIds.slice(i, i + concurrencyLimit);
            console.log(`Processing batch ${Math.floor(i / concurrencyLimit) + 1}: ${batch.length} places`);

            // Process batch concurrently
            const batchPromises = batch.map(async (placeId, batchIndex) => {
                try {
                    const globalIndex = i + batchIndex;
                    console.log(`Processing place ${globalIndex + 1}/${placeIds.length}: ${placeId}`);

                    // Add small staggered delay to avoid hitting rate limits
                    if (batchIndex > 0) {
                        await new Promise(resolve => setTimeout(resolve, 200 * batchIndex));
                    }

                    // Step 10: Get place details
                    const startTime = Date.now();
                    const businessData = await this.googleMapsService.getPlaceDetails(placeId);
                    const duration = Date.now() - startTime;

                    // Track performance
                    const success = !!businessData.name;
                    this.performanceMonitor.trackApiCall('googlePlaceDetails', duration, success);

                    if (success) {
                        this.rateLimiter.reportSuccess();
                    } else {
                        this.rateLimiter.reportError();
                    }

                    if (!businessData.name) {
                        console.log(`No valid business data found for place_id: ${placeId}`);
                        return null;
                    }

                    // Add metadata
                    businessData.placeId = placeId;
                    businessData.searchPhrase = searchPhrase;

                    // Step 11: Save business data
                    const saveResults = await this.saveBusinessData(businessData, jobId);

                    this.currentJobStats.totalBusinesses++;

                    // Update save statistics
                    if (saveResults.postgresql.success) {
                        this.currentJobStats.savedBusinesses++;
                        // Removed success log to reduce console spam
                        // console.log(`✓ Business saved: ${businessData.name} (PostgreSQL: ${saveResults.postgresql.success ? '✓' : '✗'}, Sheets: ${saveResults.googleSheets.success ? '✓' : '✗'})`);
                    } else {
                        console.log(`✗ Business save failed: ${businessData.name} - both destinations failed`);
                    }

                    this.updateSaveStatistics(saveResults);

                    // Update job progress
                    if (jobId) {
                        // Update job progress in database
                        if (this.databaseJobManager && this.databaseJobManager.jobModel) {
                            await this.databaseJobManager.jobModel.updateJob(jobId, {
                                progress: {
                                    totalBusinesses: this.currentJobStats.totalBusinesses,
                                    savedBusinesses: this.currentJobStats.savedBusinesses,
                                    currentStep: 'processing_businesses'
                                }
                            });
                        }
                    }

                    return { placeId, businessData, saveResults };

                } catch (error) {
                    console.error(`Error processing place_id ${placeId}:`, error.message);
                    this.currentJobStats.errors.push({
                        step: 'process_place_id_concurrent',
                        placeId: placeId,
                        searchPhrase: searchPhrase,
                        error: error.message,
                        timestamp: new Date().toISOString()
                    });

                    return null;
                }
            });

            // Wait for batch to complete
            const batchResults = await Promise.all(batchPromises);
            results.push(...batchResults.filter(result => result !== null));

            // Small delay between batches to be respectful to APIs
            if (i + concurrencyLimit < placeIds.length) {
                await new Promise(resolve => setTimeout(resolve, 500));
            }
        }

        // Removed success log to reduce console spam
        // console.log(`✅ Concurrent place processing completed: ${results.length} businesses processed`);
        return results.length;
    }

    /**
     * Process place_ids using streaming for memory efficiency
     * @param {string[]} placeIds - Array of place_ids to process
     * @param {string} searchPhrase - The search phrase used to find these places
     * @param {string} jobId - Job ID for progress tracking
     * @returns {Promise<number>} Number of businesses processed
     */
    async processPlaceIdsStreaming(placeIds, searchPhrase, jobId) {
        console.log(`🏢 Starting streaming place ID processing: ${placeIds.length} places for phrase "${searchPhrase}"`);

        // Define the place details processor
        const detailsProcessor = async (placeId) => {
            const startTime = Date.now();

            try {
                const businessData = await this.googleMapsService.getPlaceDetails(placeId);
                const duration = Date.now() - startTime;

                // Track Google Place Details API performance
                const success = !!businessData.name;
                this.performanceMonitor.trackApiCall('googlePlaceDetails', duration, success);

                if (success) {
                    this.rateLimiter.reportSuccess();
                } else {
                    this.rateLimiter.reportError();
                }

                return businessData;
            } catch (error) {
                const duration = Date.now() - startTime;

                // Track Google Place Details API failure
                this.performanceMonitor.trackApiCall('googlePlaceDetails', duration, false);

                throw error;
            }
        };

        // Define the save processor
        const saveProcessor = async (businessData) => {
            // Add metadata to business data
            businessData.placeId = businessData.placeId || 'unknown';
            businessData.searchPhrase = searchPhrase;

            return await this.saveBusinessData(businessData, jobId);
        };

        // Define progress callback
        const onProgress = (progress) => {
            // Removed progress log to reduce console spam
            // console.log(`📊 Place Processing Progress: ${progress.processed}/${progress.total} (${progress.progress}%) - Errors: ${progress.errors}`);
        };

        try {
            // Use streaming processor for memory-efficient place processing
            const result = await this.streamingProcessor.processPlaceIdsStream(
                placeIds,
                detailsProcessor,
                saveProcessor,
                onProgress
            );

            // Removed success log to reduce console spam
            // console.log(`✅ Streaming place processing completed: ${result.processed}/${result.total} places processed`);

            return result.processed;

        } catch (error) {
            console.error(`Error in streaming place processing for phrase "${searchPhrase}":`, error.message);
            return 0;
        }
    }

    /**
     * Process place_ids to extract details and save data (legacy method for compatibility)
     * @param {string[]} placeIds - Array of place_ids to process
     * @param {string} searchPhrase - The search phrase used to find these places
     * @param {string} jobId - Job ID for progress tracking
     */
    async processPlaceIds(placeIds, searchPhrase, jobId) {
        for (let i = 0; i < placeIds.length; i++) {
            const placeId = placeIds[i];

            try {
                console.log(`Processing place ${i + 1}/${placeIds.length}: ${placeId}`);

                // Step 10: For each place_id → call Google Place Details API (with 2-second delay)
                const businessData = await this.googleMapsService.getPlaceDetails(placeId);

                if (!businessData.name) {
                    console.log(`No valid business data found for place_id: ${placeId}`);
                    continue;
                }

                // Add metadata to business data
                businessData.placeId = placeId;
                businessData.searchPhrase = searchPhrase;

                // Step 11: Extract contact info and save to PostgreSQL + Google Sheets immediately
                const saveResults = await this.saveBusinessData(businessData, jobId);

                this.currentJobStats.totalBusinesses++;

                // Update save statistics based on actual save results
                if (saveResults.postgresql.success) {
                    this.currentJobStats.savedBusinesses++;
                    // Removed success log to reduce console spam
                    // console.log(`✓ Business saved: ${businessData.name} (PostgreSQL: ${saveResults.postgresql.success ? '✓' : '✗'}, Sheets: ${saveResults.googleSheets.success ? '✓' : '✗'})`);
                } else {
                    console.log(`✗ Business save failed: ${businessData.name} - both destinations failed`);
                }

                // Update detailed save statistics
                this.updateSaveStatistics(saveResults);

                // Update job progress with business counts
                if (jobId) {
                    // Update job progress in database
                    if (this.databaseJobManager && this.databaseJobManager.jobModel) {
                        await this.databaseJobManager.jobModel.updateJob(jobId, {
                            progress: {
                                totalBusinesses: this.currentJobStats.totalBusinesses,
                                savedBusinesses: this.currentJobStats.savedBusinesses,
                                currentStep: 'processing_businesses'
                            }
                        });
                    }
                }

            } catch (error) {
                console.error(`Error processing place_id ${placeId}:`, error.message);
                this.currentJobStats.errors.push({
                    step: 'process_place_id',
                    placeId: placeId,
                    searchPhrase: searchPhrase,
                    error: error.message,
                    timestamp: new Date().toISOString()
                });

                // Continue with next place_id as per requirements
                continue;
            }
        }
    }

    /**
     * Save business data to both PostgreSQL and Google Sheets immediately
     * Implements streaming save pattern - save each business immediately after extraction
     * Continue processing even if individual saves fail
     * Requirements: 5.4, 5.5, 7.2
     * @param {Object} businessData - Business data to save
     * @param {string} jobId - Job ID for progress tracking
     */
    async saveBusinessData(businessData, jobId) {
        const saveResults = {
            postgresql: { success: false, error: null },
            googleSheets: { success: false, error: null }
        };

        // Removed success log to reduce console spam
        // console.log(`Saving business data immediately: ${businessData.name}`);
        // Removed debug log to reduce console spam
        // console.log(`[DEBUG] Business data details:`, {
        //     name: businessData.name,
        //     phone: businessData.phone,
        //     website: businessData.website,
        //     userEmail: businessData.userEmail,
        //     jobId: businessData.jobId,
        //     sheetId: businessData.sheetId,
        //     hasContact: !!businessData.contact,
        //     hasEmails: !!(businessData.contact && businessData.contact.emails && businessData.contact.emails.length > 0)
        // });

        try {
            // Save to PostgreSQL only (Google Sheets removed)
            const pgResult = await Promise.allSettled([this.saveToPostgreSQL(businessData)]);

            if (pgResult[0].status === 'fulfilled') {
                saveResults.postgresql.success = true;
            } else {
                saveResults.postgresql.error = pgResult[0].reason.message;
                console.error(`✗ PostgreSQL: Failed to save ${businessData.name} - ${pgResult[0].reason.message}`);
                this.currentJobStats.errors.push({
                    step: 'save_postgresql',
                    businessName: businessData.name,
                    placeId: businessData.placeId,
                    error: pgResult[0].reason.message,
                    timestamp: new Date().toISOString()
                });
            }

            // Always return success to continue processing - individual save failures don't stop the pipeline
            return saveResults;

        } catch (error) {
            // This catch block handles unexpected errors in the save coordination logic
            console.error(`Unexpected error in saveBusinessData for ${businessData.name}:`, error.message);
            this.currentJobStats.errors.push({
                step: 'save_business_data_coordination',
                businessName: businessData.name,
                placeId: businessData.placeId,
                error: error.message,
                timestamp: new Date().toISOString()
            });

            // Continue processing even if save coordination fails
            return saveResults;
        }
    }

    /**
     * Save business data to PostgreSQL with error handling
     * @param {Object} businessData - Business data to save
     * @returns {Promise<Object>} Save result
     */
    async saveToPostgreSQL(businessData) {
        try {
            // Use the multi-tenant UserGoogleSheet model for proper user isolation
            const UserGoogleSheet = require('../models/UserGoogleSheet');
            const userGoogleSheet = new UserGoogleSheet(this.databaseService);

            // Extract user email from business data or use default
            const userEmail = businessData.userEmail || 'default@example.com';
            const jobId = businessData.jobId || null;
            const sheetId = businessData.sheetId || null;

            // Removed debug log to reduce console spam
            // console.log(`[DEBUG] Saving to PostgreSQL:`, {
            //     businessName: businessData.name,
            //     userEmail,
            //     jobId,
            //     sheetId,
            //     hasName: !!businessData.name,
            //     hasPhone: !!businessData.phone,
            //     hasWebsite: !!businessData.website
            // });

            const result = await userGoogleSheet.saveBusinessData(userEmail, businessData, jobId, sheetId);

            // Removed success log to reduce console spam
            // console.log(`[DEBUG] PostgreSQL save successful:`, {
            //     businessName: businessData.name,
            //     recordId: result.id,
            //     userEmail
            // });

            return {
                success: true,
                result: result,
                destination: 'postgresql'
            };
        } catch (error) {
            // Log detailed error for PostgreSQL save failure
            console.error(`PostgreSQL save failed for ${businessData.name}:`, {
                error: error.message,
                stack: error.stack,
                placeId: businessData.placeId,
                businessName: businessData.name,
                userEmail: businessData.userEmail
            });
            throw error;
        }
    }

    /**
     * Save business data to Google Sheets with batching for better performance
     * @param {Object} businessData - Business data to save
     * @returns {Object} lightweight enqueue result
     */
    async saveToGoogleSheets(businessData) {
        // Google Sheets integration removed
        return { skipped: true };
    }

    /**
     * Process the current batch of Google Sheets saves
     */
    async processBatch() {
        // Google Sheets batch processing removed
        this.sheetsBatchQueue = [];
    }

    /**
     * Force process any remaining items in the batch queue
     */
    async flushBatchQueue() {
        // Google Sheets flush removed
        this.sheetsBatchQueue = [];
    }

    /**
     * Pause the current job
     * @returns {Object} Pause result
     */
    async pauseJob() {
        if (!this.isProcessing) {
            return { success: false, message: 'No job is currently running' };
        }

        if (this.isPaused) {
            return { success: false, message: 'Job is already paused' };
        }

        this.isPaused = true;
        console.log('⏸️  Job paused by user request');

        if (this.currentJob) {
            if (this.databaseJobManager && this.databaseJobManager.jobModel) {
                await this.databaseJobManager.jobModel.updateJob(this.currentJob.jobId, {
                    status: 'paused',
                    progress: { currentStep: 'paused' }
                });
            }
        }

        return { success: true, message: 'Job paused successfully' };
    }

    /**
     * Resume the current job
     * @returns {Object} Resume result
     */
    async resumeJob() {
        if (!this.isProcessing) {
            return { success: false, message: 'No job is currently running' };
        }

        if (!this.isPaused) {
            return { success: false, message: 'Job is not paused' };
        }

        this.isPaused = false;
        console.log('▶️  Job resumed by user request');

        if (this.currentJob) {
            if (this.databaseJobManager && this.databaseJobManager.jobModel) {
                await this.databaseJobManager.jobModel.updateJob(this.currentJob.jobId, {
                    status: 'started',
                    progress: { currentStep: 'processing_phrases' }
                });
            }
        }

        return { success: true, message: 'Job resumed successfully' };
    }

    /**
     * Stop the current job
     * @returns {Object} Stop result
     */
    async stopJob() {
        if (!this.isProcessing) {
            return { success: false, message: 'No job is currently running' };
        }

        this.shouldStop = true;
        this.isPaused = false;
        console.log('⏹️  Job stop requested by user');

        if (this.currentJob) {
            if (this.databaseJobManager && this.databaseJobManager.jobModel) {
                await this.databaseJobManager.jobModel.updateJob(this.currentJob.jobId, {
                    status: 'stopped',
                    progress: { currentStep: 'stopping' }
                });
            }
        }

        return { success: true, message: 'Job stop requested - will stop after current operation' };
    }

    /**
     * Calculate estimated completion time
     * @returns {Object} Time estimates
     */
    getTimeEstimates() {
        if (!this.isProcessing || !this.currentJob) {
            return { estimatedTimeRemaining: 0, estimatedCompletionTime: null };
        }

        const elapsed = Date.now() - this.currentJob.startTime.getTime();
        const phrasesProcessed = this.currentJobStats.processedPhrases || 0;
        const totalPhrases = this.currentJobStats.totalPhrases || 0;

        if (phrasesProcessed === 0) {
            return { estimatedTimeRemaining: 0, estimatedCompletionTime: null };
        }

        // Calculate average time per phrase
        const avgTimePerPhrase = elapsed / phrasesProcessed;
        const remainingPhrases = totalPhrases - phrasesProcessed;
        const estimatedTimeRemaining = remainingPhrases * avgTimePerPhrase;
        const estimatedCompletionTime = new Date(Date.now() + estimatedTimeRemaining);

        return {
            estimatedTimeRemaining: Math.round(estimatedTimeRemaining / 1000), // in seconds
            estimatedCompletionTime: estimatedCompletionTime.toISOString(),
            avgTimePerPhrase: Math.round(avgTimePerPhrase / 1000), // in seconds
            phrasesPerMinute: Math.round(60000 / avgTimePerPhrase * 100) / 100
        };
    }

    /**
     * Get current processing status and statistics
     * @returns {Object} Current processing status
     */
    getProcessingStatus() {
        const timeEstimates = this.getTimeEstimates();

        return {
            isProcessing: this.isProcessing,
            isPaused: this.isPaused,
            shouldStop: this.shouldStop,
            currentJob: this.currentJob,
            stats: { ...this.currentJobStats },
            timeEstimates,
            progress: {
                phrasesProgress: this.currentJobStats.totalPhrases > 0 ?
                    Math.round((this.currentJobStats.processedPhrases / this.currentJobStats.totalPhrases) * 100) : 0,
                businessesFound: this.currentJobStats.totalBusinesses,
                businessesSaved: this.currentJobStats.savedBusinesses,
                errorCount: this.currentJobStats.errors.length
            }
        };
    }

    /**
     * Get JobManager instance for external access
     * @returns {JobManager} JobManager instance
     */
    getJobManager() {
        return this.databaseJobManager;
    }

    /**
     * Get final processing results
     * @returns {Object} Processing results and statistics
     */
    getProcessingResults() {
        return {
            success: true,
            summary: {
                totalPhrasesProcessed: this.currentJobStats.processedPhrases || 0,
                totalPhrasesGenerated: this.currentJobStats.totalPhrases || 0,
                totalBusinessesFound: this.currentJobStats.totalBusinesses || 0,
                totalBusinessesSaved: this.currentJobStats.savedBusinesses || 0,
                totalErrors: this.currentJobStats.errors.length || 0,
                saveEfficiency: {
                    postgresqlSuccessRate: this.currentJobStats.totalBusinesses > 0 ?
                        Math.round((this.currentJobStats.saveStats?.postgresql?.success / this.currentJobStats.totalBusinesses) * 100) : 0,
                    bothDestinationsRate: this.currentJobStats.totalBusinesses > 0 ?
                        Math.round((this.currentJobStats.saveStats?.bothSucceeded / this.currentJobStats.totalBusinesses) * 100) : 0
                }
            },
            saveStatistics: this.currentJobStats.saveStats || {},
            stats: { ...this.currentJobStats },
            completedAt: new Date().toISOString()
        };
    }

    /**
     * Update save statistics based on individual save results
     * @param {Object} saveResults - Results from saveBusinessData
     */
    updateSaveStatistics(saveResults) {
        // Initialize saveStats if not exists
        if (!this.currentJobStats.saveStats) {
            this.currentJobStats.saveStats = {
                postgresql: { success: 0, failed: 0 },
                googleSheets: { success: 0, failed: 0 },
                bothSucceeded: 0,
                bothFailed: 0,
                partialSuccess: 0
            };
        }

        // Update individual destination statistics
        if (saveResults.postgresql.success) {
            this.currentJobStats.saveStats.postgresql.success++;
        } else {
            this.currentJobStats.saveStats.postgresql.failed++;
        }

        // Update combined statistics
        if (saveResults.postgresql.success) {
            this.currentJobStats.saveStats.bothSucceeded++;
        } else if (!saveResults.postgresql.success) {
            this.currentJobStats.saveStats.bothFailed++;
        } else {
            this.currentJobStats.saveStats.partialSuccess++;
        }
    }

    /**
     * Reset processing statistics
     */
    resetStats() {
        this.currentJobStats = {
            totalPhrases: 0,
            processedPhrases: 0,
            totalBusinesses: 0,
            savedBusinesses: 0,
            saveStats: {
                postgresql: { success: 0, failed: 0 },
                googleSheets: { success: 0, failed: 0 },
                bothSucceeded: 0,
                bothFailed: 0,
                partialSuccess: 0
            },
            errors: []
        };
    }

    /**
     * Initialize all services and test connections
     * @returns {Promise<boolean>} True if all services are ready
     */
    async initialize() {
        console.log('Initializing ProcessingService...');

        try {
            // Test database connection
            console.log('Testing database connection...');
            await this.databaseService.testConnection();

            // Test Google Sheets connection
            console.log('Testing Google Sheets connection...');

            // Test Google Maps API with a simple query
            console.log('Testing Google Maps API...');
            const testResult = await this.googleMapsService.textSearch('restaurant delhi');
            if (testResult.status === 'OK' && testResult.place_ids.length > 0) {
                // Removed success log to reduce console spam
                // console.log(`✅ Google Maps API test successful: ${testResult.place_ids.length} results`);
            } else {
                console.warn(`⚠️  Google Maps API test returned: ${testResult.status} with ${testResult.place_ids.length} results`);
            }

            // Test Gemini API with a simple query
            console.log('Testing Gemini AI API...');
            const testPhrases = await this.geminiService.generateSearchPhrases('delhi', 'restaurant');
            if (testPhrases && testPhrases.length > 0) {
                // Removed success log to reduce console spam
                // console.log(`✅ Gemini AI test successful: ${testPhrases.length} phrases generated`);
            } else {
                console.warn('⚠️  Gemini AI test failed or returned no phrases');
            }

            // Removed success log to reduce console spam
            // console.log('ProcessingService initialized successfully');
            return true;

        } catch (error) {
            console.error('Failed to initialize ProcessingService:', error.message);
            throw error;
        }
    }

    /**
     * Get current performance metrics
     * @returns {Object} Performance metrics and statistics
     */
    getPerformanceMetrics() {
        return this.performanceMonitor.getMetrics();
    }

    /**
     * Get streaming processor status
     * @returns {Object} Streaming processor status
     */
    getStreamingStatus() {
        return this.streamingProcessor.getStatus();
    }

    /**
     * Force garbage collection for memory optimization
     */
    forceGarbageCollection() {
        this.performanceMonitor.forceGarbageCollection();
    }

    /**
     * Cleanup resources
     */
    async cleanup() {
        try {
            // Cleanup performance monitor
            this.performanceMonitor.cleanup();

            // Close database connection
            await this.databaseService.close();

            console.log('ProcessingService cleanup completed');
        } catch (error) {
            console.error('Error during ProcessingService cleanup:', error.message);
        }
    }
}

module.exports = ProcessingService;