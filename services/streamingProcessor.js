/**
 * StreamingProcessor - Memory-efficient streaming processing for large datasets
 * Requirements: 7.4
 */
class StreamingProcessor {
    constructor(batchSize = 10) {
        this.batchSize = batchSize;
        this.processedCount = 0;
        this.errorCount = 0;
        this.isProcessing = false;
    }

    /**
     * Process items in streaming batches to optimize memory usage
     * @param {Array} items - Items to process
     * @param {Function} processor - Function to process each item
     * @param {Function} onProgress - Progress callback
     * @returns {Promise<Object>} Processing results
     */
    async processStream(items, processor, onProgress = null) {
        if (this.isProcessing) {
            throw new Error('StreamingProcessor is already processing');
        }

        this.isProcessing = true;
        this.processedCount = 0;
        this.errorCount = 0;

        const results = [];
        const errors = [];
        const totalItems = items.length;

        console.log(`🌊 Starting streaming processing: ${totalItems} items in batches of ${this.batchSize}`);

        try {
            // Process items in batches
            for (let i = 0; i < totalItems; i += this.batchSize) {
                const batch = items.slice(i, i + this.batchSize);
                const batchNumber = Math.floor(i / this.batchSize) + 1;
                const totalBatches = Math.ceil(totalItems / this.batchSize);

                console.log(`📦 Processing batch ${batchNumber}/${totalBatches} (${batch.length} items)`);

                // Process batch items concurrently but limit memory usage
                const batchPromises = batch.map(async (item, index) => {
                    try {
                        const result = await processor(item, i + index);
                        this.processedCount++;
                        return { success: true, result, item, index: i + index };
                    } catch (error) {
                        this.errorCount++;
                        errors.push({ item, index: i + index, error: error.message });
                        return { success: false, error: error.message, item, index: i + index };
                    }
                });

                // Wait for batch to complete
                const batchResults = await Promise.allSettled(batchPromises);

                // Extract successful results
                batchResults.forEach(result => {
                    if (result.status === 'fulfilled' && result.value.success) {
                        results.push(result.value.result);
                    }
                });

                // Call progress callback
                if (onProgress) {
                    onProgress({
                        processed: this.processedCount,
                        total: totalItems,
                        errors: this.errorCount,
                        progress: Math.round((this.processedCount / totalItems) * 100),
                        currentBatch: batchNumber,
                        totalBatches: totalBatches
                    });
                }

                // Force garbage collection after each batch to free memory
                if (global.gc && batchNumber % 5 === 0) {
                    console.log(`🗑️  Running garbage collection after batch ${batchNumber}`);
                    global.gc();
                }

                // Small delay between batches to prevent overwhelming APIs
                if (i + this.batchSize < totalItems) {
                    await new Promise(resolve => setTimeout(resolve, 100));
                }
            }

            // Removed success log to reduce console spam
            // console.log(`✅ Streaming processing completed: ${this.processedCount}/${totalItems} items processed, ${this.errorCount} errors`);

            return {
                success: true,
                processed: this.processedCount,
                total: totalItems,
                errors: this.errorCount,
                results: results,
                errorDetails: errors,
                successRate: Math.round((this.processedCount / totalItems) * 100)
            };

        } catch (error) {
            console.error('❌ Streaming processing failed:', error.message);
            throw error;
        } finally {
            this.isProcessing = false;
        }
    }

    /**
     * Process place IDs in streaming batches for memory efficiency
     * @param {Array} placeIds - Place IDs to process
     * @param {Function} detailsProcessor - Function to get place details
     * @param {Function} saveProcessor - Function to save business data
     * @param {Function} onProgress - Progress callback
     * @returns {Promise<Object>} Processing results
     */
    async processPlaceIdsStream(placeIds, detailsProcessor, saveProcessor, onProgress = null) {
        console.log(`🏢 Starting streaming place ID processing: ${placeIds.length} places`);

        const processor = async (placeId, index) => {
            // Get place details
            const businessData = await detailsProcessor(placeId);

            if (!businessData || !businessData.name) {
                throw new Error(`No valid business data for place_id: ${placeId}`);
            }

            // Save business data immediately (streaming save)
            const saveResults = await saveProcessor(businessData);

            return {
                placeId,
                businessData,
                saveResults,
                index
            };
        };

        return await this.processStream(placeIds, processor, onProgress);
    }

    /**
     * Process search phrases in streaming batches
     * @param {Array} phrases - Search phrases to process
     * @param {Function} searchProcessor - Function to search for each phrase
     * @param {Function} onProgress - Progress callback
     * @returns {Promise<Object>} Processing results with all place IDs
     */
    async processPhrasesStream(phrases, searchProcessor, onProgress = null) {
        console.log(`🔍 Starting streaming phrase processing: ${phrases.length} phrases`);

        const allPlaceIds = [];

        const processor = async (phrase, index) => {
            const searchResult = await searchProcessor(phrase);

            if (searchResult && searchResult.place_ids) {
                allPlaceIds.push(...searchResult.place_ids);
                return {
                    phrase,
                    placeIds: searchResult.place_ids,
                    totalFound: searchResult.place_ids.length,
                    index
                };
            }

            return {
                phrase,
                placeIds: [],
                totalFound: 0,
                index
            };
        };

        const result = await this.processStream(phrases, processor, onProgress);

        // Remove duplicate place IDs across all phrases
        const uniquePlaceIds = [...new Set(allPlaceIds)];
        const duplicatesRemoved = allPlaceIds.length - uniquePlaceIds.length;

        if (duplicatesRemoved > 0) {
            console.log(`🔄 Removed ${duplicatesRemoved} duplicate place IDs from streaming results`);
        }

        return {
            ...result,
            allPlaceIds: uniquePlaceIds,
            totalPlaceIds: uniquePlaceIds.length,
            duplicatesRemoved
        };
    }

    /**
     * Get current processing status
     * @returns {Object} Current status
     */
    getStatus() {
        return {
            isProcessing: this.isProcessing,
            processedCount: this.processedCount,
            errorCount: this.errorCount,
            batchSize: this.batchSize
        };
    }

    /**
     * Set batch size for processing
     * @param {number} size - New batch size
     */
    setBatchSize(size) {
        if (size > 0 && size <= 100) {
            this.batchSize = size;
            console.log(`📦 Batch size updated to: ${size}`);
        } else {
            console.warn('Invalid batch size. Must be between 1 and 100');
        }
    }
}

module.exports = StreamingProcessor;