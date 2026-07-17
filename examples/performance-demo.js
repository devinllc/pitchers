/**
 * Performance Monitoring Demonstration
 * Shows how the performance monitoring and streaming processing work
 */

const PerformanceMonitor = require('../services/performanceMonitor');
const StreamingProcessor = require('../services/streamingProcessor');

async function demonstratePerformanceMonitoring() {
    console.log('🚀 Starting Performance Monitoring Demonstration\n');

    // Initialize performance monitor
    const performanceMonitor = new PerformanceMonitor();
    const streamingProcessor = new StreamingProcessor(3);

    // Simulate API calls with different response times
    console.log('📡 Simulating API calls...');
    performanceMonitor.trackApiCall('gemini', 1200, true);
    performanceMonitor.trackApiCall('googleMapsSearch', 800, true);
    performanceMonitor.trackApiCall('googlePlaceDetails', 600, true);
    performanceMonitor.trackApiCall('googleSheets', 400, true);

    // Simulate some failures
    performanceMonitor.trackApiCall('googleMapsSearch', 2000, false);
    performanceMonitor.trackApiCall('googlePlaceDetails', 1500, false);

    // Simulate job processing
    console.log('📊 Simulating job processing...');
    performanceMonitor.trackJobEvent('started', { city: 'Delhi', keyword: 'restaurant' });

    // Simulate processing completion
    setTimeout(() => {
        performanceMonitor.trackJobEvent('completed', {
            duration: 45000,
            phrasesProcessed: 15,
            businessesFound: 120,
            businessesSaved: 115
        });

        // Show performance metrics
        console.log('\n📈 Current Performance Metrics:');
        const metrics = performanceMonitor.getMetrics();

        console.log(`\n🔗 API Performance:`);
        Object.entries(metrics.apiCalls).forEach(([api, stats]) => {
            if (stats.count > 0) {
                const errorRate = Math.round((stats.errors / stats.count) * 100);
                console.log(`  ${api}: ${stats.count} calls, ${stats.avgResponseTime}ms avg, ${errorRate}% errors`);
            }
        });

        console.log(`\n📊 Processing Statistics:`);
        console.log(`  Jobs Completed: ${metrics.processing.jobsCompleted}/${metrics.processing.jobsStarted}`);
        console.log(`  Average Job Duration: ${Math.round(metrics.processing.avgJobDuration / 1000)}s`);
        console.log(`  Save Success Rate: ${metrics.processing.saveSuccessRate}%`);
        console.log(`  Businesses Found: ${metrics.processing.businessesFound}`);
        console.log(`  Businesses Saved: ${metrics.processing.businessesSaved}`);

        console.log(`\n🧠 Memory Usage:`);
        console.log(`  Current: ${metrics.memoryUsageMB.current}MB`);
        console.log(`  Peak: ${metrics.memoryUsageMB.peak}MB`);

        console.log(`\n⏱️  System:`);
        console.log(`  Uptime: ${metrics.uptimeHours} hours`);

        // Demonstrate streaming processing
        console.log('\n🌊 Demonstrating Streaming Processing...');
        demonstrateStreamingProcessing(streamingProcessor);

    }, 1000);

    // Cleanup after demo
    setTimeout(() => {
        performanceMonitor.cleanup();
        console.log('\n✅ Performance monitoring demonstration completed!');
    }, 3000);
}

async function demonstrateStreamingProcessing(streamingProcessor) {
    // Create sample data to process
    const samplePlaceIds = [
        'place_id_1', 'place_id_2', 'place_id_3', 'place_id_4', 'place_id_5',
        'place_id_6', 'place_id_7', 'place_id_8', 'place_id_9', 'place_id_10'
    ];

    // Mock processor function
    const mockProcessor = async (placeId, index) => {
        // Simulate processing time
        await new Promise(resolve => setTimeout(resolve, 100));

        // Simulate occasional failures
        if (Math.random() < 0.1) {
            throw new Error(`Processing failed for ${placeId}`);
        }

        return {
            placeId,
            businessName: `Business ${index + 1}`,
            processed: true
        };
    };

    // Progress callback
    const onProgress = (progress) => {
        console.log(`  📦 Batch ${progress.currentBatch}/${progress.totalBatches}: ${progress.processed}/${progress.total} processed (${progress.progress}%)`);
    };

    try {
        console.log(`Processing ${samplePlaceIds.length} place IDs in batches of ${streamingProcessor.batchSize}...`);

        const result = await streamingProcessor.processStream(samplePlaceIds, mockProcessor, onProgress);

        console.log(`\n✅ Streaming processing completed:`);
        console.log(`  Processed: ${result.processed}/${result.total}`);
        console.log(`  Errors: ${result.errors}`);
        console.log(`  Success Rate: ${result.successRate}%`);

        if (result.errorDetails.length > 0) {
            console.log(`  Error Details: ${result.errorDetails.length} items failed`);
        }

    } catch (error) {
        console.error('❌ Streaming processing failed:', error.message);
    }
}

// Run the demonstration
if (require.main === module) {
    demonstratePerformanceMonitoring().catch(console.error);
}

module.exports = { demonstratePerformanceMonitoring, demonstrateStreamingProcessing };