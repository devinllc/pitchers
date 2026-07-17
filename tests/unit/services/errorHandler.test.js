const ErrorHandler = require('../../../services/errorHandler');

describe('ErrorHandler', () => {
    let errorHandler;
    let consoleSpy;

    beforeEach(() => {
        errorHandler = new ErrorHandler();
        consoleSpy = {
            error: jest.spyOn(console, 'error').mockImplementation(),
            log: jest.spyOn(console, 'log').mockImplementation()
        };
    });

    afterEach(() => {
        consoleSpy.error.mockRestore();
        consoleSpy.log.mockRestore();
    });

    describe('constructor', () => {
        it('should initialize with default log level', () => {
            expect(errorHandler.logLevel).toBe('info');
        });

        it('should use LOG_LEVEL environment variable', () => {
            const originalEnv = process.env.LOG_LEVEL;
            process.env.LOG_LEVEL = 'debug';

            const handler = new ErrorHandler();
            expect(handler.logLevel).toBe('debug');

            process.env.LOG_LEVEL = originalEnv;
        });
    });

    describe('logAndContinue', () => {
        it('should log error and return continue', () => {
            const error = new Error('Test error');
            const context = { operation: 'test_operation', data: 'test_data' };

            const result = errorHandler.logAndContinue(error, context);

            expect(result).toBe('continue');
            expect(consoleSpy.error).toHaveBeenCalledWith(
                '🚨 ERROR:',
                expect.stringContaining('Test error')
            );
        });

        it('should handle error without context', () => {
            const error = new Error('Test error');

            const result = errorHandler.logAndContinue(error);

            expect(result).toBe('continue');
            expect(consoleSpy.error).toHaveBeenCalledWith(
                '🚨 ERROR:',
                expect.stringContaining('unknown')
            );
        });

        it('should include error stack trace', () => {
            const error = new Error('Test error');
            error.stack = 'Error: Test error\n    at test.js:1:1';

            errorHandler.logAndContinue(error, { operation: 'test' });

            const logCall = consoleSpy.error.mock.calls[0][1];
            const logData = JSON.parse(logCall);
            expect(logData.stack).toContain('Error: Test error');
        });

        it('should include error type in context', () => {
            const error = new TypeError('Type error');

            errorHandler.logAndContinue(error, { operation: 'test' });

            const logCall = consoleSpy.error.mock.calls[0][1];
            const logData = JSON.parse(logCall);
            expect(logData.context.errorType).toBe('TypeError');
        });
    });

    describe('logApiCall', () => {
        it('should log successful API call', () => {
            const apiName = 'Google Maps API';
            const params = { query: 'test', key: 'secret-key' };
            const result = { results: [1, 2, 3] };
            const duration = 1500;

            errorHandler.logApiCall(apiName, params, result, duration);

            expect(consoleSpy.log).toHaveBeenCalledWith(
                '📡 API CALL:',
                expect.stringContaining('Google Maps API')
            );

            const logCall = consoleSpy.log.mock.calls[0][1];
            const logData = JSON.parse(logCall);
            expect(logData.api).toBe('Google Maps API');
            expect(logData.duration).toBe('1500ms');
            expect(logData.success).toBe(true);
            expect(logData.resultCount).toBe(3);
        });

        it('should sanitize sensitive parameters', () => {
            const params = { query: 'test', key: 'secret-key', apiKey: 'another-secret' };

            errorHandler.logApiCall('Test API', params, {}, 100);

            const logCall = consoleSpy.log.mock.calls[0][1];
            const logData = JSON.parse(logCall);
            expect(logData.params.key).toBe('***MASKED***');
            expect(logData.params.apiKey).toBe('***MASKED***');
            expect(logData.params.query).toBe('test');
        });

        it('should handle different result formats', () => {
            // Test with array result
            errorHandler.logApiCall('API1', {}, [1, 2, 3], 100);
            let logData = JSON.parse(consoleSpy.log.mock.calls[0][1]);
            expect(logData.resultCount).toBe(3);

            // Test with object with results array
            errorHandler.logApiCall('API2', {}, { results: [1, 2] }, 100);
            logData = JSON.parse(consoleSpy.log.mock.calls[1][1]);
            expect(logData.resultCount).toBe(2);

            // Test with null result
            errorHandler.logApiCall('API3', {}, null, 100);
            logData = JSON.parse(consoleSpy.log.mock.calls[2][1]);
            expect(logData.resultCount).toBe(0);
        });
    });

    describe('logApiFailure', () => {
        it('should log API failure', () => {
            const error = new Error('API failed');
            error.response = { status: 500 };
            const params = { query: 'test' };

            errorHandler.logApiFailure('Test API', error, params, 2);

            expect(consoleSpy.error).toHaveBeenCalledWith(
                '❌ API FAILURE:',
                expect.stringContaining('Test API')
            );

            const logCall = consoleSpy.error.mock.calls[0][1];
            const logData = JSON.parse(logCall);
            expect(logData.api).toBe('Test API');
            expect(logData.attempt).toBe(2);
            expect(logData.error).toBe('API failed');
            expect(logData.statusCode).toBe(500);
        });

        it('should handle error without response', () => {
            const error = new Error('Network error');

            errorHandler.logApiFailure('Test API', error, {});

            const logCall = consoleSpy.error.mock.calls[0][1];
            const logData = JSON.parse(logCall);
            expect(logData.statusCode).toBeUndefined();
        });
    });

    describe('logProgress', () => {
        it('should log progress information', () => {
            const operation = 'processing_data';
            const progress = { step: 1, total: 10, current: 'item1' };

            errorHandler.logProgress(operation, progress);

            expect(consoleSpy.log).toHaveBeenCalledWith(
                '⏳ PROGRESS:',
                expect.stringContaining('processing_data')
            );

            const logCall = consoleSpy.log.mock.calls[0][1];
            const logData = JSON.parse(logCall);
            expect(logData.operation).toBe('processing_data');
            expect(logData.progress).toEqual(progress);
        });
    });

    describe('logDataSave', () => {
        it('should log successful data save', () => {
            const data = { name: 'Test Business', phone: '123-456-7890', website: 'test.com' };

            errorHandler.logDataSave('PostgreSQL', data, 1);

            expect(consoleSpy.log).toHaveBeenCalledWith(
                '💾 DATA SAVED:',
                expect.stringContaining('PostgreSQL')
            );

            const logCall = consoleSpy.log.mock.calls[0][1];
            const logData = JSON.parse(logCall);
            expect(logData.destination).toBe('PostgreSQL');
            expect(logData.recordCount).toBe(1);
            expect(logData.businessName).toBe('Test Business');
            expect(logData.hasPhone).toBe(true);
            expect(logData.hasWebsite).toBe(true);
        });

        it('should handle missing data fields', () => {
            const data = { name: 'Test Business' };

            errorHandler.logDataSave('Google Sheets', data);

            const logCall = consoleSpy.log.mock.calls[0][1];
            const logData = JSON.parse(logCall);
            expect(logData.hasPhone).toBe(false);
            expect(logData.hasWebsite).toBe(false);
            expect(logData.recordCount).toBe(1);
        });
    });

    describe('logDataSaveFailure', () => {
        it('should log data save failure', () => {
            const error = new Error('Save failed');
            const data = { name: 'Test Business' };

            errorHandler.logDataSaveFailure('Google Sheets', error, data);

            expect(consoleSpy.error).toHaveBeenCalledWith(
                '💥 SAVE FAILURE:',
                expect.stringContaining('Google Sheets')
            );

            const logCall = consoleSpy.error.mock.calls[0][1];
            const logData = JSON.parse(logCall);
            expect(logData.destination).toBe('Google Sheets');
            expect(logData.error).toBe('Save failed');
            expect(logData.businessName).toBe('Test Business');
        });
    });

    describe('logRateLimit', () => {
        it('should log rate limiting delay', () => {
            errorHandler.logRateLimit(2000, 'API rate limiting');

            expect(consoleSpy.log).toHaveBeenCalledWith(
                '⏱️  RATE LIMIT:',
                expect.stringContaining('2000ms')
            );

            const logCall = consoleSpy.log.mock.calls[0][1];
            const logData = JSON.parse(logCall);
            expect(logData.delay).toBe('2000ms');
            expect(logData.reason).toBe('API rate limiting');
        });
    });

    describe('logJobStatus', () => {
        it('should log job status with appropriate emoji', () => {
            const jobId = 'job_123';
            const details = { city: 'Delhi', keyword: 'restaurant' };

            // Test started status
            errorHandler.logJobStatus(jobId, 'started', details);
            expect(consoleSpy.log).toHaveBeenCalledWith(
                '🚀 JOB STARTED:',
                expect.stringContaining('job_123')
            );

            // Test completed status
            errorHandler.logJobStatus(jobId, 'completed', details);
            expect(consoleSpy.log).toHaveBeenCalledWith(
                '✅ JOB COMPLETED:',
                expect.stringContaining('job_123')
            );

            // Test failed status
            errorHandler.logJobStatus(jobId, 'failed', details);
            expect(consoleSpy.log).toHaveBeenCalledWith(
                '❌ JOB FAILED:',
                expect.stringContaining('job_123')
            );
        });
    });

    describe('sanitizeParams', () => {
        it('should sanitize sensitive parameters', () => {
            const params = {
                query: 'test',
                key: 'secret-key',
                apiKey: 'another-secret',
                token: 'auth-token',
                normalParam: 'normal-value'
            };

            const sanitized = errorHandler.sanitizeParams(params);

            expect(sanitized).toEqual({
                query: 'test',
                key: '***MASKED***',
                apiKey: '***MASKED***',
                token: '***MASKED***',
                normalParam: 'normal-value'
            });
        });

        it('should handle null or undefined params', () => {
            expect(errorHandler.sanitizeParams(null)).toEqual({});
            expect(errorHandler.sanitizeParams(undefined)).toEqual({});
        });

        it('should not modify original params object', () => {
            const params = { key: 'secret', query: 'test' };
            const original = { ...params };

            errorHandler.sanitizeParams(params);

            expect(params).toEqual(original);
        });
    });

    describe('wrapOperation', () => {
        it('should wrap successful operation', async () => {
            const mockOperation = jest.fn().mockResolvedValue('success');
            const context = { operation: 'test_op', logSuccess: true };

            const wrappedOp = errorHandler.wrapOperation(mockOperation, context);
            const result = await wrappedOp('arg1', 'arg2');

            expect(result).toBe('success');
            expect(mockOperation).toHaveBeenCalledWith('arg1', 'arg2');
            expect(consoleSpy.log).toHaveBeenCalledWith(
                '⏳ PROGRESS:',
                expect.stringContaining('test_op')
            );
        });

        it('should wrap failed operation', async () => {
            const mockOperation = jest.fn().mockRejectedValue(new Error('Operation failed'));
            const context = { operation: 'test_op' };

            const wrappedOp = errorHandler.wrapOperation(mockOperation, context);
            const result = await wrappedOp();

            expect(result).toBeNull();
            expect(consoleSpy.error).toHaveBeenCalledWith(
                '🚨 ERROR:',
                expect.stringContaining('Operation failed')
            );
        });

        it('should not log success if logSuccess is false', async () => {
            const mockOperation = jest.fn().mockResolvedValue('success');
            const context = { operation: 'test_op', logSuccess: false };

            const wrappedOp = errorHandler.wrapOperation(mockOperation, context);
            await wrappedOp();

            expect(consoleSpy.log).not.toHaveBeenCalledWith(
                '⏳ PROGRESS:',
                expect.anything()
            );
        });
    });
});