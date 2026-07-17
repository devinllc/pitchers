const request = require('supertest');

// Mock ProcessingService BEFORE requiring server
jest.mock('../../services/processingService');

const app = require('../../server');
const ProcessingService = require('../../services/processingService');

describe('API Integration Tests', () => {
    let mockProcessingService;

    beforeEach(() => {
        jest.clearAllMocks();

        // Mock ProcessingService instance
        mockProcessingService = {
            processLeadGeneration: jest.fn(),
            getJobManager: jest.fn(),
            isProcessing: false,
            currentJob: null
        };

        // Mock JobManager
        const mockJobManager = {
            getJobStatus: jest.fn(),
            getActiveJobs: jest.fn(),
            getAllJobs: jest.fn()
        };

        mockProcessingService.getJobManager.mockReturnValue(mockJobManager);
        ProcessingService.mockImplementation(() => mockProcessingService);
    });

    describe('GET /health', () => {
        it('should return health status with all systems OK', async () => {
            mockProcessingService.getJobManager().getActiveJobs.mockReturnValue([]);
            mockProcessingService.getJobManager().getAllJobs.mockReturnValue([
                { status: 'completed' },
                { status: 'completed' },
                { status: 'error' }
            ]);

            const response = await request(app)
                .get('/health')
                .expect(200);

            expect(response.body).toMatchObject({
                status: expect.any(String),
                message: 'Local Business Scraper API is running',
                timestamp: expect.any(String),
                uptime: expect.any(Number),
                system: {
                    nodeVersion: expect.any(String),
                    platform: expect.any(String),
                    memoryUsage: expect.any(Object),
                    pid: expect.any(Number)
                },
                api: {
                    keysConfigured: expect.any(Object),
                    allKeysConfigured: expect.any(Boolean)
                },
                jobs: {
                    active: 0,
                    total: 3,
                    completed: 2,
                    errors: 1,
                    isProcessing: false
                },
                endpoints: expect.any(Array)
            });
        });

        it('should handle health check errors gracefully', async () => {
            mockProcessingService.getJobManager.mockImplementation(() => {
                throw new Error('JobManager error');
            });

            const response = await request(app)
                .get('/health')
                .expect(500);

            expect(response.body).toMatchObject({
                status: 'ERROR',
                message: 'Health check failed',
                error: 'JobManager error',
                timestamp: expect.any(String)
            });
        });
    });

    describe('POST /search-service', () => {
        const validRequest = {
            city: 'Delhi',
            keyword: 'restaurant'
        };

        it('should start lead generation successfully', async () => {
            const mockJobResult = {
                jobId: 'job_123456_abc',
                status: 'started',
                message: 'Lead generation job initiated',
                city: 'Delhi',
                keyword: 'restaurant'
            };

            mockProcessingService.currentJob = { jobId: 'job_123456_abc' };
            mockProcessingService.processLeadGeneration.mockResolvedValue({
                success: true,
                summary: { totalBusinessesSaved: 50 }
            });

            const response = await request(app)
                .post('/search-service')
                .send(validRequest)
                .expect(200);

            expect(response.body).toMatchObject({
                jobId: expect.stringMatching(/^job_\d+_[a-z0-9]+$/),
                status: 'started',
                message: 'Lead generation job initiated',
                city: 'Delhi',
                keyword: 'restaurant'
            });

            expect(mockProcessingService.processLeadGeneration)
                .toHaveBeenCalledWith('Delhi', 'restaurant');
        });

        it('should validate required fields', async () => {
            const response = await request(app)
                .post('/search-service')
                .send({})
                .expect(400);

            expect(response.body).toMatchObject({
                error: 'Validation failed',
                details: expect.arrayContaining([
                    'City is required',
                    'Keyword is required'
                ]),
                message: 'Please provide valid city and keyword parameters',
                timestamp: expect.any(String)
            });
        });

        it('should validate city field constraints', async () => {
            const testCases = [
                { city: '', keyword: 'restaurant', expectedError: 'City cannot be empty' },
                { city: 'A', keyword: 'restaurant', expectedError: 'City must be at least 2 characters long' },
                { city: 'A'.repeat(101), keyword: 'restaurant', expectedError: 'City must be less than 100 characters long' },
                { city: 'Delhi@123', keyword: 'restaurant', expectedError: 'City contains invalid characters' },
                { city: 123, keyword: 'restaurant', expectedError: 'City must be a string' }
            ];

            for (const testCase of testCases) {
                const response = await request(app)
                    .post('/search-service')
                    .send({ city: testCase.city, keyword: testCase.keyword })
                    .expect(400);

                expect(response.body.details).toContain(testCase.expectedError);
            }
        });

        it('should validate keyword field constraints', async () => {
            const testCases = [
                { city: 'Delhi', keyword: '', expectedError: 'Keyword cannot be empty' },
                { city: 'Delhi', keyword: 'A', expectedError: 'Keyword must be at least 2 characters long' },
                { city: 'Delhi', keyword: 'A'.repeat(201), expectedError: 'Keyword must be less than 200 characters long' },
                { city: 'Delhi', keyword: 'restaurant@#$', expectedError: 'Keyword contains invalid characters' },
                { city: 'Delhi', keyword: 123, expectedError: 'Keyword must be a string' }
            ];

            for (const testCase of testCases) {
                const response = await request(app)
                    .post('/search-service')
                    .send({ city: testCase.city, keyword: testCase.keyword })
                    .expect(400);

                expect(response.body.details).toContain(testCase.expectedError);
            }
        });

        it('should accept valid characters in city and keyword', async () => {
            const validCases = [
                { city: 'New Delhi', keyword: 'bridal makeup artist' },
                { city: "St. Mary's", keyword: 'restaurant & bar' },
                { city: 'Coimbatore-North', keyword: 'coffee shop' },
                { city: 'Chennai, Tamil Nadu', keyword: 'wedding photographer' }
            ];

            mockProcessingService.currentJob = { jobId: 'test_job' };
            mockProcessingService.processLeadGeneration.mockResolvedValue({ success: true });

            for (const testCase of validCases) {
                const response = await request(app)
                    .post('/search-service')
                    .send(testCase)
                    .expect(200);

                expect(response.body.status).toBe('started');
            }
        });

        it('should trim whitespace from inputs', async () => {
            mockProcessingService.currentJob = { jobId: 'test_job' };
            mockProcessingService.processLeadGeneration.mockResolvedValue({ success: true });

            const response = await request(app)
                .post('/search-service')
                .send({
                    city: '  Delhi  ',
                    keyword: '  restaurant  '
                })
                .expect(200);

            expect(mockProcessingService.processLeadGeneration)
                .toHaveBeenCalledWith('Delhi', 'restaurant');
        });

        it('should handle processing service errors', async () => {
            mockProcessingService.processLeadGeneration.mockRejectedValue(
                new Error('Processing failed')
            );

            const response = await request(app)
                .post('/search-service')
                .send(validRequest)
                .expect(200); // Still returns 200 as job is started asynchronously

            expect(response.body.status).toBe('started');
        });

        it('should handle unexpected server errors', async () => {
            mockProcessingService.processLeadGeneration.mockImplementation(() => {
                throw new Error('Unexpected error');
            });

            const response = await request(app)
                .post('/search-service')
                .send(validRequest)
                .expect(500);

            expect(response.body).toMatchObject({
                error: 'Internal server error',
                message: 'An unexpected error occurred while processing your request'
            });
        });
    });

    describe('GET /status/:jobId', () => {
        const mockJobStatus = {
            jobId: 'job_123456_abc',
            city: 'Delhi',
            keyword: 'restaurant',
            status: 'processing',
            progress: {
                totalPhrases: 45,
                processedPhrases: 12,
                totalBusinesses: 156,
                savedBusinesses: 89,
                phrasesProgress: 27,
                saveSuccessRate: 57
            },
            createdAt: new Date('2024-01-01T10:00:00Z'),
            updatedAt: new Date('2024-01-01T10:05:00Z'),
            error: null
        };

        it('should return job status successfully', async () => {
            mockProcessingService.getJobManager().getJobStatus.mockReturnValue(mockJobStatus);

            const response = await request(app)
                .get('/status/job_123456_abc')
                .expect(200);

            expect(response.body).toEqual(mockJobStatus);
            expect(mockProcessingService.getJobManager().getJobStatus)
                .toHaveBeenCalledWith('job_123456_abc');
        });

        it('should return 404 for non-existent job', async () => {
            mockProcessingService.getJobManager().getJobStatus.mockReturnValue(null);

            const response = await request(app)
                .get('/status/non_existent_job')
                .expect(404);

            expect(response.body).toMatchObject({
                error: 'Job not found',
                message: 'Job with ID non_existent_job was not found'
            });
        });

        it('should handle job manager errors', async () => {
            mockProcessingService.getJobManager().getJobStatus.mockImplementation(() => {
                throw new Error('JobManager error');
            });

            const response = await request(app)
                .get('/status/job_123456_abc')
                .expect(500);

            expect(response.body).toMatchObject({
                error: 'Internal server error',
                message: 'An unexpected error occurred while retrieving job status'
            });
        });
    });

    describe('GET /status', () => {
        const mockActiveJobs = [
            {
                jobId: 'job_123456_abc',
                city: 'Delhi',
                keyword: 'restaurant',
                status: 'processing',
                progress: { totalPhrases: 10, processedPhrases: 5 }
            },
            {
                jobId: 'job_789012_def',
                city: 'Mumbai',
                keyword: 'cafe',
                status: 'started',
                progress: { totalPhrases: 0, processedPhrases: 0 }
            }
        ];

        it('should return all active jobs', async () => {
            mockProcessingService.getJobManager().getActiveJobs.mockReturnValue(mockActiveJobs);

            const response = await request(app)
                .get('/status')
                .expect(200);

            expect(response.body).toEqual({
                activeJobs: mockActiveJobs,
                totalActiveJobs: 2
            });
        });

        it('should return empty array when no active jobs', async () => {
            mockProcessingService.getJobManager().getActiveJobs.mockReturnValue([]);

            const response = await request(app)
                .get('/status')
                .expect(200);

            expect(response.body).toEqual({
                activeJobs: [],
                totalActiveJobs: 0
            });
        });

        it('should handle job manager errors', async () => {
            mockProcessingService.getJobManager().getActiveJobs.mockImplementation(() => {
                throw new Error('JobManager error');
            });

            const response = await request(app)
                .get('/status')
                .expect(500);

            expect(response.body).toMatchObject({
                error: 'Internal server error',
                message: 'An unexpected error occurred while retrieving job statuses'
            });
        });
    });

    describe('GET /jobs', () => {
        const mockAllJobs = [
            {
                jobId: 'job_123456_abc',
                status: 'completed',
                city: 'Delhi',
                keyword: 'restaurant'
            },
            {
                jobId: 'job_789012_def',
                status: 'processing',
                city: 'Mumbai',
                keyword: 'cafe'
            },
            {
                jobId: 'job_345678_ghi',
                status: 'error',
                city: 'Bangalore',
                keyword: 'bakery'
            }
        ];

        it('should return all jobs', async () => {
            mockProcessingService.getJobManager().getAllJobs.mockReturnValue(mockAllJobs);

            const response = await request(app)
                .get('/jobs')
                .expect(200);

            expect(response.body).toEqual({
                jobs: mockAllJobs,
                totalJobs: 3
            });
        });

        it('should handle job manager errors', async () => {
            mockProcessingService.getJobManager().getAllJobs.mockImplementation(() => {
                throw new Error('JobManager error');
            });

            const response = await request(app)
                .get('/jobs')
                .expect(500);

            expect(response.body).toMatchObject({
                error: 'Internal server error',
                message: 'An unexpected error occurred while retrieving jobs'
            });
        });
    });

    describe('GET /api-docs', () => {
        it('should return comprehensive API documentation', async () => {
            const response = await request(app)
                .get('/api-docs')
                .expect(200);

            expect(response.body).toMatchObject({
                title: 'Local Business Scraper API',
                version: '1.0.0',
                description: expect.any(String),
                baseUrl: expect.stringContaining('localhost'),
                endpoints: {
                    health: expect.objectContaining({
                        method: 'GET',
                        path: '/health',
                        description: expect.any(String)
                    }),
                    searchService: expect.objectContaining({
                        method: 'POST',
                        path: '/search-service',
                        description: expect.any(String),
                        parameters: expect.objectContaining({
                            city: expect.objectContaining({
                                type: 'string',
                                required: true
                            }),
                            keyword: expect.objectContaining({
                                type: 'string',
                                required: true
                            })
                        })
                    }),
                    jobStatus: expect.objectContaining({
                        method: 'GET',
                        path: '/status/:jobId'
                    }),
                    activeJobs: expect.objectContaining({
                        method: 'GET',
                        path: '/status'
                    }),
                    allJobs: expect.objectContaining({
                        method: 'GET',
                        path: '/jobs'
                    })
                },
                validationRules: expect.objectContaining({
                    city: expect.any(Array),
                    keyword: expect.any(Array)
                }),
                jobStatuses: expect.any(Object),
                rateLimiting: expect.any(Object),
                dataFlow: expect.any(Array)
            });
        });
    });

    describe('Error Handling', () => {
        it('should handle 404 for undefined routes', async () => {
            const response = await request(app)
                .get('/non-existent-route')
                .expect(404);

            expect(response.body).toMatchObject({
                error: 'Not found',
                message: 'Route GET /non-existent-route not found'
            });
        });

        it('should handle POST to undefined routes', async () => {
            const response = await request(app)
                .post('/non-existent-route')
                .send({ data: 'test' })
                .expect(404);

            expect(response.body).toMatchObject({
                error: 'Not found',
                message: 'Route POST /non-existent-route not found'
            });
        });

        it('should handle malformed JSON in request body', async () => {
            const response = await request(app)
                .post('/search-service')
                .set('Content-Type', 'application/json')
                .send('{"invalid": json}')
                .expect(400);

            // Express handles malformed JSON automatically
        });
    });

    describe('Content-Type Handling', () => {
        it('should accept application/json content type', async () => {
            mockProcessingService.currentJob = { jobId: 'test_job' };
            mockProcessingService.processLeadGeneration.mockResolvedValue({ success: true });

            const response = await request(app)
                .post('/search-service')
                .set('Content-Type', 'application/json')
                .send(JSON.stringify({
                    city: 'Delhi',
                    keyword: 'restaurant'
                }))
                .expect(200);

            expect(response.body.status).toBe('started');
        });

        it('should handle missing content-type header', async () => {
            mockProcessingService.currentJob = { jobId: 'test_job' };
            mockProcessingService.processLeadGeneration.mockResolvedValue({ success: true });

            const response = await request(app)
                .post('/search-service')
                .send({
                    city: 'Delhi',
                    keyword: 'restaurant'
                })
                .expect(200);

            expect(response.body.status).toBe('started');
        });
    });

    describe('Concurrent Request Handling', () => {
        it('should handle multiple concurrent status requests', async () => {
            const mockStatus = {
                jobId: 'job_123',
                status: 'processing',
                progress: { totalPhrases: 10, processedPhrases: 5 }
            };

            mockProcessingService.getJobManager().getJobStatus.mockReturnValue(mockStatus);

            const requests = Array(5).fill().map(() =>
                request(app).get('/status/job_123')
            );

            const responses = await Promise.all(requests);

            responses.forEach(response => {
                expect(response.status).toBe(200);
                expect(response.body).toEqual(mockStatus);
            });

            expect(mockProcessingService.getJobManager().getJobStatus).toHaveBeenCalledTimes(5);
        });

        it('should handle concurrent health check requests', async () => {
            mockProcessingService.getJobManager().getActiveJobs.mockReturnValue([]);
            mockProcessingService.getJobManager().getAllJobs.mockReturnValue([]);

            const requests = Array(3).fill().map(() =>
                request(app).get('/health')
            );

            const responses = await Promise.all(requests);

            responses.forEach(response => {
                expect(response.status).toBe(200);
                expect(response.body.status).toMatch(/OK|WARNING/);
            });
        });
    });
});