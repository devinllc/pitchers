/**
 * Simple Concurrency Configuration
 * Only configures MAX_CONCURRENT_JOBS via environment variables
 * All other settings use defaults or client-provided values
 */

class ConcurrencyConfig {
    constructor() {
        this.configureConcurrency();
    }

    /**
     * Configure concurrency settings from environment variables only
     */
    configureConcurrency() {
        // Configure MAX_CONCURRENT_JOBS from environment or default to 2 (optimized for 2-core VPS)
        this.maxConcurrentJobs = parseInt(process.env.MAX_CONCURRENT_JOBS) || 2;
        
        // Job timeout from environment (optional)
        this.timeoutMinutes = parseInt(process.env.JOB_TIMEOUT_MINUTES) || 30;

        // Additional production settings
        this.enableMemoryMonitoring = process.env.ENABLE_MEMORY_MONITORING !== 'false'; // Default enabled
        this.gracefulShutdownTimeout = parseInt(process.env.GRACEFUL_SHUTDOWN_TIMEOUT) || 30;
        this.jobCleanupInterval = parseInt(process.env.JOB_CLEANUP_INTERVAL) || 3600; // 1 hour

        console.log(`[CONCURRENCY_CONFIG] Simple Configuration:`);
        console.log(`  - Max Concurrent Jobs: ${this.maxConcurrentJobs} (from env)`);
        console.log(`  - Job Timeout: ${this.timeoutMinutes} minutes (from env)`);
        console.log(`  - Memory Monitoring: ${this.enableMemoryMonitoring} (default enabled)`);
        console.log(`  - Max Results Per Job: Set by client (no limit)`);
        console.log(`  - Batch Size: Default Node.js behavior`);
        console.log(`  - Worker Memory: Default Node.js behavior`);
    }

    /**
     * Check if system can handle more concurrent jobs
     * Simple check - always allow new jobs
     */
    canStartNewJob() {
        // Always allow new jobs - let the server handle resource management
        return true;
    }

    /**
     * Get recommended settings for current environment
     */
    getRecommendedSettings() {
        return {
            maxConcurrentJobs: this.maxConcurrentJobs,
            timeoutMinutes: this.timeoutMinutes,
            enableMemoryMonitoring: this.enableMemoryMonitoring
        };
    }
}

module.exports = ConcurrencyConfig;
