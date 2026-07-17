const UserGoogleSheet = require('../models/UserGoogleSheet');

/**
 * Service for fetching user data across all storage systems
 * Provides unified access to user's business data from database and sheets
 */
class UserDataService {
    constructor(databaseService) {
        this.db = databaseService;
        this.userGoogleSheet = new UserGoogleSheet(databaseService);
    }

    // Initialize database tables if needed
    async initialize() {
        try {
            await this.userGoogleSheet.createUserGoogleSheetsTable();
            await this.userGoogleSheet.createBusinessDataTable();
            console.log('UserDataService initialized');
        } catch (error) {
            console.error('Error initializing UserDataService:', error);
            throw error;
        }
    }

    // Get all user's business data with comprehensive filtering
    async getAllUserData(userEmail, options = {}) {
        const {
            limit = 100,
            offset = 0,
            jobId = null,
            sheetId = null,
            city = null,
            keyword = null,
            startDate = null,
            endDate = null,
            sortBy = 'created_at',
            sortOrder = 'DESC'
        } = options;

        // Build dynamic query
        let whereConditions = ['user_email = $1'];
        let values = [userEmail];
        let paramCount = 1;

        if (jobId) {
            paramCount++;
            whereConditions.push(`job_id = $${paramCount}`);
            values.push(jobId);
        }

        if (sheetId) {
            paramCount++;
            whereConditions.push(`sheet_id = $${paramCount}`);
            values.push(sheetId);
        }

        if (city) {
            paramCount++;
            whereConditions.push(`city ILIKE $${paramCount}`);
            values.push(`%${city}%`);
        }

        if (keyword) {
            paramCount++;
            whereConditions.push(`keyword ILIKE $${paramCount}`);
            values.push(`%${keyword}%`);
        }

        if (startDate) {
            paramCount++;
            whereConditions.push(`created_at >= $${paramCount}`);
            values.push(startDate);
        }

        if (endDate) {
            paramCount++;
            whereConditions.push(`created_at <= $${paramCount}`);
            values.push(endDate);
        }

        // Validate sort parameters
        const allowedSortFields = ['created_at', 'name', 'city', 'keyword', 'updated_at'];
        const validSortBy = allowedSortFields.includes(sortBy) ? sortBy : 'created_at';
        const validSortOrder = ['ASC', 'DESC'].includes(sortOrder.toUpperCase()) ? sortOrder.toUpperCase() : 'DESC';

        const selectQuery = `
            SELECT 
                id, job_id, place_id, name, address, phone, website, email,
                search_phrase, city, keyword, sheet_id, created_at, updated_at,
                linkedin, facebook, instagram, twitter, youtube, tiktok,
                status, notes, tags
            FROM business_data 
            WHERE ${whereConditions.join(' AND ')}
            ORDER BY ${validSortBy} ${validSortOrder}
            LIMIT $${paramCount + 1} OFFSET $${paramCount + 2};
        `;

        values.push(limit, offset);

        try {
            const client = await this.db.pool.connect();
            const result = await client.query(selectQuery, values);
            client.release();
            return result.rows;
        } catch (error) {
            console.error('Error getting all user data:', error);
            throw error;
        }
    }

    // Get user data count with same filtering options
    async getUserDataCount(userEmail, options = {}) {
        const {
            jobId = null,
            sheetId = null,
            city = null,
            keyword = null,
            startDate = null,
            endDate = null
        } = options;

        let whereConditions = ['user_email = $1'];
        let values = [userEmail];
        let paramCount = 1;

        if (jobId) {
            paramCount++;
            whereConditions.push(`job_id = $${paramCount}`);
            values.push(jobId);
        }

        if (sheetId) {
            paramCount++;
            whereConditions.push(`sheet_id = $${paramCount}`);
            values.push(sheetId);
        }

        if (city) {
            paramCount++;
            whereConditions.push(`city ILIKE $${paramCount}`);
            values.push(`%${city}%`);
        }

        if (keyword) {
            paramCount++;
            whereConditions.push(`keyword ILIKE $${paramCount}`);
            values.push(`%${keyword}%`);
        }

        if (startDate) {
            paramCount++;
            whereConditions.push(`created_at >= $${paramCount}`);
            values.push(startDate);
        }

        if (endDate) {
            paramCount++;
            whereConditions.push(`created_at <= $${paramCount}`);
            values.push(endDate);
        }

        const countQuery = `
            SELECT COUNT(*) as total
            FROM business_data 
            WHERE ${whereConditions.join(' AND ')};
        `;

        try {
            const client = await this.db.pool.connect();
            const result = await client.query(countQuery, values);
            client.release();
            return parseInt(result.rows[0].total);
        } catch (error) {
            console.error('Error getting user data count:', error);
            throw error;
        }
    }

    // Get user's data summary with aggregations
    async getUserDataSummary(userEmail, options = {}) {
        const {
            startDate = null,
            endDate = null
        } = options;

        let whereConditions = ['user_email = $1'];
        let values = [userEmail];
        let paramCount = 1;

        if (startDate) {
            paramCount++;
            whereConditions.push(`created_at >= $${paramCount}`);
            values.push(startDate);
        }

        if (endDate) {
            paramCount++;
            whereConditions.push(`created_at <= $${paramCount}`);
            values.push(endDate);
        }

        const summaryQuery = `
            SELECT 
                COUNT(*) as total_records,
                COUNT(DISTINCT city) as unique_cities,
                COUNT(DISTINCT keyword) as unique_keywords,
                COUNT(DISTINCT job_id) as unique_jobs,
                COUNT(DISTINCT sheet_id) as unique_sheets,
                COUNT(CASE WHEN phone IS NOT NULL AND phone != '' THEN 1 END) as records_with_phone,
                COUNT(CASE WHEN website IS NOT NULL AND website != '' THEN 1 END) as records_with_website,
                COUNT(CASE WHEN email IS NOT NULL AND email != '' THEN 1 END) as records_with_email,
                MIN(created_at) as first_record_date,
                MAX(created_at) as last_record_date
            FROM business_data 
            WHERE ${whereConditions.join(' AND ')};
        `;

        try {
            const client = await this.db.pool.connect();
            const result = await client.query(summaryQuery, values);
            client.release();
            return result.rows[0];
        } catch (error) {
            console.error('Error getting user data summary:', error);
            throw error;
        }
    }

    // Get user's data grouped by city
    async getUserDataByCity(userEmail, options = {}) {
        const {
            startDate = null,
            endDate = null,
            limit = 50
        } = options;

        let whereConditions = ['user_email = $1'];
        let values = [userEmail];
        let paramCount = 1;

        if (startDate) {
            paramCount++;
            whereConditions.push(`created_at >= $${paramCount}`);
            values.push(startDate);
        }

        if (endDate) {
            paramCount++;
            whereConditions.push(`created_at <= $${paramCount}`);
            values.push(endDate);
        }

        const cityQuery = `
            SELECT 
                city,
                COUNT(*) as record_count,
                COUNT(DISTINCT keyword) as unique_keywords,
                COUNT(CASE WHEN phone IS NOT NULL AND phone != '' THEN 1 END) as records_with_phone,
                COUNT(CASE WHEN website IS NOT NULL AND website != '' THEN 1 END) as records_with_website,
                COUNT(CASE WHEN email IS NOT NULL AND email != '' THEN 1 END) as records_with_email,
                MAX(created_at) as latest_record
            FROM business_data 
            WHERE ${whereConditions.join(' AND ')} AND city IS NOT NULL AND city != ''
            GROUP BY city
            ORDER BY record_count DESC
            LIMIT $${paramCount + 1};
        `;

        values.push(limit);

        try {
            const client = await this.db.pool.connect();
            const result = await client.query(cityQuery, values);
            client.release();
            return result.rows;
        } catch (error) {
            console.error('Error getting user data by city:', error);
            throw error;
        }
    }

    // Get user's data grouped by keyword
    async getUserDataByKeyword(userEmail, options = {}) {
        const {
            startDate = null,
            endDate = null,
            limit = 50
        } = options;

        let whereConditions = ['user_email = $1'];
        let values = [userEmail];
        let paramCount = 1;

        if (startDate) {
            paramCount++;
            whereConditions.push(`created_at >= $${paramCount}`);
            values.push(startDate);
        }

        if (endDate) {
            paramCount++;
            whereConditions.push(`created_at <= $${paramCount}`);
            values.push(endDate);
        }

        const keywordQuery = `
            SELECT 
                keyword,
                COUNT(*) as record_count,
                COUNT(DISTINCT city) as unique_cities,
                COUNT(CASE WHEN phone IS NOT NULL AND phone != '' THEN 1 END) as records_with_phone,
                COUNT(CASE WHEN website IS NOT NULL AND website != '' THEN 1 END) as records_with_website,
                COUNT(CASE WHEN email IS NOT NULL AND email != '' THEN 1 END) as records_with_email,
                MAX(created_at) as latest_record
            FROM business_data 
            WHERE ${whereConditions.join(' AND ')} AND keyword IS NOT NULL AND keyword != ''
            GROUP BY keyword
            ORDER BY record_count DESC
            LIMIT $${paramCount + 1};
        `;

        values.push(limit);

        try {
            const client = await this.db.pool.connect();
            const result = await client.query(keywordQuery, values);
            client.release();
            return result.rows;
        } catch (error) {
            console.error('Error getting user data by keyword:', error);
            throw error;
        }
    }

    // Get user's recent activity
    async getUserRecentActivity(userEmail, limit = 20) {
        const activityQuery = `
            SELECT 
                id, job_id, name, city, keyword, sheet_id, created_at
            FROM business_data 
            WHERE user_email = $1
            ORDER BY created_at DESC
            LIMIT $2;
        `;

        try {
            const client = await this.db.pool.connect();
            const result = await client.query(activityQuery, [userEmail, limit]);
            client.release();
            return result.rows;
        } catch (error) {
            console.error('Error getting user recent activity:', error);
            throw error;
        }
    }

    // Export user's data to CSV format (returns data array)
    async exportUserDataToCSV(userEmail, options = {}) {
        const data = await this.getAllUserData(userEmail, { ...options, limit: 10000 });
        
        // Convert to CSV-friendly format
        const csvData = data.map(row => ({
            'Business Name': row.name || '',
            'Address': row.address || '',
            'Phone': row.phone || '',
            'Website': row.website || '',
            'Email': row.email || '',
            'LinkedIn': row.linkedin || '',
            'Facebook': row.facebook || '',
            'Instagram': row.instagram || '',
            'Twitter': row.twitter || '',
            'YouTube': row.youtube || '',
            'TikTok': row.tiktok || '',
            'City': row.city || '',
            'Keyword': row.keyword || '',
            'Search Phrase': row.search_phrase || '',
            'Job ID': row.job_id || '',
            'Sheet ID': row.sheet_id || '',
            'Status': row.status || 'New',
            'Notes': row.notes || '',
            'Tags': row.tags || '',
            'Created Date': row.created_at ? new Date(row.created_at).toISOString().split('T')[0] : '',
            'Created Time': row.created_at ? new Date(row.created_at).toISOString() : ''
        }));

        return csvData;
    }
}

module.exports = UserDataService;
