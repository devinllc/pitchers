// Mock all services for error scenario testing BEFORE requiring
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

describe('Error Scenarios Integration Tests', () => {
    let processingService;
    let mockServices;

    beforeEach(() => {
        jest.clearAllMocks();

        mockServices = {
            gemini: {
                generateSearchPhrases: jest.fn(),
                validateSearchPhrases: jest.fn()
            },
            googleMaps: {
                searchWithPagination: jest.fn(),
                getPlaceDetails: jest.fn()
            },
            googleSheets: {
                appendRow: jest.fn(),
                testConnection: jest.fn()
            },
            database: {
                insertBusiness: jest.fn(),
                testConnection: jest.fn(),
                close: jest.fn()
            },
            rateLimiter: {
                delay: jest.fn().mockResolvedValue()
            },
            errorHandler: {
                logProgress: jest.fn(),
                logJobStatus: jest.fn(),
                logAndContinue: jest.fn(),
                logApiFailure: jest.fn(),
                logDataSaveFailure: jest.fn()
            },
            jobManager: {
                createJob: jest.fn().mockReturnValue({
                    jobId: 'job_test_123',
                    status: 'started',
                    city: 'Delhi',
                    keyword: 'restaurant'
                }),
                updateProgress: jest.fn(),
                updateCurrentPhrase: jest.fn(),
                updateBusinessProgress: jest.fn(),
                updateSaveStats: jest.fn(),
                addError: jest.fn(),
                completeJob: jest.fn(),
                failJob: jest.fn()
            }
        };

        GeminiService.mockImplementation(() => mockServices.gemini);
        GoogleMapsService.mockImplementation(() => mockServices.googleMaps);
        GoogleSheetsService.mockImplementation(() => mockServices.googleSheets);
        DatabaseService.mockImplementation(() => mockServices.database);

        processingService = new ProcessingService();

        // Override the actual service instances with our mocks
        processingService.geminiService = mockServices.gemini;
        processingService.googleMapsService = mockServices.googleMaps;
        processingService.googleSheetsService = mockServices.googleSheets;
        processingService.databaseService = mockServices.database;
        processingService.rateLimiter = mockServices.rateLimiter;
        processingService.errorHandler = mockServices.errorHandler;
        processingService.jobManager = mockServices.jobManager;
    });

    describe('AI Service Failures', () => {
        it('should handle Gemini API rate limiting', async () => {
            const rateLimitError = new Error('Rate limit exceeded');
            rateLimitError.response = { status: 429 };

            mockServices.gemini.generateSearchPhrases.mockRejectedValue(rateLimitError);

            await expect(processingService.processLeadGeneration('Delhi', 'restaurant'))
                .rejects.toThrow('Rate limit exceeded');

            expect(mockServices.jobManager.failJob).toHaveBeenCalledWith(
                'job_test_123',
                'Rate limit exceeded'
            );
        });

        it('should handle Gemini API authentication errors', async () => {
            const authError = new Error('Invalid API key');
            authError.response = { status: 401 };

            mockServices.gemini.generateSearchPhrases.mockRejectedValue(authError);

            await expect(processingService.processLeadGeneration('Delhi', 'restaurant'))
                .rejects.toThrow('Invalid API key');
        });

        it('should handle Gemini API returning empty results', async () => {
            mockServices.gemini.generateSearchPhrases.mockResolvedValue([]);
            mockServices.gemini.validateSearchPhrases.mockReturnValue([]);

            await expect(processingService.processLeadGeneration('Delhi', 'restaurant'))
                .rejects.toThrow('No valid search phrases generated');
        });

        it('should handle Gemini API returning invalid format', async () => {
            mockServices.gemini.generateSearchPhrases.mockResolvedValue(['valid phrase']);
            mockServices.gemini.validateSearchPhrases.mockReturnValue(['AB']); // Too short

            await expect(processingService.processLeadGeneration('Delhi', 'restaurant'))
                .rejects.toThrow('No valid search phrases generated');
        });
    });

    describe('Google Maps API Failures', () => {
        beforeEach(() => {
            mockServices.gemini.generateSearchPhrases.mockResolvedValue(['test phrase']);
            mockServices.gemini.validateSearchPhrases.mockReturnValue(['test phrase']);
        });

        it('should handle Google Maps API quota exceeded', async () => {
            mockServices.googleMaps.searchWithPagination.mockResolvedValue({
                place_ids: [],
                totalResults: 0,
                error: 'You have exceeded your daily request quota for this API'
            });

            const result = await processingService.processLeadGeneration('Delhi', 'restaurant');

            expect(result.success).toBe(true);
            expect(result.summary.totalBusinessesFound).toBe(0);
            expect(result.summary.totalErrors).toBe(0); // No error since it's handled gracefully
        });

        it('should handle Google Maps API network timeouts', async () => {
            const timeoutError = new Error('Request timeout');
            timeoutError.code = 'ECONNABORTED';

            mockServices.googleMaps.searchWithPagination.mockRejectedValue(timeoutError);

            const result = await processingService.processLeadGeneration('Delhi', 'restaurant');

            expect(result.success).toBe(true);
            expect(result.summary.totalErrors).toBeGreaterThan(0);
            expect(mockServices.jobManager.addError).toHaveBeenCalledWith(
                'job_test_123',
                expect.objectContaining({
                    step: 'google_maps_search',
                    error: 'Request timeout'
                })
            );
        });

        it('should handle Google Maps Place Details API failures', async () => {
            mockServices.googleMaps.searchWithPagination.mockResolvedValue({
                place_ids: ['place1', 'place2', 'place3'],
                totalResults: 3
            });

            // First succeeds, second fails, third succeeds
            mockServices.googleMaps.getPlaceDetails
                .mockResolvedValueOnce({ name: 'Business 1', address: '123 St' })
                .mockRejectedValueOnce(new Error('Place details not found'))
                .mockResolvedValueOnce({ name: 'Business 3', address: '789 St' });

            mockServices.database.insertBusiness.mockResolvedValue({ id: 1 });
            mockServices.googleSheets.appendRow.mockResolvedValue({ updatedRows: 1 });

            const result = await processingService.processLeadGeneration('Delhi', 'restaurant');

            expect(result.success).toBe(true);
            expect(result.summary.totalBusinessesSaved).toBe(2); // Only 2 succeeded
            expect(result.summary.totalErrors).toBeGreaterThan(0);
        });

        it('should handle Google Maps returning invalid place data', async () => {
            mockServices.googleMaps.searchWithPagination.mockResolvedValue({
                place_ids: ['invalid_place'],
                totalResults: 1
            });

            mockServices.googleMaps.getPlaceDetails.mockResolvedValue({
                name: '', // Empty name should be skipped
                address: '123 Test St'
            });

            const result = await processingService.processLeadGeneration('Delhi', 'restaurant');

            expect(result.success).toBe(true);
            expect(result.summary.totalBusinessesSaved).toBe(0);
            expect(mockServices.database.insertBusiness).not.toHaveBeenCalled();
        });
    });

    describe('Database Failures', () => {
        beforeEach(() => {
            mockServices.gemini.generateSearchPhrases.mockResolvedValue(['test phrase']);
            mockServices.gemini.validateSearchPhrases.mockReturnValue(['test phrase']);
            mockServices.googleMaps.searchWithPagination.mockResolvedValue({
                place_ids: ['place1'],
                totalResults: 1
            });
            mockServices.googleMaps.getPlaceDetails.mockResolvedValue({
                name: 'Test Business',
                address: '123 Test St'
            });
        });

        it('should handle database connection failures', async () => {
            const dbError = new Error('Connection to database failed');
            dbError.code = 'ECONNREFUSED';

            mockServices.database.insertBusiness.mockRejectedValue(dbError);
            mockServices.googleSheets.appendRow.mockResolvedValue({ updatedRows: 1 });

            const result = await processingService.processLeadGeneration('Delhi', 'restaurant');

            expect(result.success).toBe(true);
            expect(result.saveStatistics.partialSuccess).toBe(1); // Sheets succeeded, DB failed
            expect(mockServices.errorHandler.logDataSaveFailure).toHaveBeenCalled();
        });

        it('should handle database constraint violations', async () => {
            const constraintError = new Error('Duplicate key value violates unique constraint');
            constraintError.code = '23505';

            mockServices.database.insertBusiness.mockRejectedValue(constraintError);
            mockServices.googleSheets.appendRow.mockResolvedValue({ updatedRows: 1 });

            const result = await processingService.processLeadGeneration('Delhi', 'restaurant');

            expect(result.success).toBe(true);
            expect(result.saveStatistics.partialSuccess).toBe(1);
        });

        it('should handle database timeout errors', async () => {
            const timeoutError = new Error('Query timeout');
            timeoutError.code = 'QUERY_TIMEOUT';

            mockServices.database.insertBusiness.mockRejectedValue(timeoutError);
            mockServices.googleSheets.appendRow.mockResolvedValue({ updatedRows: 1 });

            const result = await processingService.processLeadGeneration('Delhi', 'restaurant');

            expect(result.success).toBe(true);
            expect(result.saveStatistics.partialSuccess).toBe(1);
        });
    });

    describe('Google Sheets Failures', () => {
        beforeEach(() => {
            mockServices.gemini.generateSearchPhrases.mockResolvedValue(['test phrase']);
            mockServices.gemini.validateSearchPhrases.mockReturnValue(['test phrase']);
            mockServices.googleMaps.searchWithPagination.mockResolvedValue({
                place_ids: ['place1'],
                totalResults: 1
            });
            mockServices.googleMaps.getPlaceDetails.mockResolvedValue({
                name: 'Test Business',
                address: '123 Test St'
            });
            mockServices.database.insertBusiness.mockResolvedValue({ id: 1 });
        });

        it('should handle Google Sheets API authentication errors', async () => {
            const authError = new Error('Invalid credentials');
            authError.code = 401;

            mockServices.googleSheets.appendRow.mockRejectedValue(authError);

            const result = await processingService.processLeadGeneration('Delhi', 'restaurant');

            expect(result.success).toBe(true);
            expect(result.saveStatistics.partialSuccess).toBe(1); // DB succeeded, Sheets failed
        });

        it('should handle Google Sheets API quota exceeded', async () => {
            const quotaError = new Error('Quota exceeded for quota metric');
            quotaError.code = 429;

            mockServices.googleSheets.appendRow.mockRejectedValue(quotaError);

            const result = await processingService.processLeadGeneration('Delhi', 'restaurant');

            expect(result.success).toBe(true);
            expect(result.saveStatistics.partialSuccess).toBe(1);
        });

        it('should handle Google Sheets spreadsheet not found', async () => {
            const notFoundError = new Error('Requested entity was not found');
            notFoundError.code = 404;

            mockServices.googleSheets.appendRow.mockRejectedValue(notFoundError);

            const result = await processingService.processLeadGeneration('Delhi', 'restaurant');

            expect(result.success).toBe(true);
            expect(result.saveStatistics.partialSuccess).toBe(1);
        });

        it('should handle Google Sheets permission errors', async () => {
            const permissionError = new Error('The caller does not have permission');
            permissionError.code = 403;

            mockServices.googleSheets.appendRow.mockRejectedValue(permissionError);

            const result = await processingService.processLeadGeneration('Delhi', 'restaurant');

            expect(result.success).toBe(true);
            expect(result.saveStatistics.partialSuccess).toBe(1);
        });
    });

    describe('Network and Infrastructure Failures', () => {
        beforeEach(() => {
            mockServices.gemini.generateSearchPhrases.mockResolvedValue(['test phrase']);
            mockServices.gemini.validateSearchPhrases.mockReturnValue(['test phrase']);
        });

        it('should handle complete network outage', async () => {
            const networkError = new Error('Network is unreachable');
            networkError.code = 'ENETUNREACH';

            mockServices.googleMaps.searchWithPagination.mockRejectedValue(networkError);

            const result = await processingService.processLeadGeneration('Delhi', 'restaurant');

            expect(result.success).toBe(true);
            expect(result.summary.totalBusinessesFound).toBe(0);
            expect(result.summary.totalErrors).toBeGreaterThan(0);
        });

        it('should handle DNS resolution failures', async () => {
            const dnsError = new Error('getaddrinfo ENOTFOUND');
            dnsError.code = 'ENOTFOUND';

            mockServices.googleMaps.searchWithPagination.mockRejectedValue(dnsError);

            const result = await processingService.processLeadGeneration('Delhi', 'restaurant');

            expect(result.success).toBe(true);
            expect(result.summary.totalErrors).toBeGreaterThan(0);
        });

        it('should handle SSL certificate errors', async () => {
            const sslError = new Error('certificate verify failed');
            sslError.code = 'CERT_UNTRUSTED';

            mockServices.googleMaps.searchWithPagination.mockRejectedValue(sslError);

            const result = await processingService.processLeadGeneration('Delhi', 'restaurant');

            expect(result.success).toBe(true);
            expect(result.summary.totalErrors).toBeGreaterThan(0);
        });
    });

    describe('Memory and Resource Constraints', () => {
        it('should handle out of memory errors gracefully', async () => {
            mockServices.gemini.generateSearchPhrases.mockResolvedValue(['test phrase']);
            mockServices.gemini.validateSearchPhrases.mockReturnValue(['test phrase']);
            mockServices.googleMaps.searchWithPagination.mockResolvedValue({
                place_ids: ['place1'],
                totalResults: 1
            });

            const memoryError = new Error('JavaScript heap out of memory');
            memoryError.code = 'ERR_OUT_OF_MEMORY';

            mockServices.googleMaps.getPlaceDetails.mockRejectedValue(memoryError);

            const result = await processingService.processLeadGeneration('Delhi', 'restaurant');

            expect(result.success).toBe(true);
            expect(result.summary.totalErrors).toBeGreaterThan(0);
        });

        it('should handle file system errors', async () => {
            mockServices.gemini.generateSearchPhrases.mockResolvedValue(['test phrase']);
            mockServices.gemini.validateSearchPhrases.mockReturnValue(['test phrase']);
            mockServices.googleMaps.searchWithPagination.mockResolvedValue({
                place_ids: ['place1'],
                totalResults: 1
            });
            mockServices.googleMaps.getPlaceDetails.mockResolvedValue({
                name: 'Test Business'
            });

            const fsError = new Error('ENOSPC: no space left on device');
            fsError.code = 'ENOSPC';

            mockServices.database.insertBusiness.mockRejectedValue(fsError);
            mockServices.googleSheets.appendRow.mockResolvedValue({ updatedRows: 1 });

            const result = await processingService.processLeadGeneration('Delhi', 'restaurant');

            expect(result.success).toBe(true);
            expect(result.saveStatistics.partialSuccess).toBe(1);
        });
    });

    describe('Cascading Failures', () => {
        it('should handle multiple service failures in sequence', async () => {
            // AI service succeeds
            mockServices.gemini.generateSearchPhrases.mockResolvedValue(['phrase1', 'phrase2']);
            mockServices.gemini.validateSearchPhrases.mockReturnValue(['phrase1', 'phrase2']);

            // First Maps call succeeds, second fails
            mockServices.googleMaps.searchWithPagination
                .mockResolvedValueOnce({
                    place_ids: ['place1'],
                    totalResults: 1
                })
                .mockRejectedValueOnce(new Error('Maps API failed'));

            // Place details succeeds
            mockServices.googleMaps.getPlaceDetails.mockResolvedValue({
                name: 'Test Business'
            });

            // Database fails, Sheets succeeds
            mockServices.database.insertBusiness.mockRejectedValue(new Error('DB failed'));
            mockServices.googleSheets.appendRow.mockResolvedValue({ updatedRows: 1 });

            const result = await processingService.processLeadGeneration('Delhi', 'restaurant');

            expect(result.success).toBe(true);
            expect(result.summary.totalPhrasesProcessed).toBe(2);
            expect(result.summary.totalBusinessesFound).toBe(1); // Only first phrase succeeded
            expect(result.summary.totalErrors).toBe(2); // Maps error + DB error
            expect(result.saveStatistics.partialSuccess).toBe(1); // Sheets succeeded, DB failed
        });

        it('should handle all services failing except AI', async () => {
            mockServices.gemini.generateSearchPhrases.mockResolvedValue(['test phrase']);
            mockServices.gemini.validateSearchPhrases.mockReturnValue(['test phrase']);

            // All other services fail
            mockServices.googleMaps.searchWithPagination.mockRejectedValue(new Error('Maps failed'));

            const result = await processingService.processLeadGeneration('Delhi', 'restaurant');

            expect(result.success).toBe(true);
            expect(result.summary.totalBusinessesFound).toBe(0);
            expect(result.summary.totalErrors).toBeGreaterThan(0);
        });
    });

    describe('Recovery and Resilience', () => {
        it('should recover from intermittent failures', async () => {
            mockServices.gemini.generateSearchPhrases.mockResolvedValue(['phrase1', 'phrase2', 'phrase3']);
            mockServices.gemini.validateSearchPhrases.mockReturnValue(['phrase1', 'phrase2', 'phrase3']);

            // Intermittent failures: fail, succeed, fail
            mockServices.googleMaps.searchWithPagination
                .mockRejectedValueOnce(new Error('Temporary failure'))
                .mockResolvedValueOnce({
                    place_ids: ['place1'],
                    totalResults: 1
                })
                .mockRejectedValueOnce(new Error('Another temporary failure'));

            mockServices.googleMaps.getPlaceDetails.mockResolvedValue({
                name: 'Test Business'
            });
            mockServices.database.insertBusiness.mockResolvedValue({ id: 1 });
            mockServices.googleSheets.appendRow.mockResolvedValue({ updatedRows: 1 });

            const result = await processingService.processLeadGeneration('Delhi', 'restaurant');

            expect(result.success).toBe(true);
            expect(result.summary.totalPhrasesProcessed).toBe(3);
            expect(result.summary.totalBusinessesFound).toBe(1); // Only middle phrase succeeded
            expect(result.summary.totalBusinessesSaved).toBe(1);
            expect(result.summary.totalErrors).toBe(2); // Two failures
        });

        it('should maintain data consistency despite partial failures', async () => {
            mockServices.gemini.generateSearchPhrases.mockResolvedValue(['test phrase']);
            mockServices.gemini.validateSearchPhrases.mockReturnValue(['test phrase']);
            mockServices.googleMaps.searchWithPagination.mockResolvedValue({
                place_ids: ['place1', 'place2'],
                totalResults: 2
            });

            const businessData1 = { name: 'Business 1', address: '123 St' };
            const businessData2 = { name: 'Business 2', address: '456 St' };

            mockServices.googleMaps.getPlaceDetails
                .mockResolvedValueOnce(businessData1)
                .mockResolvedValueOnce(businessData2);

            // First business: DB succeeds, Sheets fails
            // Second business: DB fails, Sheets succeeds
            mockServices.database.insertBusiness
                .mockResolvedValueOnce({ id: 1 })
                .mockRejectedValueOnce(new Error('DB error'));

            mockServices.googleSheets.appendRow
                .mockRejectedValueOnce(new Error('Sheets error'))
                .mockResolvedValueOnce({ updatedRows: 1 });

            const result = await processingService.processLeadGeneration('Delhi', 'restaurant');

            expect(result.success).toBe(true);
            expect(result.summary.totalBusinessesFound).toBe(2);
            expect(result.saveStatistics.partialSuccess).toBe(2); // Both had partial success
            expect(result.saveStatistics.bothSucceeded).toBe(0);
            expect(result.saveStatistics.bothFailed).toBe(0);
        });
    });
});