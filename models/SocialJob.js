class SocialJob {
    constructor(databaseService) {
        this.db = databaseService;
        if (!this.db || !this.db.pool) {
            console.error('Database service not properly initialized in SocialJob model');
            throw new Error('Database service is required');
        }
    }

    // Create social_jobs table for persistent B2C/C2C job tracking
    async createSocialJobsTable() {
        let client;
        try {
            client = await this.db.pool.connect();
            
            const createTableQuery = `
                CREATE TABLE IF NOT EXISTS social_jobs (
                    id SERIAL PRIMARY KEY,
                    job_id VARCHAR(255) UNIQUE NOT NULL,
                    user_email VARCHAR(255) NOT NULL,
                    platform VARCHAR(50) NOT NULL,
                    segment VARCHAR(10) NOT NULL,
                    search_type VARCHAR(50) NOT NULL,
                    search_value VARCHAR(255) NOT NULL,
                    status VARCHAR(50) NOT NULL DEFAULT 'started',
                    progress JSONB DEFAULT '{}',
                    statistics JSONB DEFAULT '{}',
                    error_message TEXT,
                    start_time TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    end_time TIMESTAMP,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                );
            `;
            await client.query(createTableQuery);

            // Create indexes
            await client.query('CREATE INDEX IF NOT EXISTS idx_social_jobs_job_id ON social_jobs(job_id);');
            await client.query('CREATE INDEX IF NOT EXISTS idx_social_jobs_user ON social_jobs(user_email);');
            await client.query('CREATE INDEX IF NOT EXISTS idx_social_jobs_platform ON social_jobs(platform);');
            await client.query('CREATE INDEX IF NOT EXISTS idx_social_jobs_segment ON social_jobs(segment);');
            
            return true;
        } catch (error) {
            if (error.code === '42P07' || error.code === '23505') {
                return true;
            }
            console.error('Error creating social_jobs table:', error);
            throw error;
        } finally {
            if (client) client.release();
        }
    }

    // Create a new social job record
    async createSocialJob(jobData) {
        const {
            jobId,
            userEmail,
            platform,
            segment,
            searchType,
            searchValue,
            status = 'started'
        } = jobData;

        const insertQuery = `
            INSERT INTO social_jobs (job_id, user_email, platform, segment, search_type, search_value, status, progress, statistics)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
            RETURNING *;
        `;

        const progress = {
            total: 0,
            processed: 0,
            currentStep: 'initializing'
        };

        const statistics = {
            saved: 0,
            failed: 0,
            errors: []
        };

        const values = [
            jobId,
            userEmail,
            platform,
            segment,
            searchType,
            searchValue,
            status,
            JSON.stringify(progress),
            JSON.stringify(statistics)
        ];

        try {
            const result = await this.db.pool.query(insertQuery, values);
            return result.rows[0];
        } catch (error) {
            console.error('Error creating social job:', error);
            throw error;
        }
    }

    // Update social job progress and status
    async updateSocialJob(jobId, updates) {
        const updateFields = [];
        const values = [];
        let valueIndex = 1;

        if (updates.status !== undefined) {
            updateFields.push(`status = $${valueIndex++}`);
            values.push(updates.status);
        }

        if (updates.progress !== undefined) {
            updateFields.push(`progress = $${valueIndex++}`);
            values.push(JSON.stringify(updates.progress));
        }

        if (updates.statistics !== undefined) {
            updateFields.push(`statistics = $${valueIndex++}`);
            values.push(JSON.stringify(updates.statistics));
        }

        if (updates.error_message !== undefined) {
            updateFields.push(`error_message = $${valueIndex++}`);
            values.push(updates.error_message);
        }

        if (updates.end_time !== undefined) {
            updateFields.push(`end_time = $${valueIndex++}`);
            values.push(updates.end_time);
        }

        updateFields.push(`updated_at = CURRENT_TIMESTAMP`);

        const updateQuery = `
            UPDATE social_jobs 
            SET ${updateFields.join(', ')}
            WHERE job_id = $${valueIndex}
            RETURNING *;
        `;

        values.push(jobId);

        try {
            const result = await this.db.pool.query(updateQuery, values);
            return result.rows[0];
        } catch (error) {
            console.error('Error updating social job:', error);
            throw error;
        }
    }

    // Get social job by ID
    async getSocialJob(jobId) {
        const query = `
            SELECT * FROM social_jobs 
            WHERE job_id = $1
        `;

        try {
            const result = await this.db.pool.query(query, [jobId]);
            return result.rows[0];
        } catch (error) {
            console.error('Error getting social job:', error);
            throw error;
        }
    }

    // Get all social jobs for a user
    async getUserSocialJobs(userEmail, limit = 50, offset = 0) {
        const query = `
            SELECT * FROM social_jobs 
            WHERE user_email = $1
            ORDER BY created_at DESC
            LIMIT $2 OFFSET $3
        `;

        try {
            const result = await this.db.pool.query(query, [userEmail, limit, offset]);
            return result.rows;
        } catch (error) {
            console.error('Error getting user social jobs:', error);
            throw error;
        }
    }

    // Get active social jobs
    async getActiveSocialJobs() {
        const query = `
            SELECT * FROM social_jobs 
            WHERE status IN ('started', 'processing', 'paused')
            ORDER BY created_at DESC
        `;

        try {
            const result = await this.db.pool.query(query);
            return result.rows;
        } catch (error) {
            console.error('Error getting active social jobs:', error);
            throw error;
        }
    }

    // Get all social jobs
    async getAllSocialJobs(limit = 50, offset = 0) {
        const query = `
            SELECT * FROM social_jobs 
            ORDER BY created_at DESC
            LIMIT $1 OFFSET $2
        `;

        try {
            const result = await this.db.pool.query(query, [limit, offset]);
            return result.rows;
        } catch (error) {
            console.error('Error getting all social jobs:', error);
            throw error;
        }
    }
}

module.exports = SocialJob;
