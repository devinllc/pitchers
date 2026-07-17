// Mock all dependencies BEFORE requiring ProcessingService
jest.mock('../../../services/geminiService');
jest.mock('../../../services/googleMapsService');
jest.mock('../../../services/googleSheets');
jest.mock('../../../services/database');
jest.mock('../../../services/rateLimiter');
jest.mock('../../../services/errorHandler');
jest.mock('../../../services/jobManager');

const ProcessingService = require('../../../services/processingService');

const GeminiService = require('../../../services/geminiService');
const GoogleMapsService = require('../../../services/googleMapsService');
const GoogleSheetsService = require('../../../services/googleSheets');
const DatabaseService = require('../../../services/database');
const RateLimiter = require('../../../services/rateLimiter');
const ErrorHandler = require('../../../services/errorHandler');
const JobManager = require('../../../services/jobManager');

describe('ProcessingService', () => {
    let processingService;
    let mockServices;

    beforeEach(() => {
        jest.clearAllMocks();

        // Setup mock services
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
                logAndContinue: jest.fn()
            },
            jobManager: {
                createJob: jest.fn(),
                updateProgress: jest.fn(),
                updateCurrentPhrase: jest.fn(),
                updateBusinessProgress: jest.fn(),
                updateSaveStats: jest.fn(),
                addError: jest.fn(),
                completeJob: jest.fn(),
                failJob: jest.fn()
            }
        };

        // Mock constructors
        GeminiService.mockImplementation(() => mockServices.gemini);
        GoogleMapsService.mockImplementation(() => mockServices.googleMaps);
        GoogleSheetsService.mockImplementation(() => mockServices.googleSheets);
        DatabaseService.mockImplementation(() => mockServices.database);
        RateLimiter.mockImplementation(() => mockServices.rateLimiter);
        ErrorHandler.mockImplementation(() => mockServices.errorHandler);
        JobManager.mockImplementation(() => mockServices.jobManager);

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

    describe('constructor', () => {
        it('should initialize all services', () => {
            expect(GeminiService).toHaveBeenCalled();
            expect(GoogleMapsService).toHaveBeenCalled();
            expect(GoogleSheetsService).toHaveBeenCalled();
            expect(DatabaseService).toHaveBeenCalled();
            expect(RateLimiter).toHaveBeenCalled();
            expect(ErrorHandler).toHaveBeenCalled();
            expect(JobManager).toHaveBeenCalled();
        });

        it('should initialize processing state', () => {
            expect(processingService.isProcessing).toBe(false);
            expect(processingService.currentJob).toBeNull();
            expect(processingService.stats).toEqual({
                totalPhrases: 0,
                processedPhrases: 0,
                totalBusinesses: 0,
                savedBusinesses: 0,
                saveStats: {
                    postgresql: { success: 0, failed: 0 },
                    googleSheets: { success: 0, failed: 0 },
                    bothSucceeded: 0,
                    bothFailed: 0,
                    partialSuccess: 0
                },
                errors: []
            });
        });
    });

    describe('processLeadGeneration', () => {
        const mockJobInfo = {
            jobId: 'job_123456_abc',
            status: 'started',
            message: 'Lead generation job initiated',
            city: 'Delhi',
            keyword: 'restaurant'
        };

        beforeEach(() => {
            mockServices.jobManager.createJob.mockReturnValue(mockJobInfo);
        });

        it('should prevent concurrent processing', async () => {
            processingService.isProcessing = true;

            await expect(processingService.processLeadGeneration('Delhi', 'restaurant'))
                .rejects.toThrow('Processing is already in progress');

            expect(mockServices.jobManager.failJob).toHaveBeenCalledWith(
                mockJobInfo.jobId,
                'Processing is already in progress. Please wait for current job to complete.'
            );
        });

        it('should complete full workflow successfully', async () => {
            const mockSearchPhrases = ['Connaught Place restaurant', 'Khan Market cafe'];
            const mockPlaceIds = ['place1', 'place2'];
            const mockBusinessData = {
                name: 'Test Restaurant',
                address: '123 Test St',
                phone: '+91 98765 43210',
                website: 'https://test.com'
            };

            mockServices.gemini.generateSearchPhrases.mockResolvedValue(mockSearchPhrases);
            mockServices.gemini.validateSearchPhrases.mockReturnValue(mockSearchPhrases);
            mockServices.googleMaps.searchWithPagination.mockResolvedValue({
                place_ids: mockPlaceIds,
                totalResults: 2,
                pagesProcessed: 1
            });
            mockServices.googleMaps.getPlaceDetails.mockResolvedValue(mockBusinessData);
            mockServices.database.insertBusiness.mockResolvedValue({ id: 1, inserted: true });
            mockServices.googleSheets.appendRow.mockResolvedValue({ updatedRows: 1 });

            const result = await processingService.processLeadGeneration('Delhi', 'restaurant');

            expect(result.success).toBe(true);
            expect(result.summary.totalPhrasesProcessed).toBe(2);
            expect(result.summary.totalBusinessesFound).toBe(4); // 2 places per phrase
            expect(result.summary.totalBusinessesSaved).toBe(4);

            expect(mockServices.jobManager.createJob).toHaveBeenCalledWith('Delhi', 'restaurant');
            expect(mockServices.jobManager.completeJob).toHaveBeenCalled();
            expect(mockServices.errorHandler.logJobStatus).toHaveBeenCalledWith(
                mockJobInfo.jobId,
                'completed',
                expect.any(Object)
            );
        });

        it('should handle AI service failures', async () => {
            mockServices.gemini.generateSearchPhrases.mockRejectedValue(new Error('AI service failed'));

            await expect(processingService.processLeadGeneration('Delhi', 'restaurant'))
                .rejects.toThrow('AI service failed');

            expect(mockServices.jobManager.failJob).toHaveBeenCalledWith(
                mockJobInfo.jobId,
                'AI service failed'
            );
            expect(mockServices.errorHandler.logJobStatus).toHaveBeenCalledWith(
                mockJobInfo.jobId,
                'failed',
                expect.any(Object)
            );
        });

        it('should reset processing state after completion', async () => {
            mockServices.gemini.generateSearchPhrases.mockResolvedValue(['test phrase']);
            mockServices.gemini.validateSearchPhrases.mockReturnValue(['test phrase']);
            mockServices.googleMaps.searchWithPagination.mockResolvedValue({
                place_ids: [],
                totalResults: 0
            });

            await processingService.processLeadGeneration('Delhi', 'restaurant');

            expect(processingService.isProcessing).toBe(false);
            expect(processingService.currentJob).toBeNull();
        });

        it('should reset processing state after error', async () => {
            mockServices.gemini.generateSearchPhrases.mockRejectedValue(new Error('Test error'));

            try {
                await processingService.processLeadGeneration('Delhi', 'restaurant');
            } catch (error) {
                // Expected to throw
            }

            expect(processingService.isProcessing).toBe(false);
            expect(processingService.currentJob).toBeNull();
        });
    });

    describe('generateSearchPhrases', () => {
        it('should generate and validate search phrases', async () => {
            const mockPhrases = ['Delhi restaurant', 'Mumbai cafe'];
            const mockValidatedPhrases = ['Delhi restaurant', 'Mumbai cafe'];

            mockServices.gemini.generateSearchPhrases.mockResolvedValue(mockPhrases);
            mockServices.gemini.validateSearchPhrases.mockReturnValue(mockValidatedPhrases);

            const result = await processingService.generateSearchPhrases('Delhi', 'restaurant', 'job_123');

            expect(result).toEqual(mockValidatedPhrases);
            expect(mockServices.gemini.generateSearchPhrases).toHaveBeenCalledWith('Delhi', 'restaurant');
            expect(mockServices.gemini.validateSearchPhrases).toHaveBeenCalledWith(mockPhrases);
        });

        it('should handle empty validated phrases', async () => {
            mockServices.gemini.generateSearchPhrases.mockResolvedValue(['test phrase']);
            mockServices.gemini.validateSearchPhrases.mockReturnValue([]);

            await expect(processingService.generateSearchPhrases('Delhi', 'restaurant', 'job_123'))
                .rejects.toThrow('No valid search phrases generated');
        });

        it('should track errors in stats', async () => {
            mockServices.gemini.generateSearchPhrases.mockRejectedValue(new Error('AI error'));

            try {
                await processingService.generateSearchPhrases('Delhi', 'restaurant', 'job_123');
            } catch (error) {
                // Expected to throw
            }

            expect(processingService.stats.errors).toHaveLength(1);
            expect(processingService.stats.errors[0]).toMatchObject({
                step: 'generate_phrases',
                error: 'AI error',
                timestamp: expect.any(String)
            });
        });
    });

    describe('processSearchPhrases', () => {
        const mockPhrases = ['Phrase 1', 'Phrase 2'];

        beforeEach(() => {
            mockServices.googleMaps.searchWithPagination.mockResolvedValue({
                place_ids: ['place1'],
                totalResults: 1
            });
            mockServices.googleMaps.getPlaceDetails.mockResolvedValue({
                name: 'Test Business'
            });
            mockServices.database.insertBusiness.mockResolvedValue({ id: 1 });
            mockServices.googleSheets.appendRow.mockResolvedValue({ updatedRows: 1 });
        });

        it('should process all phrases sequentially', async () => {
            await processingService.processSearchPhrases(mockPhrases, 'job_123');

            expect(mockServices.jobManager.updateCurrentPhrase).toHaveBeenCalledTimes(2);
            expect(mockServices.jobManager.updateCurrentPhrase).toHaveBeenNthCalledWith(
                1, 'job_123', 'Phrase 1', 0, 2
            );
            expect(mockServices.jobManager.updateCurrentPhrase).toHaveBeenNthCalledWith(
                2, 'job_123', 'Phrase 2', 1, 2
            );

            expect(mockServices.rateLimiter.delay).toHaveBeenCalledTimes(1); // Only between phrases
            expect(processingService.stats.processedPhrases).toBe(2);
        });

        it('should continue processing after phrase failures', async () => {
            mockServices.googleMaps.searchWithPagination
                .mockResolvedValueOnce({ place_ids: ['place1'], totalResults: 1 })
                .mockRejectedValueOnce(new Error('Maps API error'));

            await processingService.processSearchPhrases(mockPhrases, 'job_123');

            expect(processingService.stats.processedPhrases).toBe(2);
            expect(processingService.stats.errors).toHaveLength(1);
            expect(mockServices.jobManager.addError).toHaveBeenCalledWith(
                'job_123',
                expect.objectContaining({
                    step: 'process_phrase',
                    phrase: 'Phrase 2',
                    error: 'Maps API error'
                })
            );
        });

        it('should skip phrases with no results', async () => {
            mockServices.googleMaps.searchWithPagination.mockResolvedValue({
                place_ids: [],
                totalResults: 0
            });

            await processingService.processSearchPhrases(['Empty phrase'], 'job_123');

            expect(mockServices.googleMaps.getPlaceDetails).not.toHaveBeenCalled();
            expect(processingService.stats.processedPhrases).toBe(1);
        });
    });

    describe('searchGoogleMaps', () => {
        it('should search with pagination successfully', async () => {
            const mockResult = {
                place_ids: ['place1', 'place2'],
                totalResults: 2,
                pagesProcessed: 1
            };

            mockServices.googleMaps.searchWithPagination.mockResolvedValue(mockResult);

            const result = await processingService.searchGoogleMaps('test phrase', 'job_123');

            expect(result).toEqual(['place1', 'place2']);
            expect(mockServices.googleMaps.searchWithPagination).toHaveBeenCalledWith('test phrase', 3);
        });

        it('should handle search errors gracefully', async () => {
            mockServices.googleMaps.searchWithPagination.mockRejectedValue(new Error('Search failed'));

            const result = await processingService.searchGoogleMaps('test phrase', 'job_123');

            expect(result).toEqual([]);
            expect(processingService.stats.errors).toHaveLength(1);
            expect(mockServices.jobManager.addError).toHaveBeenCalled();
        });

        it('should handle API error responses', async () => {
            mockServices.googleMaps.searchWithPagination.mockResolvedValue({
                place_ids: [],
                totalResults: 0,
                error: 'API quota exceeded'
            });

            const result = await processingService.searchGoogleMaps('test phrase', 'job_123');

            expect(result).toEqual([]);
        });
    });

    describe('processPlaceIds', () => {
        const mockPlaceIds = ['place1', 'place2'];
        const mockBusinessData = {
            name: 'Test Business',
            address: '123 Test St',
            phone: '+91 98765 43210'
        };

        beforeEach(() => {
            mockServices.googleMaps.getPlaceDetails.mockResolvedValue(mockBusinessData);
            mockServices.database.insertBusiness.mockResolvedValue({ id: 1 });
            mockServices.googleSheets.appendRow.mockResolvedValue({ updatedRows: 1 });
        });

        it('should process all place IDs', async () => {
            await processingService.processPlaceIds(mockPlaceIds, 'test phrase', 'job_123');

            expect(mockServices.googleMaps.getPlaceDetails).toHaveBeenCalledTimes(2);
            expect(mockServices.googleMaps.getPlaceDetails).toHaveBeenNthCalledWith(1, 'place1');
            expect(mockServices.googleMaps.getPlaceDetails).toHaveBeenNthCalledWith(2, 'place2');

            expect(processingService.stats.totalBusinesses).toBe(2);
            expect(processingService.stats.savedBusinesses).toBe(2);
        });

        it('should skip places with no valid business data', async () => {
            mockServices.googleMaps.getPlaceDetails.mockResolvedValue({ name: '' });

            await processingService.processPlaceIds(['place1'], 'test phrase', 'job_123');

            expect(mockServices.database.insertBusiness).not.toHaveBeenCalled();
            expect(mockServices.googleSheets.appendRow).not.toHaveBeenCalled();
            expect(processingService.stats.totalBusinesses).toBe(0);
        });

        it('should continue processing after individual failures', async () => {
            mockServices.googleMaps.getPlaceDetails
                .mockResolvedValueOnce(mockBusinessData)
                .mockRejectedValueOnce(new Error('Place details failed'));

            await processingService.processPlaceIds(mockPlaceIds, 'test phrase', 'job_123');

            expect(processingService.stats.totalBusinesses).toBe(1);
            expect(processingService.stats.errors).toHaveLength(1);
            expect(mockServices.jobManager.addError).toHaveBeenCalledWith(
                'job_123',
                expect.objectContaining({
                    step: 'process_place_id',
                    placeId: 'place2',
                    error: 'Place details failed'
                })
            );
        });

        it('should add metadata to business data', async () => {
            await processingService.processPlaceIds(['place1'], 'test phrase', 'job_123');

            expect(mockServices.database.insertBusiness).toHaveBeenCalledWith({
                ...mockBusinessData,
                placeId: 'place1',
                searchPhrase: 'test phrase'
            });
        });
    });

    describe('saveBusinessData', () => {
        const mockBusinessData = {
            name: 'Test Business',
            address: '123 Test St',
            placeId: 'place1'
        };

        it('should save to both destinations successfully', async () => {
            mockServices.database.insertBusiness.mockResolvedValue({ id: 1 });
            mockServices.googleSheets.appendRow.mockResolvedValue({ updatedRows: 1 });

            const result = await processingService.saveBusinessData(mockBusinessData, 'job_123');

            expect(result).toEqual({
                postgresql: { success: true, error: null },
                googleSheets: { success: true, error: null }
            });

            expect(mockServices.jobManager.updateSaveStats).toHaveBeenCalledWith('job_123', result);
        });

        it('should handle partial save failures', async () => {
            mockServices.database.insertBusiness.mockResolvedValue({ id: 1 });
            mockServices.googleSheets.appendRow.mockRejectedValue(new Error('Sheets error'));

            const result = await processingService.saveBusinessData(mockBusinessData, 'job_123');

            expect(result.postgresql.success).toBe(true);
            expect(result.googleSheets.success).toBe(false);
            expect(result.googleSheets.error).toBe('Sheets error');

            expect(processingService.stats.errors).toHaveLength(1);
            expect(mockServices.jobManager.addError).toHaveBeenCalled();
        });

        it('should handle both save failures', async () => {
            mockServices.database.insertBusiness.mockRejectedValue(new Error('DB error'));
            mockServices.googleSheets.appendRow.mockRejectedValue(new Error('Sheets error'));

            const result = await processingService.saveBusinessData(mockBusinessData, 'job_123');

            expect(result.postgresql.success).toBe(false);
            expect(result.googleSheets.success).toBe(false);
            expect(processingService.stats.errors).toHaveLength(2);
        });

        it('should handle coordination errors gracefully', async () => {
            // Mock Promise.allSettled to throw (unlikely but possible)
            const originalAllSettled = Promise.allSettled;
            Promise.allSettled = jest.fn().mockRejectedValue(new Error('Coordination error'));

            const result = await processingService.saveBusinessData(mockBusinessData, 'job_123');

            expect(result.postgresql.success).toBe(false);
            expect(result.googleSheets.success).toBe(false);
            expect(processingService.stats.errors).toHaveLength(1);

            Promise.allSettled = originalAllSettled;
        });
    });

    describe('updateSaveStatistics', () => {
        it('should update statistics for both successful', () => {
            const saveResults = {
                postgresql: { success: true },
                googleSheets: { success: true }
            };

            processingService.updateSaveStatistics(saveResults);

            expect(processingService.stats.saveStats.postgresql.success).toBe(1);
            expect(processingService.stats.saveStats.googleSheets.success).toBe(1);
            expect(processingService.stats.saveStats.bothSucceeded).toBe(1);
        });

        it('should update statistics for both failed', () => {
            const saveResults = {
                postgresql: { success: false },
                googleSheets: { success: false }
            };

            processingService.updateSaveStatistics(saveResults);

            expect(processingService.stats.saveStats.postgresql.failed).toBe(1);
            expect(processingService.stats.saveStats.googleSheets.failed).toBe(1);
            expect(processingService.stats.saveStats.bothFailed).toBe(1);
        });

        it('should update statistics for partial success', () => {
            const saveResults = {
                postgresql: { success: true },
                googleSheets: { success: false }
            };

            processingService.updateSaveStatistics(saveResults);

            expect(processingService.stats.saveStats.postgresql.success).toBe(1);
            expect(processingService.stats.saveStats.googleSheets.failed).toBe(1);
            expect(processingService.stats.saveStats.partialSuccess).toBe(1);
        });
    });

    describe('getProcessingStatus', () => {
        it('should return current processing status', () => {
            processingService.isProcessing = true;
            processingService.currentJob = { jobId: 'job_123', city: 'Delhi' };
            processingService.stats.totalPhrases = 10;
            processingService.stats.processedPhrases = 5;
            processingService.stats.totalBusinesses = 20;
            processingService.stats.savedBusinesses = 15;

            const status = processingService.getProcessingStatus();

            expect(status).toEqual({
                isProcessing: true,
                currentJob: { jobId: 'job_123', city: 'Delhi' },
                stats: processingService.stats,
                progress: {
                    phrasesProgress: 50,
                    businessesFound: 20,
                    businessesSaved: 15,
                    errorCount: 0
                }
            });
        });
    });

    describe('getProcessingResults', () => {
        it('should return comprehensive processing results', () => {
            processingService.stats = {
                processedPhrases: 10,
                totalPhrases: 10,
                totalBusinesses: 50,
                savedBusinesses: 45,
                errors: [{ error: 'test error' }],
                saveStats: {
                    postgresql: { success: 40, failed: 5 },
                    googleSheets: { success: 35, failed: 10 },
                    bothSucceeded: 30,
                    bothFailed: 5,
                    partialSuccess: 10
                }
            };

            const results = processingService.getProcessingResults();

            expect(results).toEqual({
                success: true,
                summary: {
                    totalPhrasesProcessed: 10,
                    totalPhrasesGenerated: 10,
                    totalBusinessesFound: 50,
                    totalBusinessesSaved: 45,
                    totalErrors: 1,
                    saveEfficiency: {
                        postgresqlSuccessRate: 80, // 40/50 * 100
                        googleSheetsSuccessRate: 70, // 35/50 * 100
                        bothDestinationsRate: 60 // 30/50 * 100
                    }
                },
                saveStatistics: processingService.stats.saveStats,
                stats: processingService.stats,
                completedAt: expect.any(String)
            });
        });
    });

    describe('initialize', () => {
        it('should initialize all services successfully', async () => {
            mockServices.database.testConnection.mockResolvedValue(true);
            mockServices.googleSheets.testConnection.mockResolvedValue(true);

            const result = await processingService.initialize();

            expect(result).toBe(true);
            expect(mockServices.database.testConnection).toHaveBeenCalled();
            expect(mockServices.googleSheets.testConnection).toHaveBeenCalled();
        });

        it('should handle initialization failures', async () => {
            mockServices.database.testConnection.mockRejectedValue(new Error('DB init failed'));

            await expect(processingService.initialize()).rejects.toThrow('DB init failed');
        });
    });

    describe('cleanup', () => {
        it('should cleanup resources successfully', async () => {
            await processingService.cleanup();

            expect(mockServices.database.close).toHaveBeenCalled();
        });

        it('should handle cleanup errors gracefully', async () => {
            mockServices.database.close.mockRejectedValue(new Error('Cleanup failed'));

            // Should not throw
            await processingService.cleanup();

            expect(mockServices.database.close).toHaveBeenCalled();
        });
    });

    describe('resetStats', () => {
        it('should reset all statistics to initial state', () => {
            // Modify stats
            processingService.stats.totalPhrases = 10;
            processingService.stats.savedBusinesses = 5;
            processingService.stats.errors = [{ error: 'test' }];

            processingService.resetStats();

            expect(processingService.stats).toEqual({
                totalPhrases: 0,
                processedPhrases: 0,
                totalBusinesses: 0,
                savedBusinesses: 0,
                saveStats: {
                    postgresql: { success: 0, failed: 0 },
                    googleSheets: { success: 0, failed: 0 },
                    bothSucceeded: 0,
                    bothFailed: 0,
                    partialSuccess: 0
                },
                errors: []
            });
        });
    });

    describe('getJobManager', () => {
        it('should return job manager instance', () => {
            const jobManager = processingService.getJobManager();
            expect(jobManager).toBe(mockServices.jobManager);
        });
    });
});