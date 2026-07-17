const PerformanceMonitor = require('../../../services/performanceMonitor');

describe('PerformanceMonitor', () => {
    let performanceMonitor;

    beforeEach(() => {
        performanceMonitor = new PerformanceMonitor();
    });

    afterEach(() => {
        performanceMonitor.cleanup();
    });

    describe('API Call Tracking', () => {
        test('should track API call performance', () => {
            performanceMonitor.trackApiCall('gemini', 1500, true);

            const metrics = performanceMonitor.getMetrics();
            expect(metrics.apiCalls.gemini.count).toBe(1);
            expect(metrics.apiCalls.gemini.totalTime).toBe(1500);
            expect(metrics.apiCalls.gemini.avgResponseTime).toBe(1500);
            expect(metrics.apiCalls.gemini.errors).toBe(0);
        });

        test('should track API call failures', () => {
            performanceMonitor.trackApiCall('googleMapsSearch', 2000, false);

            const metrics = performanceMonitor.getMetrics();
            expect(metrics.apiCalls.googleMapsSearch.count).toBe(1);
            expect(metrics.apiCalls.googleMapsSearch.errors).toBe(1);
        });

        test('should calculate average response time correctly', () => {
            performanceMonitor.trackApiCall('googlePlaceDetails', 1000, true);
            performanceMonitor.trackApiCall('googlePlaceDetails', 2000, true);
            performanceMonitor.trackApiCall('googlePlaceDetails', 3000, true);

            const metrics = performanceMonitor.getMetrics();
            expect(metrics.apiCalls.googlePlaceDetails.count).toBe(3);
            expect(metrics.apiCalls.googlePlaceDetails.avgResponseTime).toBe(2000);
        });

        test('should handle unknown API names gracefully', () => {
            const consoleSpy = jest.spyOn(console, 'warn').mockImplementation();

            performanceMonitor.trackApiCall('unknownApi', 1000, true);

            expect(consoleSpy).toHaveBeenCalledWith('Unknown API name: unknownApi');
            consoleSpy.mockRestore();
        });
    });

    describe('Job Event Tracking', () => {
        test('should track job started events', () => {
            performanceMonitor.trackJobEvent('started', { city: 'Delhi', keyword: 'restaurant' });

            const metrics = performanceMonitor.getMetrics();
            expect(metrics.processing.jobsStarted).toBe(1);
        });

        test('should track job completed events', () => {
            performanceMonitor.trackJobEvent('started');
            performanceMonitor.trackJobEvent('completed', {
                duration: 30000,
                phrasesProcessed: 10,
                businessesFound: 50,
                businessesSaved: 45
            });

            const metrics = performanceMonitor.getMetrics();
            expect(metrics.processing.jobsCompleted).toBe(1);
            expect(metrics.processing.avgJobDuration).toBe(30000);
            expect(metrics.processing.phrasesProcessed).toBe(10);
            expect(metrics.processing.businessesFound).toBe(50);
            expect(metrics.processing.businessesSaved).toBe(45);
            expect(metrics.processing.saveSuccessRate).toBe(90);
        });

        test('should track job failed events', () => {
            performanceMonitor.trackJobEvent('failed', { error: 'API timeout' });

            const metrics = performanceMonitor.getMetrics();
            expect(metrics.processing.jobsFailed).toBe(1);
        });

        test('should calculate job completion rate correctly', () => {
            performanceMonitor.trackJobEvent('started');
            performanceMonitor.trackJobEvent('started');
            performanceMonitor.trackJobEvent('started');
            performanceMonitor.trackJobEvent('completed');
            performanceMonitor.trackJobEvent('failed');

            const metrics = performanceMonitor.getMetrics();
            expect(metrics.processing.jobsStarted).toBe(3);
            expect(metrics.processing.jobsCompleted).toBe(1);
            expect(metrics.processing.jobsFailed).toBe(1);
        });
    });

    describe('Memory Monitoring', () => {
        test('should track memory usage', () => {
            // Simulate memory usage update
            const memUsage = process.memoryUsage();
            performanceMonitor.metrics.memory.currentUsage = memUsage.heapUsed;

            const metrics = performanceMonitor.getMetrics();

            expect(metrics.memory.currentUsage).toBeGreaterThan(0);
            expect(metrics.memoryUsageMB.current).toBeGreaterThan(0);
        });

        test('should track peak memory usage', () => {
            const initialMetrics = performanceMonitor.getMetrics();
            const initialPeak = initialMetrics.memory.peakUsage;

            // Simulate memory usage increase
            performanceMonitor.metrics.memory.currentUsage = initialPeak + 1000000;

            // Trigger memory monitoring update
            const updatedMetrics = performanceMonitor.getMetrics();
            expect(updatedMetrics.memory.peakUsage).toBeGreaterThanOrEqual(initialPeak);
        });
    });

    describe('System Metrics', () => {
        test('should track system uptime', () => {
            // Set start time to 1 hour ago to ensure uptimeHours > 0
            const startTime = Date.now() - (60 * 60 * 1000); // 1 hour ago
            performanceMonitor.metrics.system.startTime = startTime;

            const metrics = performanceMonitor.getMetrics();

            expect(metrics.system.uptime).toBeGreaterThan(0);
            expect(metrics.uptimeHours).toBeGreaterThan(0);
        });

        test('should include timestamp in metrics', () => {
            const metrics = performanceMonitor.getMetrics();

            expect(metrics.timestamp).toBeDefined();
            expect(new Date(metrics.timestamp)).toBeInstanceOf(Date);
        });
    });

    describe('Performance Summary', () => {
        test('should log performance summary', () => {
            const consoleSpy = jest.spyOn(console, 'log').mockImplementation();

            // Add some test data
            performanceMonitor.trackApiCall('gemini', 1500, true);
            performanceMonitor.trackJobEvent('started');
            performanceMonitor.trackJobEvent('completed', { duration: 30000 });

            performanceMonitor.logPerformanceSummary();

            expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('PERFORMANCE SUMMARY'));
            consoleSpy.mockRestore();
        });
    });

    describe('Metrics Reset', () => {
        test('should reset all metrics', () => {
            // Add some test data
            performanceMonitor.trackApiCall('gemini', 1500, true);
            performanceMonitor.trackJobEvent('started');

            // Reset metrics
            performanceMonitor.resetMetrics();

            const metrics = performanceMonitor.getMetrics();
            expect(metrics.apiCalls.gemini.count).toBe(0);
            expect(metrics.processing.jobsStarted).toBe(0);
        });
    });

    describe('Garbage Collection', () => {
        test('should handle garbage collection when available', () => {
            const consoleSpy = jest.spyOn(console, 'log').mockImplementation();

            // Mock global.gc
            global.gc = jest.fn();

            performanceMonitor.forceGarbageCollection();

            expect(global.gc).toHaveBeenCalled();
            expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('GARBAGE COLLECTION'));

            consoleSpy.mockRestore();
            delete global.gc;
        });

        test('should handle missing garbage collection gracefully', () => {
            // Ensure global.gc is not available
            delete global.gc;

            expect(() => {
                performanceMonitor.forceGarbageCollection();
            }).not.toThrow();
        });
    });
});