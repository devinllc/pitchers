/**
 * PerformanceMonitor - Monitors and logs performance metrics and statistics
 * Requirements: 7.4, 6.2
 */
class PerformanceMonitor {
    constructor() {
        this.metrics = {
            apiCalls: {
                gemini: { count: 0, totalTime: 0, errors: 0, avgResponseTime: 0 },
                googleMapsSearch: { count: 0, totalTime: 0, errors: 0, avgResponseTime: 0 },
                googlePlaceDetails: { count: 0, totalTime: 0, errors: 0, avgResponseTime: 0 },
                googleSheets: { count: 0, totalTime: 0, errors: 0, avgResponseTime: 0 }
            },
            processing: {
                jobsStarted: 0,
                jobsCompleted: 0,
                jobsFailed: 0,
                totalProcessingTime: 0,
                avgJobDuration: 0,
                phrasesProcessed: 0,
                businessesFound: 0,
                businessesSaved: 0,
                saveSuccessRate: 0
            },
            memory: {
                peakUsage: 0,
                currentUsage: 0,
                gcCount: 0,
                lastGcTime: null
            },
            system: {
                startTime: Date.now(),
                uptime: 0,
                cpuUsage: 0
            }
        };

        // Start memory monitoring
        this.startMemoryMonitoring();

        // Disabled performance summary logging to reduce console spam
        // this.performanceSummaryInterval = setInterval(() => {
        //     this.logPerformanceSummary();
        // }, 5 * 60 * 1000);
    }

    /**
     * Track API call performance
     * @param {string} apiName - Name of the API (gemini, googleMapsSearch, googlePlaceDetails, googleSheets)
     * @param {number} duration - Duration in milliseconds
     * @param {boolean} success - Whether the call was successful
     */
    trackApiCall(apiName, duration, success = true) {
        const api = this.metrics.apiCalls[apiName];
        if (!api) {
            console.warn(`Unknown API name: ${apiName}`);
            return;
        }

        api.count++;
        api.totalTime += duration;

        if (!success) {
            api.errors++;
        }

        // Calculate average response time
        api.avgResponseTime = Math.round(api.totalTime / api.count);

        // Log slow API calls (over 5 seconds)
        if (duration > 5000) {
            console.warn(`🐌 SLOW API CALL: ${apiName} took ${duration}ms`);
        }

        // Log performance metrics for this call
        console.log(`📊 API Performance: ${apiName} - ${duration}ms (avg: ${api.avgResponseTime}ms, total calls: ${api.count})`);
    }

    /**
     * Track job processing metrics
     * @param {string} event - Event type (started, completed, failed)
     * @param {Object} data - Additional data about the job
     */
    trackJobEvent(event, data = {}) {
        const processing = this.metrics.processing;

        switch (event) {
            case 'started':
                processing.jobsStarted++;
                break;

            case 'completed':
                processing.jobsCompleted++;
                if (data.duration) {
                    processing.totalProcessingTime += data.duration;
                    processing.avgJobDuration = Math.round(processing.totalProcessingTime / processing.jobsCompleted);
                }
                if (data.phrasesProcessed) processing.phrasesProcessed += data.phrasesProcessed;
                if (data.businessesFound) processing.businessesFound += data.businessesFound;
                if (data.businessesSaved) processing.businessesSaved += data.businessesSaved;

                // Calculate save success rate
                if (processing.businessesFound > 0) {
                    processing.saveSuccessRate = Math.round((processing.businessesSaved / processing.businessesFound) * 100);
                }
                break;

            case 'failed':
                processing.jobsFailed++;
                break;
        }

        // Log job completion rate
        const totalJobs = processing.jobsStarted;
        const completionRate = totalJobs > 0 ? Math.round((processing.jobsCompleted / totalJobs) * 100) : 0;

        console.log(`📈 Job Metrics: ${event} - Completion Rate: ${completionRate}% (${processing.jobsCompleted}/${totalJobs})`);
    }

    /**
     * Start monitoring memory usage
     */
    startMemoryMonitoring() {
        // Monitor memory every 30 seconds
        setInterval(() => {
            const memUsage = process.memoryUsage();
            this.metrics.memory.currentUsage = memUsage.heapUsed;

            // Track peak memory usage
            if (memUsage.heapUsed > this.metrics.memory.peakUsage) {
                this.metrics.memory.peakUsage = memUsage.heapUsed;
            }

            // Log memory usage if it's high (over 100MB)
            const memoryMB = Math.round(memUsage.heapUsed / 1024 / 1024);
            if (memoryMB > 100) {
                console.warn(`🧠 HIGH MEMORY USAGE: ${memoryMB}MB (Peak: ${Math.round(this.metrics.memory.peakUsage / 1024 / 1024)}MB)`);
            }

            // Update system metrics
            this.metrics.system.uptime = Date.now() - this.metrics.system.startTime;
        }, 30000);
    }

    /**
     * Force garbage collection and track it
     */
    forceGarbageCollection() {
        if (global.gc) {
            const beforeGC = process.memoryUsage().heapUsed;
            global.gc();
            const afterGC = process.memoryUsage().heapUsed;
            const freed = beforeGC - afterGC;

            this.metrics.memory.gcCount++;
            this.metrics.memory.lastGcTime = Date.now();

            console.log(`🗑️  GARBAGE COLLECTION: Freed ${Math.round(freed / 1024 / 1024)}MB (${this.metrics.memory.gcCount} total GCs)`);
        }
    }

    /**
     * Get current performance metrics
     * @returns {Object} Current performance metrics
     */
    getMetrics() {
        // Update uptime
        this.metrics.system.uptime = Date.now() - this.metrics.system.startTime;

        return {
            ...this.metrics,
            timestamp: new Date().toISOString(),
            memoryUsageMB: {
                current: Math.round(this.metrics.memory.currentUsage / 1024 / 1024),
                peak: Math.round(this.metrics.memory.peakUsage / 1024 / 1024)
            },
            uptimeHours: Math.round(this.metrics.system.uptime / 1000 / 60 / 60 * 100) / 100
        };
    }

    /**
     * Log comprehensive performance summary
     */
    logPerformanceSummary() {
        const metrics = this.getMetrics();

        console.log('\n📊 ===== PERFORMANCE SUMMARY =====');
        console.log(`⏱️  System Uptime: ${metrics.uptimeHours} hours`);
        console.log(`🧠 Memory Usage: ${metrics.memoryUsageMB.current}MB (Peak: ${metrics.memoryUsageMB.peak}MB)`);

        console.log('\n🔗 API Performance:');
        Object.entries(metrics.apiCalls).forEach(([api, stats]) => {
            if (stats.count > 0) {
                const errorRate = Math.round((stats.errors / stats.count) * 100);
                console.log(`  ${api}: ${stats.count} calls, ${stats.avgResponseTime}ms avg, ${errorRate}% errors`);
            }
        });

        console.log('\n📈 Processing Statistics:');
        const completionRate = metrics.processing.jobsStarted > 0 ?
            Math.round((metrics.processing.jobsCompleted / metrics.processing.jobsStarted) * 100) : 0;

        console.log(`  Jobs: ${metrics.processing.jobsCompleted}/${metrics.processing.jobsStarted} completed (${completionRate}%)`);
        console.log(`  Avg Job Duration: ${Math.round(metrics.processing.avgJobDuration / 1000)}s`);
        console.log(`  Phrases Processed: ${metrics.processing.phrasesProcessed}`);
        console.log(`  Businesses Found: ${metrics.processing.businessesFound}`);
        console.log(`  Businesses Saved: ${metrics.processing.businessesSaved} (${metrics.processing.saveSuccessRate}% success rate)`);

        if (metrics.memory.gcCount > 0) {
            console.log(`\n🗑️  Garbage Collections: ${metrics.memory.gcCount}`);
        }

        console.log('================================\n');
    }

    /**
     * Reset all metrics (useful for testing)
     */
    resetMetrics() {
        this.metrics = {
            apiCalls: {
                gemini: { count: 0, totalTime: 0, errors: 0, avgResponseTime: 0 },
                googleMapsSearch: { count: 0, totalTime: 0, errors: 0, avgResponseTime: 0 },
                googlePlaceDetails: { count: 0, totalTime: 0, errors: 0, avgResponseTime: 0 },
                googleSheets: { count: 0, totalTime: 0, errors: 0, avgResponseTime: 0 }
            },
            processing: {
                jobsStarted: 0,
                jobsCompleted: 0,
                jobsFailed: 0,
                totalProcessingTime: 0,
                avgJobDuration: 0,
                phrasesProcessed: 0,
                businessesFound: 0,
                businessesSaved: 0,
                saveSuccessRate: 0
            },
            memory: {
                peakUsage: 0,
                currentUsage: 0,
                gcCount: 0,
                lastGcTime: null
            },
            system: {
                startTime: Date.now(),
                uptime: 0,
                cpuUsage: 0
            }
        };
    }

    /**
     * Cleanup monitoring intervals
     */
    cleanup() {
        if (this.performanceSummaryInterval) {
            clearInterval(this.performanceSummaryInterval);
        }
    }
}

module.exports = PerformanceMonitor;