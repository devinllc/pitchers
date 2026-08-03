const { isMainThread, parentPort, workerData } = require('worker_threads');
const ProcessingService = require('./processingService');
const DatabaseService = require('./database');
const Job = require('../models/Job');

/**
 * Job Worker Thread Implementation
 * This runs in a separate worker thread to process jobs without blocking the main thread
 */
if (!isMainThread) {
    console.log(`[WORKER_THREAD] Starting worker thread with jobData:`, workerData);
    
    // Handle messages from main thread (pause/resume/stop)
    let terminationRequested = false;
    let isPaused = false;
    
    parentPort.on('message', (message) => {
        console.log(`[WORKER_THREAD] Received message:`, message);
        
        switch (message.type) {
            case 'pause':
                isPaused = true;
                console.log(`[WORKER_THREAD] Job paused by user request`);
                break;
            case 'resume':
                isPaused = false;
                console.log(`[WORKER_THREAD] Job resumed by user request`);
                break;
            case 'stop':
                terminationRequested = true;
                console.log(`[WORKER_THREAD] Job stop requested by user`);
                break;
        }
    });
    
    (async () => {
        const { jobData } = workerData;
        const startTime = Date.now();
        
        try {
            console.log(`[WORKER_THREAD] Starting job processing: ${jobData.jobId}`);
            console.log(`[WORKER_THREAD] Job data:`, jobData);
            
            // Initialize services in worker thread
            const databaseService = new DatabaseService();
            const jobModel = new Job(databaseService);
            
            // Create ProcessingService and ensure it has access to job model for progress tracking
            const processingService = new ProcessingService();
            
            // Override the databaseJobManager's jobModel to use our local instance
            // This ensures progress updates work in the worker thread
            processingService.databaseJobManager.jobModel = jobModel;
            
            // Set up termination and pause handling
            processingService.terminationRequested = () => terminationRequested;
            processingService.isPaused = () => isPaused;
            processingService.shouldStop = () => terminationRequested;
            
            // Debug: Log the jobData to see what parameters are being passed
            console.log(`🔍 Worker Thread Debug: jobData =`, JSON.stringify(jobData, null, 2));
            
            // Update job status to processing
            await jobModel.updateJob(jobData.jobId, {
                status: 'processing',
                progress: {
                    totalPhrases: 0,
                    processedPhrases: 0,
                    totalBusinesses: 0,
                    savedBusinesses: 0,
                    currentStep: 'initializing'
                }
            });

            // Process the job using the processing service
            const result = await processingService.processLeadGeneration(
                jobData.city, 
                jobData.keyword, 
                {
                    userEmail: jobData.userEmail,
                    method: jobData.method || 'web',
                    targetSheetId: jobData.targetSheetId,
                    maxResults: jobData.maxResults || 50,
                    wantEmail: jobData.wantEmail || false,
                    emailDeepPaths: jobData.emailDeepPaths || false,
                    jobId: jobData.jobId, // Pass jobId for progress tracking
                    // Pass the flexible parameters
                    targetDataCount: jobData.targetDataCount || null,
                    maxPhrases: jobData.maxPhrases || null,
                    pageRange: jobData.pageRange || null
                }
            );
            
            const duration = Date.now() - startTime;
            
            // Update job status to completed
            await jobModel.updateJob(jobData.jobId, {
                status: 'completed',
                progress: {
                    totalPhrases: result.summary?.totalPhrasesGenerated || 0,
                    processedPhrases: result.summary?.totalPhrasesProcessed || 0,
                    totalBusinesses: result.summary?.totalBusinessesFound || 0,
                    savedBusinesses: result.summary?.totalBusinessesSaved || 0,
                    currentStep: 'completed'
                },
                statistics: result.saveStatistics || {},
                end_time: new Date()
            });

            // Removed success log to reduce console spam
            // console.log(`[WORKER] Job ${jobData.jobId} completed successfully in ${duration}ms`);
            
            // Send result back to main thread
            parentPort.postMessage({
                status: 'completed',
                jobId: jobData.jobId,
                businessesFound: result.summary?.totalBusinessesFound || 0,
                businessesSaved: result.summary?.totalBusinessesSaved || 0,
                duration,
                statistics: result.saveStatistics || {}
            });

        } catch (error) {
            console.error(`[WORKER_THREAD] Job processing error:`, error);
            
            try {
                const databaseService = new DatabaseService();
                const jobModel = new Job(databaseService);

                const isStopped = Boolean(terminationRequested) || error.message?.toLowerCase().includes('stop') || error.message?.toLowerCase().includes('cancel');
                const hasSavedLeads = (processingService.currentJobStats?.savedBusinesses || 0) > 0;
                const finalStatus = isStopped ? 'stopped' : (hasSavedLeads ? 'completed' : 'failed');
                
                await jobModel.updateJob(jobData.jobId, {
                    status: finalStatus,
                    error_message: isStopped ? 'Job stopped by user' : (hasSavedLeads ? null : error.message),
                    progress: {
                        totalPhrases: processingService.currentJobStats?.totalPhrases || 0,
                        processedPhrases: processingService.currentJobStats?.processedPhrases || 0,
                        totalBusinesses: processingService.currentJobStats?.totalBusinesses || 0,
                        savedBusinesses: processingService.currentJobStats?.savedBusinesses || 0,
                        currentStep: finalStatus
                    },
                    end_time: new Date()
                });
            } catch (updateError) {
                console.error(`[WORKER_THREAD] Failed to update job status:`, updateError);
            }
            
            // Send error back to main thread
            parentPort.postMessage({
                status: 'failed',
                jobId: jobData.jobId,
                error: error.message,
                duration: Date.now() - workerData.timestamp
            });
        }
    })();
}
