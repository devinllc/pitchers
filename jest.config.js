module.exports = {
    // Test environment
    testEnvironment: 'node',

    // Test file patterns
    testMatch: [
        '**/tests/**/*.test.js'
    ],

    // Coverage configuration
    collectCoverage: true,
    collectCoverageFrom: [
        'services/**/*.js',
        'server.js',
        '!services/.gitkeep',
        '!**/node_modules/**',
        '!**/tests/**'
    ],
    coverageDirectory: 'coverage',
    coverageReporters: [
        'text',
        'lcov',
        'html'
    ],
    coverageThreshold: {
        global: {
            branches: 50,
            functions: 50,
            lines: 50,
            statements: 50
        }
    },

    // Setup and teardown
    setupFilesAfterEnv: ['<rootDir>/tests/setup.js'],

    // Module path mapping
    moduleNameMapper: {
        '^@/(.*)$': '<rootDir>/$1'
    },

    // Test timeout
    testTimeout: 30000,

    // Verbose output
    verbose: true,

    // Clear mocks between tests
    clearMocks: true,
    restoreMocks: true,

    // Error handling
    errorOnDeprecated: true,

    // Test organization
    displayName: 'Local Business Scraper Tests',

    // Ignore patterns
    testPathIgnorePatterns: [
        '/node_modules/',
        '/coverage/'
    ],

    // Transform configuration (if needed for ES modules)
    transform: {},

    // Global variables available in tests
    globals: {
        'process.env.NODE_ENV': 'test'
    }
};