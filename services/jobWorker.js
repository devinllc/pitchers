const { Worker, isMainThread, parentPort, workerData } = require('worker_threads');
const path = require('path');
const ConcurrencyConfig = require('./concurrencyConfig');

/**
 * Background Job Worker Thread
 * Handles job processing in isolated worker threads to prevent blocking the main thread
 * and enable concurrent job processing with resource-aware concurrency limits
 */
class JobWorker {
    constructor() {
        this.workerPath = path.join(__dirname, 'jobWorkerThread.js');
        this.activeWorkers = new Map();
        
        // Initialize concurrency configuration
        this.concurrencyConfig = new ConcurrencyConfig();
        this.maxConcurrentJobs = this.concurrencyConfig.maxConcurrentJobs;
        
        console.log(`[WORKER] Worker path: ${this.workerPath}`);
        console.log(`[WORKER] Max concurrent jobs: ${this.maxConcurrentJobs}`);
    }

    /**
     * Process a job in a background worker thread
     * @param {Object} jobData - Job data including jobId, city, keyword, userEmail, etc.
     * @returns {Promise<Object>} Job processing result
     */
    async processJob(jobData) {
        // Check if we can start a new job based on system resources
        if (!this.concurrencyConfig.canStartNewJob()) {
            throw new Error('System resources insufficient to start new job');
        }

        // Check if we've reached the concurrent job limit
        if (this.activeWorkers.size >= this.maxConcurrentJobs) {
            throw new Error(`Maximum concurrent jobs limit reached (${this.maxConcurrentJobs})`);
        }

        console.log(`[WORKER] Creating worker for job: ${jobData.jobId}`);
        console.log(`[WORKER] Worker path exists:`, require('fs').existsSync(this.workerPath));
        console.log(`[WORKER] Active workers: ${this.activeWorkers.size}/${this.maxConcurrentJobs}`);
        
        return new Promise((resolve, reject) => {
            const worker = new Worker(this.workerPath, {
                workerData: {
                    jobData,
                    timestamp: Date.now(),
                    concurrencyConfig: this.concurrencyConfig.getRecommendedSettings()
                }
            });

            console.log(`[WORKER] Worker created for job: ${jobData.jobId}`);

            const workerId = `${jobData.jobId}_${Date.now()}`;
            this.activeWorkers.set(workerId, worker);

            // Set up worker event handlers
            worker.on('message', (result) => {
                console.log(`[WORKER] Job ${jobData.jobId} completed:`, {
                    status: result.status,
                    businessesFound: result.businessesFound,
                    businessesSaved: result.businessesSaved,
                    duration: result.duration
                });
                
                this.activeWorkers.delete(workerId);
                resolve(result);
            });

            worker.on('error', (error) => {
                console.error(`[WORKER] Job ${jobData.jobId} failed:`, error);
                this.activeWorkers.delete(workerId);
                reject(error);
            });

            worker.on('exit', (code) => {
                if (code !== 0) {
                    console.error(`[WORKER] Job ${jobData.jobId} exited with code ${code}`);
                    this.activeWorkers.delete(workerId);
                    reject(new Error(`Worker exited with code ${code}`));
                }
            });

            // Use configurable timeout
            const timeoutMs = this.concurrencyConfig.timeoutMinutes * 60 * 1000;
            setTimeout(() => {
                if (this.activeWorkers.has(workerId)) {
                    console.error(`[WORKER] Job ${jobData.jobId} timed out after ${this.concurrencyConfig.timeoutMinutes} minutes`);
                    worker.terminate();
                    this.activeWorkers.delete(workerId);
                    reject(new Error(`Job processing timed out after ${this.concurrencyConfig.timeoutMinutes} minutes`));
                }
            }, timeoutMs);
        });
    }

    /**
     * Process multiple jobs concurrently
     * @param {Array} jobsData - Array of job data objects
     * @returns {Promise<Array>} Array of job processing results
     */
    async processJobsConcurrently(jobsData) {
        const results = [];
        const chunks = this.chunkArray(jobsData, this.maxConcurrentJobs);

        for (const chunk of chunks) {
            const chunkPromises = chunk.map(jobData => this.processJob(jobData));
            const chunkResults = await Promise.allSettled(chunkPromises);
            
            results.push(...chunkResults.map(result => 
                result.status === 'fulfilled' ? result.value : { error: result.reason.message }
            ));
        }

        return results;
    }

    /**
     * Get active worker count
     * @returns {number} Number of active workers
     */
    getActiveWorkerCount() {
        return this.activeWorkers.size;
    }

    /**
     * Terminate all active workers
     */
    async terminateAllWorkers() {
        const terminatePromises = Array.from(this.activeWorkers.values()).map(worker => 
            worker.terminate()
        );
        
        await Promise.all(terminatePromises);
        this.activeWorkers.clear();
        console.log('[WORKER] All workers terminated');
    }

    /**
     * Utility: Split array into chunks
     * @param {Array} array - Array to chunk
     * @param {number} chunkSize - Size of each chunk
     * @returns {Array} Array of chunks
     */
    chunkArray(array, chunkSize) {
        const chunks = [];
        for (let i = 0; i < array.length; i += chunkSize) {
            chunks.push(array.slice(i, i + chunkSize));
        }
        return chunks;
    }
}

module.exports = JobWorker;
