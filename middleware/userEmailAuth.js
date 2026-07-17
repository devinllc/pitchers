/**
 * Middleware for user email validation and context
 * Used for multi-tenant operations where user email is required
 */
class UserEmailAuthMiddleware {
    constructor() {
        // No authentication needed as per requirements - just email validation
    }

    // Validate user email from request
    validateUserEmail() {
        return (req, res, next) => {
            const userEmail = req.body.userEmail || req.query.userEmail || req.headers['x-user-email'];

            if (!userEmail) {
                return res.status(400).json({
                    error: 'User email required',
                    message: 'Please provide userEmail in request body, query parameter, or x-user-email header',
                    timestamp: new Date().toISOString()
                });
            }

            // Basic email validation
            const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
            if (!emailRegex.test(userEmail)) {
                return res.status(400).json({
                    error: 'Invalid email format',
                    message: 'Please provide a valid email address',
                    timestamp: new Date().toISOString()
                });
            }

            // Add user email to request object for downstream use
            req.userEmail = userEmail.toLowerCase().trim();
            next();
        };
    }

    // Extract user email from various sources (more flexible)
    extractUserEmail() {
        return (req, res, next) => {
            // Try multiple sources for user email
            let userEmail = req.body.userEmail || 
                           req.query.userEmail || 
                           req.headers['x-user-email'] ||
                           req.params.userEmail;

            if (userEmail) {
                req.userEmail = userEmail.toLowerCase().trim();
            }
            
            next();
        };
    }

    // Require user email (strict validation)
    requireUserEmail() {
        return (req, res, next) => {
            if (!req.userEmail) {
                return res.status(400).json({
                    error: 'User email required',
                    message: 'User email must be provided for this operation',
                    timestamp: new Date().toISOString()
                });
            }
            next();
        };
    }

    // Validate pagination parameters
    validatePagination() {
        return (req, res, next) => {
            const { page = 1, limit = 100 } = req.query;
            
            const pageNum = parseInt(page);
            const limitNum = parseInt(limit);

            if (isNaN(pageNum) || pageNum < 1) {
                return res.status(400).json({
                    error: 'Invalid page parameter',
                    message: 'Page must be a positive integer',
                    timestamp: new Date().toISOString()
                });
            }

            if (isNaN(limitNum) || limitNum < 1 || limitNum > 1000) {
                return res.status(400).json({
                    error: 'Invalid limit parameter',
                    message: 'Limit must be between 1 and 1000',
                    timestamp: new Date().toISOString()
                });
            }

            req.pagination = {
                page: pageNum,
                limit: limitNum,
                offset: (pageNum - 1) * limitNum
            };

            next();
        };
    }

    // Validate date range parameters
    validateDateRange() {
        return (req, res, next) => {
            const { startDate, endDate } = req.query;

            if (startDate) {
                const start = new Date(startDate);
                if (isNaN(start.getTime())) {
                    return res.status(400).json({
                        error: 'Invalid startDate format',
                        message: 'Please provide startDate in ISO format (YYYY-MM-DD)',
                        timestamp: new Date().toISOString()
                    });
                }
                req.dateRange = req.dateRange || {};
                req.dateRange.startDate = start;
            }

            if (endDate) {
                const end = new Date(endDate);
                if (isNaN(end.getTime())) {
                    return res.status(400).json({
                        error: 'Invalid endDate format',
                        message: 'Please provide endDate in ISO format (YYYY-MM-DD)',
                        timestamp: new Date().toISOString()
                    });
                }
                req.dateRange = req.dateRange || {};
                req.dateRange.endDate = end;
            }

            // Validate date range logic
            if (req.dateRange && req.dateRange.startDate && req.dateRange.endDate) {
                if (req.dateRange.startDate > req.dateRange.endDate) {
                    return res.status(400).json({
                        error: 'Invalid date range',
                        message: 'startDate must be before endDate',
                        timestamp: new Date().toISOString()
                    });
                }
            }

            next();
        };
    }

    // Validate Google Sheet ID format
    validateSheetId() {
        return (req, res, next) => {
            const sheetId = req.body.sheetId || req.query.sheetId || req.params.sheetId;

            if (sheetId) {
                // Basic Google Sheets ID validation (alphanumeric, hyphens, underscores)
                const sheetIdRegex = /^[a-zA-Z0-9_-]+$/;
                if (!sheetIdRegex.test(sheetId) || sheetId.length < 10) {
                    return res.status(400).json({
                        error: 'Invalid sheet ID format',
                        message: 'Please provide a valid Google Sheets ID',
                        timestamp: new Date().toISOString()
                    });
                }
                req.sheetId = sheetId;
            }

            next();
        };
    }

    // Log user activity for debugging/monitoring
    logUserActivity() {
        return (req, res, next) => {
            if (req.userEmail) {
                console.log(`[USER ACTIVITY] ${req.method} ${req.path} - User: ${req.userEmail} - ${new Date().toISOString()}`);
            }
            next();
        };
    }
}

module.exports = UserEmailAuthMiddleware;
