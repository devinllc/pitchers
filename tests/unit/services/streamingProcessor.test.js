const StreamingProcessor = require('../../../services/streamingProcessor');

describe('StreamingProcessor', () => {
    let streamingProcessor;

    beforeEach(() => {
        streamingProcessor = new StreamingProcessor(3); // Small batch size for testing
    });

    describe('Basic Functionality', () => {
        test('should initialize with correct batch size', () => {
            expect(streamingProcessor.batchSize).toBe(3);
            expect(streamingProcessor.processedCount).toBe(0);
            expect(streamingProcessor.errorCount).toBe(0);
            expect(streamingProcessor.isProcessing).toBe(false);
        });

        test('should get current status', () => {
            const status = streamingProcessor.getStatus();

            expect(status).toEqual({
                isProcessing: false,
                processedCount: 0,
                errorCount: 0,
                batchSize: 3
            });
        });

        test('should set batch size within valid range', () => {
            streamingProcessor.setBatchSize(10);
            expect(streamingProcessor.batchSize).toBe(10);
        });

        test('should reject invalid batch sizes', () => {
            const consoleSpy = jest.spyOn(console, 'warn').mockImplementation();

            streamingProcessor.setBatchSize(0);
            expect(streamingProcessor.batchSize).toBe(3); // Should remain unchanged

            streamingProcessor.setBatchSize(101);
            expect(streamingProcessor.batchSize).toBe(3); // Should remain unchanged

            expect(consoleSpy).toHaveBeenCalledTimes(2);
            consoleSpy.mockRestore();
        });
    });

    describe('Stream Processing', () => {
        test('should process items in batches successfully', async () => {
            const items = ['item1', 'item2', 'item3', 'item4', 'item5'];
            const processor = jest.fn().mockImplementation(async (item, index) => {
                return `processed_${item}_${index}`;
            });
            const onProgress = jest.fn();

            const result = await streamingProcessor.processStream(items, processor, onProgress);

            expect(result.success).toBe(true);
            expect(result.processed).toBe(5);
            expect(result.total).toBe(5);
            expect(result.errors).toBe(0);
            expect(result.results).toHaveLength(5);
            expect(result.successRate).toBe(100);

            expect(processor).toHaveBeenCalledTimes(5);
            expect(onProgress).toHaveBeenCalled();
        });

        test('should handle processing errors gracefully', async () => {
            const items = ['item1', 'item2', 'item3'];
            const processor = jest.fn().mockImplementation(async (item, index) => {
                if (item === 'item2') {
                    throw new Error('Processing failed');
                }
                return `processed_${item}`;
            });

            const result = await streamingProcessor.processStream(items, processor);

            expect(result.success).toBe(true);
            expect(result.processed).toBe(2); // item1 and item3 processed successfully
            expect(result.errors).toBe(1); // item2 failed
            expect(result.results).toHaveLength(2);
            expect(result.errorDetails).toHaveLength(1);
            expect(result.errorDetails[0].error).toBe('Processing failed');
        });

        test('should prevent concurrent processing', async () => {
            const items = ['item1', 'item2'];
            const processor = jest.fn().mockImplementation(async (item) => {
                await new Promise(resolve => setTimeout(resolve, 100));
                return `processed_${item}`;
            });

            // Start first processing
            const firstProcessing = streamingProcessor.processStream(items, processor);

            // Try to start second processing while first is running
            await expect(
                streamingProcessor.processStream(items, processor)
            ).rejects.toThrow('StreamingProcessor is already processing');

            // Wait for first processing to complete
            await firstProcessing;
        });

        test('should call progress callback with correct data', async () => {
            const items = ['item1', 'item2', 'item3', 'item4'];
            const processor = jest.fn().mockImplementation(async (item) => `processed_${item}`);
            const onProgress = jest.fn();

            await streamingProcessor.processStream(items, processor, onProgress);

            expect(onProgress).toHaveBeenCalled();
            const lastCall = onProgress.mock.calls[onProgress.mock.calls.length - 1][0];

            expect(lastCall).toEqual({
                processed: 4,
                total: 4,
                errors: 0,
                progress: 100,
                currentBatch: 2, // 4 items with batch size 3 = 2 batches
                totalBatches: 2
            });
        });
    });

    describe('Place IDs Stream Processing', () => {
        test('should process place IDs with details and save', async () => {
            const placeIds = ['place1', 'place2', 'place3'];
            const detailsProcessor = jest.fn().mockImplementation(async (placeId) => ({
                name: `Business ${placeId}`,
                phone: '123-456-7890',
                placeId
            }));
            const saveProcessor = jest.fn().mockImplementation(async (businessData) => ({
                postgresql: { success: true },
                googleSheets: { success: true }
            }));
            const onProgress = jest.fn();

            const result = await streamingProcessor.processPlaceIdsStream(
                placeIds,
                detailsProcessor,
                saveProcessor,
                onProgress
            );

            expect(result.success).toBe(true);
            expect(result.processed).toBe(3);
            expect(detailsProcessor).toHaveBeenCalledTimes(3);
            expect(saveProcessor).toHaveBeenCalledTimes(3);
            expect(onProgress).toHaveBeenCalled();
        });

        test('should handle place IDs with no valid business data', async () => {
            const placeIds = ['place1', 'place2'];
            const detailsProcessor = jest.fn().mockImplementation(async (placeId) => {
                if (placeId === 'place2') {
                    return null; // No valid business data
                }
                return { name: `Business ${placeId}`, placeId };
            });
            const saveProcessor = jest.fn().mockImplementation(async (businessData) => ({
                postgresql: { success: true },
                googleSheets: { success: true }
            }));

            const result = await streamingProcessor.processPlaceIdsStream(
                placeIds,
                detailsProcessor,
                saveProcessor
            );

            expect(result.processed).toBe(1); // Only place1 processed successfully
            expect(result.errors).toBe(1); // place2 failed
            expect(saveProcessor).toHaveBeenCalledTimes(1); // Only called for place1
        });
    });

    describe('Phrases Stream Processing', () => {
        test('should process search phrases and collect place IDs', async () => {
            const phrases = ['phrase1', 'phrase2', 'phrase3'];
            const searchProcessor = jest.fn().mockImplementation(async (phrase) => ({
                place_ids: [`${phrase}_place1`, `${phrase}_place2`]
            }));
            const onProgress = jest.fn();

            const result = await streamingProcessor.processPhrasesStream(
                phrases,
                searchProcessor,
                onProgress
            );

            expect(result.success).toBe(true);
            expect(result.processed).toBe(3);
            expect(result.allPlaceIds).toHaveLength(6); // 3 phrases × 2 place IDs each
            expect(result.totalPlaceIds).toBe(6);
            expect(searchProcessor).toHaveBeenCalledTimes(3);
        });

        test('should remove duplicate place IDs across phrases', async () => {
            const phrases = ['phrase1', 'phrase2'];
            const searchProcessor = jest.fn().mockImplementation(async (phrase) => ({
                place_ids: ['duplicate_place', 'unique_place_' + phrase]
            }));

            const result = await streamingProcessor.processPhrasesStream(
                phrases,
                searchProcessor
            );

            expect(result.allPlaceIds).toHaveLength(3); // 1 duplicate + 2 unique
            expect(result.duplicatesRemoved).toBe(1);
            expect(result.allPlaceIds).toContain('duplicate_place');
            expect(result.allPlaceIds).toContain('unique_place_phrase1');
            expect(result.allPlaceIds).toContain('unique_place_phrase2');
        });

        test('should handle phrases with no results', async () => {
            const phrases = ['phrase1', 'phrase2'];
            const searchProcessor = jest.fn().mockImplementation(async (phrase) => {
                if (phrase === 'phrase2') {
                    return { place_ids: [] }; // No results
                }
                return { place_ids: ['place1'] };
            });

            const result = await streamingProcessor.processPhrasesStream(
                phrases,
                searchProcessor
            );

            expect(result.processed).toBe(2);
            expect(result.allPlaceIds).toHaveLength(1);
            expect(result.allPlaceIds).toContain('place1');
        });
    });

    describe('Error Handling', () => {
        test('should handle processor function errors', async () => {
            const items = ['item1', 'item2'];
            const processor = jest.fn().mockRejectedValue(new Error('Processor error'));

            const result = await streamingProcessor.processStream(items, processor);

            expect(result.success).toBe(true); // Processing continues despite errors
            expect(result.processed).toBe(0);
            expect(result.errors).toBe(2);
            expect(result.errorDetails).toHaveLength(2);
        });

        test('should reset processing state after completion', async () => {
            const items = ['item1'];
            const processor = jest.fn().mockResolvedValue('result');

            await streamingProcessor.processStream(items, processor);

            expect(streamingProcessor.isProcessing).toBe(false);
        });

        test('should reset processing state after error', async () => {
            const items = ['item1'];
            const processor = jest.fn().mockImplementation(() => {
                throw new Error('Fatal error');
            });

            try {
                await streamingProcessor.processStream(items, processor);
            } catch (error) {
                // Expected to continue processing
            }

            expect(streamingProcessor.isProcessing).toBe(false);
        });
    });
});