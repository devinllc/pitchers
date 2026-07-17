const RateLimiter = require('../../../services/rateLimiter');

// Mock ErrorHandler
jest.mock('../../../services/errorHandler', () => {
    return jest.fn().mockImplementation(() => ({
        logRateLimit: jest.fn(),
        logAndContinue: jest.fn()
    }));
});

describe('RateLimiter', () => {
    let rateLimiter;

    beforeEach(() => {
        jest.clearAllMocks();
        rateLimiter = new RateLimiter();

        // Ensure the errorHandler is properly mocked
        rateLimiter.errorHandler = {
            logRateLimit: jest.fn(),
            logAndContinue: jest.fn()
        };
    });

    describe('constructor', () => {
        it('should initialize with default delay of 2000ms', () => {
            expect(rateLimiter.defaultDelayMs).toBe(2000);
        });
    });

    describe('delay', () => {
        it('should delay for default 2000ms', async () => {
            const startTime = Date.now();

            await rateLimiter.delay();

            const endTime = Date.now();
            const actualDelay = endTime - startTime;

            // Allow for some timing variance (±50ms)
            expect(actualDelay).toBeGreaterThanOrEqual(1950);
            expect(actualDelay).toBeLessThanOrEqual(2050);
        });

        it('should delay for custom duration', async () => {
            const customDelay = 1000;
            const startTime = Date.now();

            await rateLimiter.delay(customDelay);

            const endTime = Date.now();
            const actualDelay = endTime - startTime;

            // Allow for some timing variance (±50ms)
            expect(actualDelay).toBeGreaterThanOrEqual(950);
            expect(actualDelay).toBeLessThanOrEqual(1050);
        });

        it('should log rate limit information', async () => {
            await rateLimiter.delay(1500);

            expect(rateLimiter.errorHandler.logRateLimit).toHaveBeenCalledWith(
                1500,
                'API rate limiting delay'
            );
        });

        it('should still delay even if logging fails', async () => {
            rateLimiter.errorHandler.logRateLimit.mockImplementation(() => {
                throw new Error('Logging failed');
            });

            const startTime = Date.now();

            await rateLimiter.delay(500);

            const endTime = Date.now();
            const actualDelay = endTime - startTime;

            expect(actualDelay).toBeGreaterThanOrEqual(450);
            expect(rateLimiter.errorHandler.logAndContinue).toHaveBeenCalled();
        });
    });

    describe('withDelay', () => {
        it('should execute function after delay', async () => {
            const mockFunction = jest.fn().mockResolvedValue('test result');
            const startTime = Date.now();

            const result = await rateLimiter.withDelay(mockFunction, 'arg1', 'arg2');

            const endTime = Date.now();
            const actualDelay = endTime - startTime;

            expect(actualDelay).toBeGreaterThanOrEqual(1950);
            expect(mockFunction).toHaveBeenCalledWith('arg1', 'arg2');
            expect(result).toBe('test result');
        });

        it('should propagate function errors after delay', async () => {
            const mockFunction = jest.fn().mockRejectedValue(new Error('Function failed'));

            await expect(rateLimiter.withDelay(mockFunction))
                .rejects.toThrow('Function failed');

            expect(mockFunction).toHaveBeenCalled();
        });

        it('should handle delay errors but still execute function', async () => {
            const mockFunction = jest.fn().mockResolvedValue('success');

            // Mock delay to throw error
            jest.spyOn(rateLimiter, 'delay').mockRejectedValue(new Error('Delay failed'));

            await expect(rateLimiter.withDelay(mockFunction))
                .rejects.toThrow('Delay failed');

            expect(rateLimiter.errorHandler.logAndContinue).toHaveBeenCalled();
        });
    });

    describe('getDelayMs', () => {
        it('should return current delay setting', () => {
            expect(rateLimiter.getDelayMs()).toBe(2000);
        });
    });

    describe('error handling', () => {
        it('should handle errors in delay method gracefully', async () => {
            // Mock the errorHandler to throw an error during logging
            rateLimiter.errorHandler.logRateLimit.mockImplementation(() => {
                throw new Error('Logging failed');
            });

            const startTime = Date.now();
            await rateLimiter.delay();
            const endTime = Date.now();

            // Should still complete the delay despite the logging error
            expect(endTime - startTime).toBeGreaterThanOrEqual(1950);
            expect(rateLimiter.errorHandler.logAndContinue).toHaveBeenCalled();
        });
    });

    describe('integration with real timing', () => {
        it('should work with multiple consecutive delays', async () => {
            const delays = [100, 200, 150];
            const startTime = Date.now();

            for (const delay of delays) {
                await rateLimiter.delay(delay);
            }

            const endTime = Date.now();
            const totalDelay = endTime - startTime;
            const expectedDelay = delays.reduce((sum, delay) => sum + delay, 0);

            // Allow for timing variance
            expect(totalDelay).toBeGreaterThanOrEqual(expectedDelay - 50);
            expect(totalDelay).toBeLessThanOrEqual(expectedDelay + 100);
        });

        it('should handle zero delay', async () => {
            const startTime = Date.now();

            await rateLimiter.delay(0);

            const endTime = Date.now();
            const actualDelay = endTime - startTime;

            // Should complete almost immediately
            expect(actualDelay).toBeLessThanOrEqual(50);
        });

        it('should handle negative delay as zero', async () => {
            const startTime = Date.now();

            await rateLimiter.delay(-100);

            const endTime = Date.now();
            const actualDelay = endTime - startTime;

            // Should complete almost immediately
            expect(actualDelay).toBeLessThanOrEqual(50);
        });
    });
});