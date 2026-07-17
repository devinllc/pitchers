/**
 * ErrorHandler - Comprehensive error handling and logging service
 * Implements the design requirement for "log errors and continue processing"
 */
class ErrorHandler {
    constructor() {
        this.logLevel = process.env.LOG_LEVEL || 'info';
    }

    /**
     * Log error and return 'continue' to maintain processing flow
     * @param {Error} error - The error object
     * @param {Object} context - Context information about where the error occurred
     * @returns {string} Always returns 'continue' to maintain processing flow
     */
    logAndContinue(error, context = {}) {
        const errorLog = {
            timestamp: new Date().toISOString(),
            level: 'ERROR',
            operation: context.operation || 'unknown',
            message: error.message,
            stack: error.stack,
            context: {
                ...context,
                errorType: error.constructor.name
            }
        };

        console.error('🚨 ERROR:', JSON.stringify(errorLog, null, 2));

        // Always return 'continue' - never stop processing
        return 'continue';
    }

    /**
     * Log API call attempts and results
     * @param {string} apiName - Name of the API being called
     * @param {Object} params - Parameters sent to the API
     * @param {Object} result - Result from the API call
     * @param {number} duration - Time taken for the API call in ms
     */
    logApiCall(apiName, params, result, duration) {
        const apiLog = {
            timestamp: new Date().toISOString(),
            level: 'INFO',
            type: 'API_CALL',
            api: apiName,
            duration: `${duration}ms`,
            params: this.sanitizeParams(params),
            success: !!result,
            resultCount: result?.results?.length || result?.length || 0
        };

        console.log('📡 API CALL:', JSON.stringify(apiLog, null, 2));
    }

    /**
     * Log API call failures with retry information
     * @param {string} apiName - Name of the API that failed
     * @param {Error} error - The error that occurred
     * @param {Object} params - Parameters that were sent
     * @param {number} attempt - Current attempt number
     */
    logApiFailure(apiName, error, params, attempt = 1) {
        const failureLog = {
            timestamp: new Date().toISOString(),
            level: 'ERROR',
            type: 'API_FAILURE',
            api: apiName,
            attempt: attempt,
            error: error.message,
            statusCode: error.response?.status,
            params: this.sanitizeParams(params),
            context: 'API call failed, continuing with next operation'
        };

        console.error('❌ API FAILURE:', JSON.stringify(failureLog, null, 2));
    }

    /**
     * Log processing progress and milestones
     * @param {string} operation - Current operation being performed
     * @param {Object} progress - Progress information
     */
    logProgress(operation, progress) {
        const progressLog = {
            timestamp: new Date().toISOString(),
            level: 'INFO',
            type: 'PROGRESS',
            operation: operation,
            progress: progress
        };

        console.log('⏳ PROGRESS:', JSON.stringify(progressLog, null, 2));
    }

    /**
     * Log successful data saves
     * @param {string} destination - Where data was saved (database, sheets, etc.)
     * @param {Object} data - Data that was saved (sanitized)
     * @param {number} recordCount - Number of records saved
     */
    logDataSave(destination, data, recordCount = 1) {
        const saveLog = {
            timestamp: new Date().toISOString(),
            level: 'INFO',
            type: 'DATA_SAVE',
            destination: destination,
            recordCount: recordCount,
            businessName: data?.name || 'Unknown',
            hasPhone: !!data?.phone,
            hasWebsite: !!data?.website
        };

        console.log('💾 DATA SAVED:', JSON.stringify(saveLog, null, 2));
    }

    /**
     * Log data save failures
     * @param {string} destination - Where data failed to save
     * @param {Error} error - The error that occurred
     * @param {Object} data - Data that failed to save
     */
    logDataSaveFailure(destination, error, data) {
        const failureLog = {
            timestamp: new Date().toISOString(),
            level: 'ERROR',
            type: 'DATA_SAVE_FAILURE',
            destination: destination,
            error: error.message,
            businessName: data?.name || 'Unknown',
            context: 'Data save failed, continuing with next record'
        };

        console.error('💥 SAVE FAILURE:', JSON.stringify(failureLog, null, 2));
    }

    /**
     * Log rate limiting delays
     * @param {number} delayMs - Delay time in milliseconds
     * @param {string} reason - Reason for the delay
     */
    logRateLimit(delayMs, reason) {
        const rateLimitLog = {
            timestamp: new Date().toISOString(),
            level: 'INFO',
            type: 'RATE_LIMIT',
            delay: `${delayMs}ms`,
            reason: reason
        };

        console.log('⏱️  RATE LIMIT:', JSON.stringify(rateLimitLog, null, 2));
    }

    /**
     * Log job start and completion
     * @param {string} jobId - Unique job identifier
     * @param {string} status - Job status (started, completed, failed)
     * @param {Object} details - Additional job details
     */
    logJobStatus(jobId, status, details = {}) {
        const jobLog = {
            timestamp: new Date().toISOString(),
            level: 'INFO',
            type: 'JOB_STATUS',
            jobId: jobId,
            status: status,
            details: details
        };

        const emoji = status === 'started' ? '🚀' : status === 'completed' ? '✅' : '❌';
        console.log(`${emoji} JOB ${status.toUpperCase()}:`, JSON.stringify(jobLog, null, 2));
    }

    /**
     * Sanitize parameters to remove sensitive information
     * @param {Object} params - Parameters to sanitize
     * @returns {Object} Sanitized parameters
     */
    sanitizeParams(params) {
        if (!params) return {};

        const sanitized = { ...params };

        // Remove or mask sensitive fields
        if (sanitized.key) sanitized.key = '***MASKED***';
        if (sanitized.apiKey) sanitized.apiKey = '***MASKED***';
        if (sanitized.token) sanitized.token = '***MASKED***';

        return sanitized;
    }

    /**
     * Create a wrapper for async operations that automatically handles errors
     * @param {Function} operation - Async operation to wrap
     * @param {Object} context - Context for error logging
     * @returns {Function} Wrapped operation that logs errors and continues
     */
    wrapOperation(operation, context) {
        return async (...args) => {
            try {
                const startTime = Date.now();
                const result = await operation(...args);
                const duration = Date.now() - startTime;

                if (context.logSuccess) {
                    this.logProgress(context.operation, {
                        status: 'success',
                        duration: `${duration}ms`
                    });
                }

                return result;
            } catch (error) {
                this.logAndContinue(error, context);
                return null; // Return null on error to allow processing to continue
            }
        };
    }
}

module.exports = ErrorHandler;