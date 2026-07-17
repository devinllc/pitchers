const UserDataService = require('../services/userDataService');
const DatabaseService = require('../services/database');

class UserDataController {
    constructor() {
        this.databaseService = new DatabaseService();
        this.userDataService = new UserDataService(this.databaseService);
        this.initialized = false;
    }

    // Initialize service if not already done
    async ensureInitialized() {
        if (!this.initialized) {
            await this.userDataService.initialize();
            this.initialized = true;
        }
    }

    // Get all user's business data with pagination and filters
    async getAllUserData(req, res) {
        try {
            await this.ensureInitialized();
            const { userEmail, pagination, dateRange } = req;
            const { jobId, sheetId, city, keyword, sortBy, sortOrder } = req.query;

            const options = {
                limit: pagination.limit,
                offset: pagination.offset,
                jobId,
                sheetId,
                city,
                keyword,
                startDate: dateRange?.startDate,
                endDate: dateRange?.endDate,
                sortBy,
                sortOrder
            };

            const [data, totalCount] = await Promise.all([
                this.userDataService.getAllUserData(userEmail, options),
                this.userDataService.getUserDataCount(userEmail, options)
            ]);

            const totalPages = Math.ceil(totalCount / pagination.limit);

            res.json({
                success: true,
                userEmail,
                data,
                pagination: {
                    page: pagination.page,
                    limit: pagination.limit,
                    totalCount,
                    totalPages,
                    hasNextPage: pagination.page < totalPages,
                    hasPrevPage: pagination.page > 1
                },
                filters: {
                    jobId,
                    sheetId,
                    city,
                    keyword,
                    dateRange,
                    sortBy,
                    sortOrder
                },
                message: `Retrieved ${data.length} business records`
            });

        } catch (error) {
            console.error('Error getting all user data:', error);
            res.status(500).json({
                success: false,
                error: 'Failed to get user data',
                message: error.message,
                timestamp: new Date().toISOString()
            });
        }
    }

    // Get user's data summary with statistics
    async getUserDataSummary(req, res) {
        try {
            await this.ensureInitialized();
            const { userEmail, dateRange } = req;

            const options = {
                startDate: dateRange?.startDate,
                endDate: dateRange?.endDate
            };

            const summary = await this.userDataService.getUserDataSummary(userEmail, options);

            res.json({
                success: true,
                userEmail,
                summary: {
                    totalRecords: parseInt(summary.total_records),
                    uniqueCities: parseInt(summary.unique_cities),
                    uniqueKeywords: parseInt(summary.unique_keywords),
                    uniqueJobs: parseInt(summary.unique_jobs),
                    uniqueSheets: parseInt(summary.unique_sheets),
                    recordsWithPhone: parseInt(summary.records_with_phone),
                    recordsWithWebsite: parseInt(summary.records_with_website),
                    recordsWithEmail: parseInt(summary.records_with_email),
                    firstRecordDate: summary.first_record_date,
                    lastRecordDate: summary.last_record_date,
                    dateRange
                },
                message: 'Data summary retrieved successfully'
            });

        } catch (error) {
            console.error('Error getting user data summary:', error);
            res.status(500).json({
                success: false,
                error: 'Failed to get data summary',
                message: error.message,
                timestamp: new Date().toISOString()
            });
        }
    }

    // Get user's data grouped by city
    async getUserDataByCity(req, res) {
        try {
            await this.ensureInitialized();
            const { userEmail, dateRange } = req;
            const { limit = 50 } = req.query;

            const options = {
                startDate: dateRange?.startDate,
                endDate: dateRange?.endDate,
                limit: parseInt(limit)
            };

            const cityData = await this.userDataService.getUserDataByCity(userEmail, options);

            res.json({
                success: true,
                userEmail,
                cityData: cityData.map(row => ({
                    city: row.city,
                    recordCount: parseInt(row.record_count),
                    uniqueKeywords: parseInt(row.unique_keywords),
                    recordsWithPhone: parseInt(row.records_with_phone),
                    recordsWithWebsite: parseInt(row.records_with_website),
                    recordsWithEmail: parseInt(row.records_with_email),
                    latestRecord: row.latest_record
                })),
                totalCities: cityData.length,
                message: `Retrieved data for ${cityData.length} cities`
            });

        } catch (error) {
            console.error('Error getting user data by city:', error);
            res.status(500).json({
                success: false,
                error: 'Failed to get data by city',
                message: error.message,
                timestamp: new Date().toISOString()
            });
        }
    }

    // Get user's data grouped by keyword
    async getUserDataByKeyword(req, res) {
        try {
            await this.ensureInitialized();
            const { userEmail, dateRange } = req;
            const { limit = 50 } = req.query;

            const options = {
                startDate: dateRange?.startDate,
                endDate: dateRange?.endDate,
                limit: parseInt(limit)
            };

            const keywordData = await this.userDataService.getUserDataByKeyword(userEmail, options);

            res.json({
                success: true,
                userEmail,
                keywordData: keywordData.map(row => ({
                    keyword: row.keyword,
                    recordCount: parseInt(row.record_count),
                    uniqueCities: parseInt(row.unique_cities),
                    recordsWithPhone: parseInt(row.records_with_phone),
                    recordsWithWebsite: parseInt(row.records_with_website),
                    recordsWithEmail: parseInt(row.records_with_email),
                    latestRecord: row.latest_record
                })),
                totalKeywords: keywordData.length,
                message: `Retrieved data for ${keywordData.length} keywords`
            });

        } catch (error) {
            console.error('Error getting user data by keyword:', error);
            res.status(500).json({
                success: false,
                error: 'Failed to get data by keyword',
                message: error.message,
                timestamp: new Date().toISOString()
            });
        }
    }

    // Get user's recent activity
    async getUserRecentActivity(req, res) {
        try {
            await this.ensureInitialized();
            const { userEmail } = req;
            const { limit = 20 } = req.query;

            const recentActivity = await this.userDataService.getUserRecentActivity(userEmail, parseInt(limit));

            res.json({
                success: true,
                userEmail,
                data: recentActivity,
                count: recentActivity.length,
                message: `Retrieved ${recentActivity.length} recent activities`
            });

        } catch (error) {
            console.error('Error getting user recent activity:', error);
            res.status(500).json({
                success: false,
                error: 'Failed to get recent activity',
                message: error.message,
                timestamp: new Date().toISOString()
            });
        }
    }

    // Export user's data to CSV
    async exportUserDataToCSV(req, res) {
        try {
            await this.ensureInitialized();
            const { userEmail, dateRange } = req;
            const { jobId, sheetId, city, keyword } = req.query;

            const options = {
                jobId,
                sheetId,
                city,
                keyword,
                startDate: dateRange?.startDate,
                endDate: dateRange?.endDate
            };

            const csvData = await this.userDataService.exportUserDataToCSV(userEmail, options);

            // Set CSV headers
            res.setHeader('Content-Type', 'text/csv');
            res.setHeader('Content-Disposition', `attachment; filename="business-data-${userEmail}-${new Date().toISOString().split('T')[0]}.csv"`);

            // Convert to CSV string
            if (csvData.length === 0) {
                return res.send('No data available for export');
            }

            const headers = Object.keys(csvData[0]);
            const csvContent = [
                headers.join(','),
                ...csvData.map(row => 
                    headers.map(header => {
                        const value = row[header] || '';
                        // Escape quotes and wrap in quotes if contains comma
                        return value.toString().includes(',') ? `"${value.toString().replace(/"/g, '""')}"` : value;
                    }).join(',')
                )
            ].join('\n');

            res.send(csvContent);

        } catch (error) {
            console.error('Error exporting user data to CSV:', error);
            res.status(500).json({
                success: false,
                error: 'Failed to export data',
                message: error.message,
                timestamp: new Date().toISOString()
            });
        }
    }
}

module.exports = UserDataController;
