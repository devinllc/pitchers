const express = require('express');
const router = express.Router();

// GET /api-docs endpoint - API documentation
router.get('/api-docs', (req, res) => {
    const documentation = {
        title: 'Local Business Scraper API',
        version: '1.0.0',
        description: 'API for generating local business leads using AI-powered search phrase generation and Google Maps data extraction',
        baseUrl: `http://localhost:${process.env.PORT || 3000}`,
        endpoints: {
            health: {
                method: 'GET',
                path: '/health',
                description: 'System health check and monitoring information',
                parameters: 'None',
                response: {
                    example: {
                        status: 'OK',
                        message: 'Local Business Scraper API is running',
                        timestamp: '2024-01-15T10:30:00.000Z',
                        uptime: 3600,
                        system: {
                            nodeVersion: 'v18.17.0',
                            platform: 'darwin',
                            memoryUsage: {
                                rss: 45678912,
                                heapTotal: 20971520,
                                heapUsed: 15728640,
                                external: 1048576
                            },
                            pid: 12345
                        },
                        api: {
                            keysConfigured: {
                                gemini: true,
                                googleMaps: true,
                                googleSheets: true
                            },
                            allKeysConfigured: true
                        },
                        jobs: {
                            active: 2,
                            total: 10,
                            completed: 7,
                            errors: 1,
                            isProcessing: true
                        }
                    }
                }
            },
            searchService: {
                method: 'POST',
                path: '/search-service',
                description: 'Start a new lead generation job for a specific city and business keyword',
                contentType: 'application/json',
                parameters: {
                    city: {
                        type: 'string',
                        required: true,
                        description: 'Target city for business search (2-100 characters, letters, spaces, hyphens, apostrophes, commas, periods only)',
                        example: 'Delhi'
                    },
                    keyword: {
                        type: 'string',
                        required: true,
                        description: 'Business type or service keyword (2-200 characters, alphanumeric, spaces, hyphens, apostrophes, commas, periods, ampersands only)',
                        example: 'bridal makeup artist'
                    }
                },
                requestExample: {
                    city: 'Delhi',
                    keyword: 'bridal makeup artist'
                },
                responses: {
                    success: {
                        status: 200,
                        example: {
                            jobId: 'job_1642248600000_abc123',
                            status: 'started',
                            message: 'Lead generation job initiated',
                            city: 'Delhi',
                            keyword: 'bridal makeup artist'
                        }
                    },
                    validationError: {
                        status: 400,
                        example: {
                            error: 'Validation failed',
                            details: [
                                'City is required',
                                'Keyword must be at least 2 characters long'
                            ],
                            message: 'Please provide valid city and keyword parameters',
                            timestamp: '2024-01-15T10:30:00.000Z'
                        }
                    },
                    serverError: {
                        status: 500,
                        example: {
                            error: 'Internal server error',
                            message: 'An unexpected error occurred while processing your request'
                        }
                    }
                }
            },
            jobStatus: {
                method: 'GET',
                path: '/status/:jobId',
                description: 'Get the status and progress of a specific job',
                parameters: {
                    jobId: {
                        type: 'string',
                        required: true,
                        description: 'Unique job identifier returned from /search-service',
                        example: 'job_1642248600000_abc123'
                    }
                },
                responses: {
                    success: {
                        status: 200,
                        example: {
                            jobId: 'job_1642248600000_abc123',
                            city: 'Delhi',
                            keyword: 'bridal makeup artist',
                            status: 'searching_maps',
                            progress: {
                                totalPhrases: 45,
                                processedPhrases: 12,
                                totalBusinesses: 156,
                                savedBusinesses: 89
                            },
                            createdAt: '2024-01-15T10:30:00.000Z',
                            updatedAt: '2024-01-15T10:35:00.000Z',
                            error: null
                        }
                    },
                    notFound: {
                        status: 404,
                        example: {
                            error: 'Job not found',
                            message: 'Job with ID job_1642248600000_abc123 was not found'
                        }
                    }
                }
            },
            activeJobs: {
                method: 'GET',
                path: '/status',
                description: 'Get all currently active jobs',
                parameters: 'None',
                response: {
                    example: {
                        activeJobs: [
                            {
                                jobId: 'job_1642248600000_abc123',
                                city: 'Delhi',
                                keyword: 'bridal makeup artist',
                                status: 'searching_maps',
                                progress: {
                                    totalPhrases: 45,
                                    processedPhrases: 12,
                                    totalBusinesses: 156,
                                    savedBusinesses: 89
                                }
                            }
                        ],
                        totalActiveJobs: 1
                    }
                }
            },
            allJobs: {
                method: 'GET',
                path: '/jobs',
                description: 'Get all jobs (active and completed)',
                parameters: 'None',
                response: {
                    example: {
                        jobs: [
                            {
                                jobId: 'job_1642248600000_abc123',
                                city: 'Delhi',
                                keyword: 'bridal makeup artist',
                                status: 'completed',
                                progress: {
                                    totalPhrases: 45,
                                    processedPhrases: 45,
                                    totalBusinesses: 234,
                                    savedBusinesses: 234
                                },
                                createdAt: '2024-01-15T10:30:00.000Z',
                                updatedAt: '2024-01-15T10:45:00.000Z',
                                error: null
                            }
                        ],
                        totalJobs: 1
                    }
                }
            },
            performance: {
                method: 'GET',
                path: '/performance',
                description: 'Get detailed performance metrics and monitoring data',
                parameters: 'None',
                response: {
                    example: {
                        performance: {
                            apiCalls: {
                                gemini: { count: 10, avgResponseTime: 1500, errors: 0 },
                                googleMapsSearch: { count: 45, avgResponseTime: 800, errors: 2 },
                                googlePlaceDetails: { count: 234, avgResponseTime: 600, errors: 5 },
                                googleSheets: { count: 229, avgResponseTime: 400, errors: 3 }
                            },
                            processing: {
                                jobsCompleted: 5,
                                avgJobDuration: 45000,
                                saveSuccessRate: 95
                            },
                            memoryUsageMB: { current: 85, peak: 120 },
                            uptimeHours: 2.5
                        },
                        streaming: {
                            isProcessing: false,
                            processedCount: 0,
                            batchSize: 5
                        },
                        timestamp: '2024-01-15T10:30:00.000Z'
                    }
                }
            },
            forceGarbageCollection: {
                method: 'POST',
                path: '/performance/gc',
                description: 'Force garbage collection to free memory',
                parameters: 'None',
                response: {
                    example: {
                        message: 'Garbage collection triggered',
                        timestamp: '2024-01-15T10:30:00.000Z'
                    }
                }
            },
            pauseJob: {
                method: 'POST',
                path: '/jobs/:jobId/pause',
                description: 'Pause a currently running job',
                parameters: {
                    jobId: {
                        type: 'string',
                        required: true,
                        description: 'Job ID to pause',
                        example: 'job_1642248600000_abc123'
                    }
                },
                response: {
                    example: {
                        success: true,
                        message: 'Job paused successfully',
                        timestamp: '2024-01-15T10:30:00.000Z'
                    }
                }
            },
            resumeJob: {
                method: 'POST',
                path: '/jobs/:jobId/resume',
                description: 'Resume a paused job',
                parameters: {
                    jobId: {
                        type: 'string',
                        required: true,
                        description: 'Job ID to resume',
                        example: 'job_1642248600000_abc123'
                    }
                },
                response: {
                    example: {
                        success: true,
                        message: 'Job resumed successfully',
                        timestamp: '2024-01-15T10:30:00.000Z'
                    }
                }
            },
            stopJob: {
                method: 'POST',
                path: '/jobs/:jobId/stop',
                description: 'Stop a running or paused job',
                parameters: {
                    jobId: {
                        type: 'string',
                        required: true,
                        description: 'Job ID to stop',
                        example: 'job_1642248600000_abc123'
                    }
                },
                response: {
                    example: {
                        success: true,
                        message: 'Job stop requested - will stop after current operation',
                        timestamp: '2024-01-15T10:30:00.000Z'
                    }
                }
            }
        },
        validationRules: {
            city: [
                'Required field',
                'Must be a string',
                'Cannot be empty',
                'Must be at least 2 characters long',
                'Must be less than 100 characters long',
                'Only letters, spaces, hyphens, apostrophes, commas, and periods are allowed'
            ],
            keyword: [
                'Required field',
                'Must be a string',
                'Cannot be empty',
                'Must be at least 2 characters long',
                'Must be less than 200 characters long',
                'Only letters, numbers, spaces, hyphens, apostrophes, commas, periods, and ampersands are allowed'
            ]
        },
        jobStatuses: {
            started: 'Job has been initiated and is queued for processing',
            generating_phrases: 'AI is generating search phrases from city and keyword',
            searching_maps: 'Searching Google Maps for businesses using generated phrases',
            extracting_details: 'Extracting detailed business information from Google Places',
            completed: 'Job completed successfully, all data saved to Google Sheets',
            error: 'Job encountered an error and could not complete'
        },
        rateLimiting: {
            description: 'All external API calls are rate limited with 2-second delays',
            googleMapsTextSearch: '2 seconds between requests',
            googlePlaceDetails: '2 seconds between requests',
            geminiAI: '2 seconds between requests'
        },
        dataFlow: [
            '1. User submits city and keyword via POST /search-service',
            '2. System validates input and creates job',
            '3. Gemini AI generates diverse search phrases',
            '4. Google Maps Text Search API called for each phrase',
            '5. Place IDs extracted from search results',
            '6. Google Place Details API called for each place ID',
            '7. Business data extracted and immediately saved to Google Sheets',
            '8. Process continues until all phrases are processed',
            '9. Job marked as completed'
        ]
    };

    res.json(documentation);
});

module.exports = router;

