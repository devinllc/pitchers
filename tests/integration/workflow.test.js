// Mock all external services BEFORE requiring
jest.mock('../../services/geminiService');
jest.mock('../../services/googleMapsService');
jest.mock('../../services/googleSheets');
jest.mock('../../services/database');
jest.mock('../../services/rateLimiter');
jest.mock('../../services/errorHandler');
jest.mock('../../services/jobManager');

const ProcessingService = require('../../services/processingService');
const GeminiService = require('../../services/geminiService');
const GoogleMapsService = require('../../services/googleMapsService');
const GoogleSheetsService = require('../../services/googleSheets');
const DatabaseService = require('../../services/database');

describe('ProcessingService Integration Tests', () => {
    let processingService;
    let mockGeminiService;
    let mockGoogleMapsService;
    let mockGoogleSheetsService;
    let mockDatabaseService;

    beforeEach(() => {
        jest.clearAllMocks();

        // Setup mocks
        mockGeminiService = {
            generateSearchPhrases: jest.fn(),
            validateSearchPhrases: jest.fn()
        };
        mockGoogleMapsService = {
            searchWithPagination: jest.fn(),
            getPlaceDetails: jest.fn()
        };
        mockGoogleSheetsService = {
            appendRow: jest.fn(),
            testConnection: jest.fn()
        };
        mockDatabaseService = {
            insertBusiness: jest.fn(),
            testConnection: jest.fn(),
            close: jest.fn()
        };

        // Mock constructors
        GeminiService.mockImplementation(() => mockGeminiService);
        GoogleMapsService.mockImplementation(() => mockGoogleMapsService);
        GoogleSheetsService.mockImplementation(() => mockGoogleSheetsService);
        DatabaseService.mockImplementation(() => mockDatabaseService);

        processingService = new ProcessingService();

        // Override the actual service instances with our mocks
        processingService.geminiService = mockGeminiService;
        processingService.googleMapsService = mockGoogleMapsService;
        processingService.googleSheetsService = mockGoogleSheetsService;
        processingService.databaseService = mockDatabaseService;
    });

    describe('Complete Workflow Integration', () => {
        it('should process complete workflow successfully', async () => {
            // Mock successful responses for each step
            mockGeminiService.generateSearchPhrases.mockResolvedValue([
                'Connaught Place restaurant',
                'Khan Market cafe'
            ]);
            mockGeminiService.validateSearchPhrases.mockReturnValue([
                'Connaught Place restaurant',
                'Khan Market cafe'
            ]);

            mockGoogleMapsService.searchWithPagination.mockResolvedValue({
                place_ids: ['place1', 'place2'],
                totalResults: 2,
                pagesProcessed: 1
            });

            mockGoogleMapsService.getPlaceDetails
                .mockResolvedValueOnce({
                    name: 'Test Restaurant 1',
                    address: '123 CP, Delhi',
                    phone: '+91 98765 43210',
                    website: 'https://restaurant1.com',
                    rating: 4.5,
                    totalReviews: 100,
                    openingHours: ['Monday: 9:00 AM – 10:00 PM']
                })
                .mockResolvedValueOnce({
                    name: 'Test Restaurant 2',
                    address: '456 KM, Delhi',
                    phone: '+91 98765 43211',
                    website: 'https://restaurant2.com',
                    rating: 4.2,
                    totalReviews: 80,
                    openingHours: ['Monday: 10:00 AM – 11:00 PM']
                });

            mockDatabaseService.insertBusiness.mockResolvedValue({
                id: 1,
                inserted: true,
                businessName: 'Test Restaurant',
                placeId: 'place1'
            });

            mockGoogleSheetsService.appendRow.mockResolvedValue({
                updatedRows: 1,
                businessName: 'Test Restaurant',
                timestamp: new Date().toISOString()
            });

            // Execute workflow
            const result = await processingService.processLeadGeneration('Delhi', 'restaurant');

            // Verify workflow completion
            expect(result.success).toBe(true);
            expect(result.summary.totalPhrasesProcessed).toBe(2);
            expect(result.summary.totalBusinessesFound).toBe(4); // 2 places per phrase
            expect(result.summary.totalBusinessesSaved).toBe(4);

            // Verify service calls
            expect(mockGeminiService.generateSearchPhrases).toHaveBeenCalledWith('Delhi', 'restaurant');
            expect(mockGoogleMapsService.searchWithPagination).toHaveBeenCalledTimes(2);
            expect(mockGoogleMapsService.getPlaceDetails).toHaveBeenCalledTimes(4);
            expect(mockDatabaseService.insertBusiness).toHaveBeenCalledTimes(4);
            expect(mockGoogleSheetsService.appendRow).toHaveBeenCalledTimes(4);
        });

        it('should handle partial failures gracefully', async () => {
            // Mock mixed success/failure responses
            mockGeminiService.generateSearchPhrases.mockResolvedValue([
                'Valid phrase',
                'Another phrase'
            ]);
            mockGeminiService.validateSearchPhrases.mockReturnValue([
                'Valid phrase',
                'Another phrase'
            ]);

            // First phrase succeeds, second fails
            mockGoogleMapsService.searchWithPagination
                .mockResolvedValueOnce({
                    place_ids: ['place1'],
                    totalResults: 1,
                    pagesProcessed: 1
                })
                .mockResolvedValueOnce({
                    place_ids: [],
                    totalResults: 0,
                    pagesProcessed: 0,
                    error: 'API error'
                });

            mockGoogleMapsService.getPlaceDetails.mockResolvedValue({
                name: 'Test Business',
                address: '123 Test St',
                phone: '+91 98765 43210',
                website: 'https://test.com'
            });

            // Database succeeds, Sheets fails
            mockDatabaseService.insertBusiness.mockResolvedValue({
                id: 1,
                inserted: true
            });
            mockGoogleSheetsService.appendRow.mockRejectedValue(new Error('Sheets API error'));

            const result = await processingService.processLeadGeneration('Delhi', 'restaurant');

            expect(result.success).toBe(true);
            expect(result.summary.totalPhrasesProcessed).toBe(2);
            expect(result.summary.totalBusinessesFound).toBe(1);
            expect(result.summary.totalErrors).toBeGreaterThan(0);
        });

        it('should handle complete AI service failure', async () => {
            mockGeminiService.generateSearchPhrases.mockRejectedValue(new Error('AI service unavailable'));

            await expect(processingService.processLeadGeneration('Delhi', 'restaurant'))
                .rejects.toThrow('AI service unavailable');

            expect(mockGoogleMapsService.searchWithPagination).not.toHaveBeenCalled();
        });

        it('should continue processing when individual business saves fail', async () => {
            mockGeminiService.generateSearchPhrases.mockResolvedValue(['Test phrase']);
            mockGeminiService.validateSearchPhrases.mockReturnValue(['Test phrase']);

            mockGoogleMapsService.searchWithPagination.mockResolvedValue({
                place_ids: ['place1', 'place2'],
                totalResults: 2,
                pagesProcessed: 1
            });

            mockGoogleMapsService.getPlaceDetails.mockResolvedValue({
                name: 'Test Business',
                address: '123 Test St',
                phone: '+91 98765 43210',
                website: 'https://test.com'
            });

            // First business save succeeds, second fails
            mockDatabaseService.insertBusiness
                .mockResolvedValueOnce({ id: 1, inserted: true })
                .mockRejectedValueOnce(new Error('Database error'));

            mockGoogleSheetsService.appendRow
                .mockResolvedValueOnce({ updatedRows: 1 })
                .mockRejectedValueOnce(new Error('Sheets error'));

            const result = await processingService.processLeadGeneration('Delhi', 'restaurant');

            expect(result.success).toBe(true);
            expect(result.summary.totalBusinessesFound).toBe(2);
            expect(result.summary.totalErrors).toBeGreaterThan(0);
        });
    });

    describe('Error Recovery and Continuation', () => {
        it('should continue processing after Google Maps API failures', async () => {
            mockGeminiService.generateSearchPhrases.mockResolvedValue([
                'Phrase 1',
                'Phrase 2',
                'Phrase 3'
            ]);
            mockGeminiService.validateSearchPhrases.mockReturnValue([
                'Phrase 1',
                'Phrase 2',
                'Phrase 3'
            ]);

            // Second phrase fails, others succeed
            mockGoogleMapsService.searchWithPagination
                .mockResolvedValueOnce({ place_ids: ['place1'], totalResults: 1 })
                .mockRejectedValueOnce(new Error('Maps API error'))
                .mockResolvedValueOnce({ place_ids: ['place3'], totalResults: 1 });

            mockGoogleMapsService.getPlaceDetails.mockResolvedValue({
                name: 'Test Business',
                address: '123 Test St'
            });

            mockDatabaseService.insertBusiness.mockResolvedValue({ id: 1 });
            mockGoogleSheetsService.appendRow.mockResolvedValue({ updatedRows: 1 });

            const result = await processingService.processLeadGeneration('Delhi', 'restaurant');

            expect(result.success).toBe(true);
            expect(result.summary.totalPhrasesProcessed).toBe(3);
            expect(result.summary.totalBusinessesFound).toBe(2); // Only 2 phrases succeeded
            expect(result.summary.totalErrors).toBeGreaterThan(0);
        });

        it('should handle place details API failures gracefully', async () => {
            mockGeminiService.generateSearchPhrases.mockResolvedValue(['Test phrase']);
            mockGeminiService.validateSearchPhrases.mockReturnValue(['Test phrase']);

            mockGoogleMapsService.searchWithPagination.mockResolvedValue({
                place_ids: ['place1', 'place2', 'place3'],
                totalResults: 3
            });

            // Second place details call fails
            mockGoogleMapsService.getPlaceDetails
                .mockResolvedValueOnce({ name: 'Business 1', address: '123 St' })
                .mockRejectedValueOnce(new Error('Place details error'))
                .mockResolvedValueOnce({ name: 'Business 3', address: '789 St' });

            mockDatabaseService.insertBusiness.mockResolvedValue({ id: 1 });
            mockGoogleSheetsService.appendRow.mockResolvedValue({ updatedRows: 1 });

            const result = await processingService.processLeadGeneration('Delhi', 'restaurant');

            expect(result.success).toBe(true);
            expect(result.summary.totalBusinessesSaved).toBe(2); // Only 2 succeeded
            expect(mockGoogleMapsService.getPlaceDetails).toHaveBeenCalledTimes(3);
        });
    });

    describe('Data Consistency and Streaming', () => {
        it('should save each business immediately after extraction', async () => {
            mockGeminiService.generateSearchPhrases.mockResolvedValue(['Test phrase']);
            mockGeminiService.validateSearchPhrases.mockReturnValue(['Test phrase']);

            mockGoogleMapsService.searchWithPagination.mockResolvedValue({
                place_ids: ['place1', 'place2'],
                totalResults: 2
            });

            const businessData1 = { name: 'Business 1', address: '123 St' };
            const businessData2 = { name: 'Business 2', address: '456 St' };

            mockGoogleMapsService.getPlaceDetails
                .mockResolvedValueOnce(businessData1)
                .mockResolvedValueOnce(businessData2);

            mockDatabaseService.insertBusiness.mockResolvedValue({ id: 1 });
            mockGoogleSheetsService.appendRow.mockResolvedValue({ updatedRows: 1 });

            await processingService.processLeadGeneration('Delhi', 'restaurant');

            // Verify that saves happen immediately after each business extraction
            expect(mockDatabaseService.insertBusiness).toHaveBeenNthCalledWith(1, {
                ...businessData1,
                placeId: 'place1',
                searchPhrase: 'Test phrase'
            });
            expect(mockGoogleSheetsService.appendRow).toHaveBeenNthCalledWith(1, {
                ...businessData1,
                placeId: 'place1',
                searchPhrase: 'Test phrase'
            });

            expect(mockDatabaseService.insertBusiness).toHaveBeenNthCalledWith(2, {
                ...businessData2,
                placeId: 'place2',
                searchPhrase: 'Test phrase'
            });
            expect(mockGoogleSheetsService.appendRow).toHaveBeenNthCalledWith(2, {
                ...businessData2,
                placeId: 'place2',
                searchPhrase: 'Test phrase'
            });
        });

        it('should track save statistics accurately', async () => {
            mockGeminiService.generateSearchPhrases.mockResolvedValue(['Test phrase']);
            mockGeminiService.validateSearchPhrases.mockReturnValue(['Test phrase']);

            mockGoogleMapsService.searchWithPagination.mockResolvedValue({
                place_ids: ['place1', 'place2', 'place3'],
                totalResults: 3
            });

            mockGoogleMapsService.getPlaceDetails.mockResolvedValue({
                name: 'Test Business',
                address: '123 Test St'
            });

            // Mixed save results
            mockDatabaseService.insertBusiness
                .mockResolvedValueOnce({ id: 1 }) // Success
                .mockRejectedValueOnce(new Error('DB error')) // Fail
                .mockResolvedValueOnce({ id: 3 }); // Success

            mockGoogleSheetsService.appendRow
                .mockResolvedValueOnce({ updatedRows: 1 }) // Success
                .mockResolvedValueOnce({ updatedRows: 1 }) // Success
                .mockRejectedValueOnce(new Error('Sheets error')); // Fail

            const result = await processingService.processLeadGeneration('Delhi', 'restaurant');

            expect(result.saveStatistics.bothSucceeded).toBe(1); // First business
            expect(result.saveStatistics.partialSuccess).toBe(2); // Second and third businesses
            expect(result.saveStatistics.bothFailed).toBe(0);
        });
    });

    describe('Job Management Integration', () => {
        it('should create and track job throughout workflow', async () => {
            mockGeminiService.generateSearchPhrases.mockResolvedValue(['Test phrase']);
            mockGeminiService.validateSearchPhrases.mockReturnValue(['Test phrase']);
            mockGoogleMapsService.searchWithPagination.mockResolvedValue({
                place_ids: ['place1'],
                totalResults: 1
            });
            mockGoogleMapsService.getPlaceDetails.mockResolvedValue({
                name: 'Test Business'
            });
            mockDatabaseService.insertBusiness.mockResolvedValue({ id: 1 });
            mockGoogleSheetsService.appendRow.mockResolvedValue({ updatedRows: 1 });

            await processingService.processLeadGeneration('Delhi', 'restaurant');

            const jobManager = processingService.getJobManager();
            const allJobs = jobManager.getAllJobs();

            expect(allJobs).toHaveLength(1);
            expect(allJobs[0].status).toBe('completed');
            expect(allJobs[0].city).toBe('Delhi');
            expect(allJobs[0].keyword).toBe('restaurant');
        });

        it('should prevent concurrent processing', async () => {
            mockGeminiService.generateSearchPhrases.mockImplementation(() =>
                new Promise(resolve => setTimeout(() => resolve(['Test phrase']), 100))
            );

            // Start first job
            const job1Promise = processingService.processLeadGeneration('Delhi', 'restaurant');

            // Try to start second job immediately
            await expect(processingService.processLeadGeneration('Mumbai', 'cafe'))
                .rejects.toThrow('Processing is already in progress');

            // Wait for first job to complete
            await job1Promise.catch(() => { }); // Ignore errors for this test
        });
    });

    describe('Service Initialization', () => {
        it('should initialize all services successfully', async () => {
            mockDatabaseService.testConnection.mockResolvedValue(true);
            mockGoogleSheetsService.testConnection.mockResolvedValue(true);

            const result = await processingService.initialize();

            expect(result).toBe(true);
            expect(mockDatabaseService.testConnection).toHaveBeenCalled();
            expect(mockGoogleSheetsService.testConnection).toHaveBeenCalled();
        });

        it('should handle initialization failures', async () => {
            mockDatabaseService.testConnection.mockRejectedValue(new Error('DB connection failed'));

            await expect(processingService.initialize())
                .rejects.toThrow('DB connection failed');
        });
    });

    describe('Cleanup', () => {
        it('should cleanup resources properly', async () => {
            await processingService.cleanup();

            expect(mockDatabaseService.close).toHaveBeenCalled();
        });

        it('should handle cleanup errors gracefully', async () => {
            mockDatabaseService.close.mockRejectedValue(new Error('Cleanup error'));

            // Should not throw
            await processingService.cleanup();

            expect(mockDatabaseService.close).toHaveBeenCalled();
        });
    });
});