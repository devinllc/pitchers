// Global test setup file
// This file runs before each test file

// Set test environment variables
process.env.NODE_ENV = 'test';
process.env.GEMINI_API_KEY = 'test-gemini-key';
process.env.GOOGLE_MAPS_API_KEY = 'test-maps-key';
process.env.GOOGLE_SHEETS_SPREADSHEET_ID = 'test-spreadsheet-id';
process.env.GOOGLE_SHEETS_CREDENTIALS_PATH = './test-credentials.json';
process.env.DATABASE_URL = 'postgresql://test:test@localhost:5432/testdb';
process.env.DB_HOST = 'localhost';
process.env.DB_PORT = '5432';
process.env.DB_NAME = 'testdb';
process.env.DB_USER = 'testuser';
process.env.DB_PASSWORD = 'testpass';
process.env.PORT = '3001'; // Different port for tests

// Global test utilities
global.testUtils = {
    // Helper to create mock business data
    createMockBusinessData: (overrides = {}) => ({
        name: 'Test Business',
        address: '123 Test Street, Delhi, India',
        phone: '+91 98765 43210',
        website: 'https://testbusiness.com',
        rating: 4.5,
        totalReviews: 150,
        openingHours: ['Monday: 9:00 AM – 6:00 PM'],
        placeId: 'test_place_id_123',
        searchPhrase: 'Delhi restaurant',
        ...overrides
    }),

    // Helper to create mock job data
    createMockJob: (overrides = {}) => ({
        jobId: 'job_123456_abc',
        city: 'Delhi',
        keyword: 'restaurant',
        status: 'started',
        progress: {
            totalPhrases: 0,
            processedPhrases: 0,
            currentPhrase: null,
            totalBusinesses: 0,
            savedBusinesses: 0,
            currentStep: 'initializing'
        },
        statistics: {
            saveStats: {
                postgresql: { success: 0, failed: 0 },
                googleSheets: { success: 0, failed: 0 },
                bothSucceeded: 0,
                bothFailed: 0,
                partialSuccess: 0
            },
            errors: []
        },
        createdAt: new Date('2024-01-01T10:00:00Z'),
        updatedAt: new Date('2024-01-01T10:00:00Z'),
        error: null,
        ...overrides
    }),

    // Helper to create mock API responses
    createMockApiResponse: (data, status = 200) => ({
        data,
        status,
        statusText: status === 200 ? 'OK' : 'Error',
        headers: {},
        config: {}
    }),

    // Helper to create mock errors with specific properties
    createMockError: (message, code, statusCode) => {
        const error = new Error(message);
        if (code) error.code = code;
        if (statusCode) {
            error.response = { status: statusCode };
        }
        return error;
    },

    // Helper to wait for async operations in tests
    waitFor: (ms) => new Promise(resolve => setTimeout(resolve, ms)),

    // Helper to create mock search phrases
    createMockSearchPhrases: (count = 5) => {
        const phrases = [];
        for (let i = 1; i <= count; i++) {
            phrases.push(`Test Location ${i} restaurant`);
        }
        return phrases;
    },

    // Helper to create mock place IDs
    createMockPlaceIds: (count = 3) => {
        const placeIds = [];
        for (let i = 1; i <= count; i++) {
            placeIds.push(`place_id_${i}_${Math.random().toString(36).substring(2, 9)}`);
        }
        return placeIds;
    }
};

// Global test constants
global.testConstants = {
    VALID_CITIES: ['Delhi', 'Mumbai', 'Bangalore', 'Chennai', 'Kolkata'],
    VALID_KEYWORDS: ['restaurant', 'cafe', 'bakery', 'hotel', 'shop'],
    INVALID_CITIES: ['', 'A', 'A'.repeat(101), 'Delhi@123', null, undefined, 123],
    INVALID_KEYWORDS: ['', 'A', 'A'.repeat(201), 'restaurant@#$', null, undefined, 123],

    API_ENDPOINTS: {
        HEALTH: '/health',
        SEARCH_SERVICE: '/search-service',
        JOB_STATUS: '/status/:jobId',
        ACTIVE_JOBS: '/status',
        ALL_JOBS: '/jobs',
        API_DOCS: '/api-docs'
    },

    HTTP_STATUS: {
        OK: 200,
        BAD_REQUEST: 400,
        NOT_FOUND: 404,
        INTERNAL_SERVER_ERROR: 500
    },

    JOB_STATUSES: {
        STARTED: 'started',
        GENERATING_PHRASES: 'generating_phrases',
        SEARCHING_MAPS: 'searching_maps',
        EXTRACTING_DETAILS: 'extracting_details',
        COMPLETED: 'completed',
        ERROR: 'error'
    }
};

// Mock console methods to reduce noise in tests (can be overridden in individual tests)
const originalConsole = { ...console };
global.mockConsole = () => {
    console.log = jest.fn();
    console.error = jest.fn();
    console.warn = jest.fn();
    console.info = jest.fn();
};

global.restoreConsole = () => {
    console.log = originalConsole.log;
    console.error = originalConsole.error;
    console.warn = originalConsole.warn;
    console.info = originalConsole.info;
};

// Global beforeEach and afterEach for common setup/teardown
beforeEach(() => {
    // Reset environment variables for each test
    process.env.NODE_ENV = 'test';

    // Mock console methods to reduce noise
    mockConsole();

    // Clear any timers
    jest.clearAllTimers();
});

afterEach(() => {
    // Restore console if it was mocked
    restoreConsole();

    // Clear any remaining timers
    jest.clearAllTimers();
});

// Global error handler for unhandled promise rejections in tests
process.on('unhandledRejection', (reason, promise) => {
    console.error('Unhandled Rejection at:', promise, 'reason:', reason);
});

// Increase timeout for integration tests
jest.setTimeout(30000);