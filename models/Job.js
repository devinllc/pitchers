class Job {
    constructor(databaseService) {
        this.db = databaseService;
        if (!this.db || !this.db.pool) {
            console.error('Database service not properly initialized');
            throw new Error('Database service is required');
        }
    }

    // Create jobs table for persistent job tracking
    async createJobsTable() {
        let client;
        try {
            client = await this.db.pool.connect();
            
            // Check if table exists first to avoid race conditions with sequences
            const checkTableQuery = `
                SELECT EXISTS (
                    SELECT FROM information_schema.tables 
                    WHERE table_name = 'jobs'
                );
            `;
            const tableCheck = await client.query(checkTableQuery);
            
            if (!tableCheck.rows[0].exists) {
                console.log('Creating jobs table...');
                const createTableQuery = `
                    CREATE TABLE IF NOT EXISTS jobs (
                        id SERIAL PRIMARY KEY,
                        job_id VARCHAR(255) UNIQUE NOT NULL,
                        user_email VARCHAR(255),
                        city VARCHAR(255) NOT NULL,
                        keyword VARCHAR(255) NOT NULL,
                        method VARCHAR(50) DEFAULT 'api',
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
                await client.query('CREATE INDEX IF NOT EXISTS idx_jobs_job_id ON jobs(job_id);');
                await client.query('CREATE INDEX IF NOT EXISTS idx_jobs_user_email ON jobs(user_email);');
                await client.query('CREATE INDEX IF NOT EXISTS idx_jobs_status ON jobs(status);');
                await client.query('CREATE INDEX IF NOT EXISTS idx_jobs_created_at ON jobs(created_at);');
                console.log('Jobs table and indexes created successfully');
            } else {
                // Table exists, ensures indexes exist anyway (safe)
                await client.query('CREATE INDEX IF NOT EXISTS idx_jobs_job_id ON jobs(job_id);');
                await client.query('CREATE INDEX IF NOT EXISTS idx_jobs_user_email ON jobs(user_email);');
                // console.log('Jobs table already exists, skipping creation');
            }
            
            return true;
        } catch (error) {
            // Ignore "relation already exists" or "duplicate key" errors during concurrent startup
            if (error.code === '42P07' || error.code === '23505') {
                return true;
            }
            console.error('Error creating jobs table:', error);
            throw error;
        } finally {
            if (client) client.release();
        }
    }

    // Create a new job record
    async createJob(jobData) {
        const {
            jobId,
            userEmail,
            city,
            keyword,
            method = 'api',
            status = 'started'
        } = jobData;

        const insertQuery = `
            INSERT INTO jobs (job_id, user_email, city, keyword, method, status, progress, statistics)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
            RETURNING *;
        `;

        const progress = {
            totalPhrases: 0,
            processedPhrases: 0,
            totalBusinesses: 0,
            savedBusinesses: 0,
            currentStep: 'initializing'
        };

        const statistics = {
            saveStats: {
                postgresql: { success: 0, failed: 0 },
                googleSheets: { success: 0, failed: 0 },
                bothSucceeded: 0,
                bothFailed: 0,
                partialSuccess: 0
            },
            errors: []
        };

        const values = [
            jobId,
            userEmail,
            city,
            keyword,
            method,
            status,
            JSON.stringify(progress),
            JSON.stringify(statistics)
        ];

        try {
            const result = await this.db.pool.query(insertQuery, values);
            return result.rows[0];
        } catch (error) {
            console.error('Error creating job:', error);
            throw error;
        }
    }

    // Update job progress and status
    async updateJob(jobId, updates) {
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
            UPDATE jobs 
            SET ${updateFields.join(', ')}
            WHERE job_id = $${valueIndex}
            RETURNING *;
        `;

        values.push(jobId);

        try {
            const result = await this.db.pool.query(updateQuery, values);
            return result.rows[0];
        } catch (error) {
            console.error('Error updating job:', error);
            throw error;
        }
    }

    // Get job by ID
    async getJob(jobId) {
        const query = `
            SELECT * FROM jobs 
            WHERE job_id = $1
        `;

        try {
            const result = await this.db.pool.query(query, [jobId]);
            return result.rows[0];
        } catch (error) {
            console.error('Error getting job:', error);
            throw error;
        }
    }

    // Get all jobs for a user
    async getUserJobs(userEmail, limit = 50, offset = 0) {
        const query = `
            SELECT * FROM jobs 
            WHERE user_email = $1
            ORDER BY created_at DESC
            LIMIT $2 OFFSET $3
        `;

        try {
            const result = await this.db.pool.query(query, [userEmail, limit, offset]);
            return result.rows;
        } catch (error) {
            console.error('Error getting user jobs:', error);
            throw error;
        }
    }

    // Get active jobs
    async getActiveJobs() {
        const query = `
            SELECT * FROM jobs 
            WHERE status IN ('started', 'processing', 'paused')
            ORDER BY created_at DESC
        `;

        try {
            const result = await this.db.pool.query(query);
            return result.rows;
        } catch (error) {
            console.error('Error getting active jobs:', error);
            throw error;
        }
    }

    // Get all jobs with pagination
    async getAllJobs(limit = 50, offset = 0) {
        const query = `
            SELECT * FROM jobs 
            ORDER BY created_at DESC
            LIMIT $1 OFFSET $2
        `;

        try {
            const result = await this.db.pool.query(query, [limit, offset]);
            return result.rows;
        } catch (error) {
            console.error('Error getting all jobs:', error);
            throw error;
        }
    }

    // Get job statistics
    async getJobStatistics(userEmail = null) {
        let query;
        let values = [];

        if (userEmail) {
            query = `
                SELECT 
                    COUNT(*) as total_jobs,
                    COUNT(CASE WHEN status = 'completed' THEN 1 END) as completed_jobs,
                    COUNT(CASE WHEN status = 'failed' THEN 1 END) as failed_jobs,
                    COUNT(CASE WHEN status IN ('started', 'processing') THEN 1 END) as active_jobs,
                    AVG(EXTRACT(EPOCH FROM (end_time - start_time))) as avg_duration_seconds
                FROM jobs 
                WHERE user_email = $1
            `;
            values = [userEmail];
        } else {
            query = `
                SELECT 
                    COUNT(*) as total_jobs,
                    COUNT(CASE WHEN status = 'completed' THEN 1 END) as completed_jobs,
                    COUNT(CASE WHEN status = 'failed' THEN 1 END) as failed_jobs,
                    COUNT(CASE WHEN status IN ('started', 'processing') THEN 1 END) as active_jobs,
                    AVG(EXTRACT(EPOCH FROM (end_time - start_time))) as avg_duration_seconds
                FROM jobs
            `;
        }

        try {
            const result = await this.db.pool.query(query, values);
            return result.rows[0];
        } catch (error) {
            console.error('Error getting job statistics:', error);
            throw error;
        }
    }

    // Delete old completed jobs (cleanup)
    async cleanupOldJobs(daysToKeep = 30) {
        const query = `
            DELETE FROM jobs 
            WHERE status IN ('completed', 'failed') 
            AND created_at < NOW() - INTERVAL '${daysToKeep} days'
        `;

        try {
            const result = await this.db.pool.query(query);
            console.log(`Cleaned up ${result.rowCount} old jobs`);
            return result.rowCount;
        } catch (error) {
            console.error('Error cleaning up old jobs:', error);
            throw error;
        }
    }
}

module.exports = Job;
