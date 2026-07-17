const ProcessingService = require('../../services/processingService');

// Mock external services to avoid actual API calls
jest.mock('../../services/geminiService');
jest.mock('../../services/googleMapsService');
jest.mock('../../services/googleSheets');
jest.mock('../../services/database');

describe('Performance Monitoring Integration', () => {
    let processingService;

    beforeEach(() => {
        processingService = new ProcessingService();
    });

    afterEach(async () => {
        await processingService.cleanup();
    });

    describe('Performance Metrics Collection', () => {
        test('should collect performance metrics', () => {
            const metrics = processingService.getPerformanceMetrics();

            expect(metrics).toBeDefined();
            expect(metrics.apiCalls).toBeDefined();
            expect(metrics.processing).toBeDefined();
            expect(metrics.memory).toBeDefined();
            expect(metrics.system).toBeDefined();
            expect(metrics.timestamp).toBeDefined();
        });

        test('should track API calls in performance metrics', () => {
            // Simulate API call tracking
            processingService.performanceMonitor.trackApiCall('gemini', 1500, true);
            processingService.performanceMonitor.trackApiCall('googleMapsSearch', 800, true);

            const metrics = processingService.getPerformanceMetrics();

            expect(metrics.apiCalls.gemini.count).toBe(1);
            expect(metrics.apiCalls.gemini.avgResponseTime).toBe(1500);
            expect(metrics.apiCalls.googleMapsSearch.count).toBe(1);
            expect(metrics.apiCalls.googleMapsSearch.avgResponseTime).toBe(800);
        });

        test('should track job events in performance metrics', () => {
            // Simulate job tracking
            processingService.performanceMonitor.trackJobEvent('started');
            processingService.performanceMonitor.trackJobEvent('completed', {
                duration: 30000,
                phrasesProcessed: 10,
                businessesFound: 50,
                businessesSaved: 45
            });

            const metrics = processingService.getPerformanceMetrics();

            expect(metrics.processing.jobsStarted).toBe(1);
            expect(metrics.processing.jobsCompleted).toBe(1);
            expect(metrics.processing.avgJobDuration).toBe(30000);
            expect(metrics.processing.saveSuccessRate).toBe(90);
        });
    });

    describe('Streaming Processor Status', () => {
        test('should get streaming processor status', () => {
            const status = processingService.getStreamingStatus();

            expect(status).toBeDefined();
            expect(status.isProcessing).toBe(false);
            expect(status.processedCount).toBe(0);
            expect(status.errorCount).toBe(0);
            expect(status.batchSize).toBeDefined();
        });

        test('should allow batch size configuration', () => {
            processingService.streamingProcessor.setBatchSize(10);

            const status = processingService.getStreamingStatus();
            expect(status.batchSize).toBe(10);
        });
    });

    describe('Memory Management', () => {
        test('should force garbage collection', () => {
            // Mock global.gc
            global.gc = jest.fn();

            processingService.forceGarbageCollection();

            expect(global.gc).toHaveBeenCalled();

            delete global.gc;
        });

        test('should handle missing garbage collection gracefully', () => {
            // Ensure global.gc is not available
            delete global.gc;

            expect(() => {
                processingService.forceGarbageCollection();
            }).not.toThrow();
        });
    });

    describe('Performance Monitoring Lifecycle', () => {
        test('should cleanup performance monitor on service cleanup', async () => {
            const cleanupSpy = jest.spyOn(processingService.performanceMonitor, 'cleanup');

            await processingService.cleanup();

            expect(cleanupSpy).toHaveBeenCalled();
        });

        test('should include memory usage in metrics', () => {
            const metrics = processingService.getPerformanceMetrics();

            expect(metrics.memoryUsageMB).toBeDefined();
            expect(metrics.memoryUsageMB.current).toBeGreaterThanOrEqual(0);
            expect(metrics.memoryUsageMB.peak).toBeGreaterThanOrEqual(0);
        });

        test('should include uptime in metrics', () => {
            const metrics = processingService.getPerformanceMetrics();

            expect(metrics.system.uptime).toBeGreaterThanOrEqual(0);
            expect(metrics.uptimeHours).toBeGreaterThanOrEqual(0);
        });
    });
});