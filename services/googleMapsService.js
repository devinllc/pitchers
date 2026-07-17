const axios = require('axios');
const RateLimiter = require('./rateLimiter');
const ErrorHandler = require('./errorHandler');
require('dotenv').config();

class GoogleMapsService {
    constructor() {
        this.apiKey = process.env.GOOGLE_MAPS_API_KEY;
        this.textSearchUrl = 'https://maps.googleapis.com/maps/api/place/textsearch/json';
        this.placeDetailsUrl = 'https://maps.googleapis.com/maps/api/place/details/json';
        this.rateLimiter = new RateLimiter();
        this.errorHandler = new ErrorHandler();

        if (!this.apiKey) {
            throw new Error('GOOGLE_MAPS_API_KEY environment variable is required');
        }
    }

    /**
     * Perform Google Maps Text Search API call
     * @param {string} query - Search query phrase
     * @param {string|null} nextPageToken - Token for pagination (optional)
     * @returns {Promise<{results: Array, next_page_token?: string}>} Search results with place_ids and pagination token
     */
    async textSearch(query, nextPageToken = null) {
        const startTime = Date.now();
        const context = {
            operation: 'textSearch',
            query: query,
            hasNextPageToken: !!nextPageToken
        };

        try {
            // Build query parameters
            const params = {
                query: query,
                key: this.apiKey
            };

            // Add next page token if provided for pagination
            if (nextPageToken) {
                params.pagetoken = nextPageToken;
            }

            this.errorHandler.logProgress('textSearch', {
                status: 'started',
                query: query,
                isNextPage: !!nextPageToken
            });

            // Apply rate limiting before API call
            this.errorHandler.logRateLimit(2000, 'Google Maps Text Search API rate limiting');
            await this.rateLimiter.delay();

            const response = await axios.get(this.textSearchUrl, {
                params: params,
                timeout: 10000 // 10 second timeout
            });

            const duration = Date.now() - startTime;
            this.errorHandler.logApiCall('Google Maps Text Search', params, response.data, duration);

            // Check API response status
            if (response.data.status !== 'OK' && response.data.status !== 'ZERO_RESULTS') {
                throw new Error(`Google Maps API error: ${response.data.status} - ${response.data.error_message || 'Unknown error'}`);
            }

            // Extract results and pagination info
            const results = response.data.results || [];
            const nextToken = response.data.next_page_token || null;

            // Extract place_ids from results
            const placeIds = this.extractPlaceIds(results);

            this.errorHandler.logProgress('textSearch', {
                status: 'completed',
                query: query,
                placeIdsFound: placeIds.length,
                hasNextPage: !!nextToken,
                duration: `${duration}ms`
            });

            return {
                results: results,
                place_ids: placeIds,
                next_page_token: nextToken,
                status: response.data.status
            };

        } catch (error) {
            this.errorHandler.logApiFailure('Google Maps Text Search', error, { query, nextPageToken });
            this.errorHandler.logAndContinue(error, context);

            // Return empty results to allow processing to continue
            return {
                results: [],
                place_ids: [],
                next_page_token: null,
                status: 'ERROR',
                error: error.message
            };
        }
    }

    /**
     * Extract place_ids from Google Maps API results
     * @param {Array} results - Array of place results from API
     * @returns {string[]} Array of place_ids
     */
    extractPlaceIds(results) {
        if (!Array.isArray(results)) {
            console.warn('Invalid results array provided to extractPlaceIds');
            return [];
        }

        const placeIds = results
            .filter(place => place.place_id) // Only include results with place_id
            .map(place => place.place_id)
            .filter(id => typeof id === 'string' && id.length > 0); // Validate place_id format

        return placeIds;
    }

    /**
     * Validate query parameters before making API call
     * @param {string} query - Search query to validate
     * @returns {boolean} True if query is valid
     */
    validateQuery(query) {
        if (!query || typeof query !== 'string') {
            console.warn('Invalid query: must be a non-empty string');
            return false;
        }

        if (query.trim().length < 3) {
            console.warn('Invalid query: must be at least 3 characters long');
            return false;
        }

        if (query.length > 200) {
            console.warn('Invalid query: must be less than 200 characters');
            return false;
        }

        return true;
    }

    /**
     * Search with automatic pagination handling (up to 3 pages max)
     * @param {string} query - Search query phrase
     * @param {number} maxPages - Maximum number of pages to fetch (default: 3)
     * @returns {Promise<{place_ids: Array, totalResults: number, pagesProcessed: number}>} All place_ids from paginated results
     */
    async searchWithPagination(query, maxPages = 3) {
        if (!this.validateQuery(query)) {
            console.error(`Invalid query provided: "${query}"`);
            return {
                place_ids: [],
                totalResults: 0,
                pagesProcessed: 0,
                error: 'Invalid query'
            };
        }

        const allPlaceIds = [];
        let currentPage = 1;
        let nextPageToken = null;
        let totalResults = 0;

        console.log(`Starting paginated search for query: "${query}" (max ${maxPages} pages)`);

        try {
            // Process first page
            const firstPageResult = await this.textSearch(query);

            if (firstPageResult.status === 'ERROR') {
                console.error(`First page search failed for query: "${query}"`);
                return {
                    place_ids: [],
                    totalResults: 0,
                    pagesProcessed: 0,
                    error: firstPageResult.error
                };
            }

            // Add place_ids from first page
            allPlaceIds.push(...firstPageResult.place_ids);
            totalResults += firstPageResult.place_ids.length;
            nextPageToken = firstPageResult.next_page_token;

            console.log(`Page ${currentPage}: Found ${firstPageResult.place_ids.length} place_ids for query: "${query}"`);

            // Process additional pages if next_page_token exists and we haven't hit max pages
            while (nextPageToken && currentPage < maxPages) {
                currentPage++;

                // Wait 2 seconds before next page request (as per requirements)
                console.log(`Waiting 2 seconds before fetching page ${currentPage}...`);
                await this.rateLimiter.delay();

                const pageResult = await this.textSearch(query, nextPageToken);

                if (pageResult.status === 'ERROR') {
                    console.error(`Page ${currentPage} search failed for query: "${query}"`);
                    break; // Stop pagination on error but return what we have
                }

                // Add place_ids from this page
                allPlaceIds.push(...pageResult.place_ids);
                totalResults += pageResult.place_ids.length;
                nextPageToken = pageResult.next_page_token;

                console.log(`Page ${currentPage}: Found ${pageResult.place_ids.length} place_ids for query: "${query}"`);

                // If no more results on this page, stop pagination
                if (pageResult.place_ids.length === 0) {
                    // Removed success log to reduce console spam
                    // console.log(`No more results found on page ${currentPage}, stopping pagination`);
                    break;
                }
            }

            // Remove duplicates (in case same place_id appears on multiple pages)
            const uniquePlaceIds = [...new Set(allPlaceIds)];
            const duplicatesRemoved = allPlaceIds.length - uniquePlaceIds.length;

            if (duplicatesRemoved > 0) {
                console.log(`Removed ${duplicatesRemoved} duplicate place_ids from paginated results`);
            }

            console.log(`Pagination complete for query: "${query}" - ${uniquePlaceIds.length} unique place_ids from ${currentPage} pages`);

            return {
                place_ids: uniquePlaceIds,
                totalResults: uniquePlaceIds.length,
                pagesProcessed: currentPage,
                duplicatesRemoved: duplicatesRemoved
            };

        } catch (error) {
            console.error(`Error during pagination for query "${query}":`, {
                error: error.message,
                currentPage: currentPage,
                totalPlaceIds: allPlaceIds.length,
                timestamp: new Date().toISOString()
            });

            // Return what we collected so far
            const uniquePlaceIds = [...new Set(allPlaceIds)];
            return {
                place_ids: uniquePlaceIds,
                totalResults: uniquePlaceIds.length,
                pagesProcessed: currentPage - 1, // Subtract 1 since current page failed
                error: error.message
            };
        }
    }



    /**
     * Get detailed business information from Google Place Details API
     * @param {string} placeId - Google Place ID
     * @returns {Promise<Object>} Formatted business data
     */
    async getPlaceDetails(placeId) {
        const startTime = Date.now();
        const context = {
            operation: 'getPlaceDetails',
            placeId: placeId
        };

        if (!placeId || typeof placeId !== 'string') {
            this.errorHandler.logAndContinue(new Error('Invalid place_id provided'), context);
            return this.getEmptyBusinessData();
        }

        try {
            this.errorHandler.logProgress('getPlaceDetails', {
                status: 'started',
                placeId: placeId
            });

            // Apply rate limiting before API call
            this.errorHandler.logRateLimit(2000, 'Google Place Details API rate limiting');
            await this.rateLimiter.delay();

            // Define fields to request from Place Details API
            const fields = [
                'name',
                'formatted_phone_number',
                'formatted_address',
                'website',
                'rating',
                'user_ratings_total',
                'opening_hours'
            ].join(',');

            const params = {
                place_id: placeId,
                fields: fields,
                key: this.apiKey
            };

            const response = await axios.get(this.placeDetailsUrl, {
                params: params,
                timeout: 10000 // 10 second timeout
            });

            const duration = Date.now() - startTime;
            this.errorHandler.logApiCall('Google Place Details', params, response.data, duration);

            // Check API response status
            if (response.data.status !== 'OK') {
                const error = new Error(`Google Place Details API error: ${response.data.status} - ${response.data.error_message || 'Unknown error'}`);
                this.errorHandler.logApiFailure('Google Place Details', error, { placeId });
                return this.getEmptyBusinessData();
            }

            const placeData = response.data.result;

            if (!placeData) {
                this.errorHandler.logProgress('getPlaceDetails', {
                    status: 'no_data',
                    placeId: placeId,
                    message: 'No place data returned from API'
                });
                return this.getEmptyBusinessData();
            }

            // Format and extract business data
            const businessData = this.formatBusinessData(placeData);

            this.errorHandler.logProgress('getPlaceDetails', {
                status: 'completed',
                placeId: placeId,
                businessName: businessData.name,
                hasPhone: !!businessData.phone,
                hasWebsite: !!businessData.website,
                duration: `${duration}ms`
            });

            return businessData;

        } catch (error) {
            this.errorHandler.logApiFailure('Google Place Details', error, { placeId });
            this.errorHandler.logAndContinue(error, context);

            // Return empty business data to allow processing to continue
            return this.getEmptyBusinessData();
        }
    }

    /**
     * Format raw Google Place Details data into consistent business data structure
     * @param {Object} placeData - Raw place data from Google API
     * @returns {Object} Formatted business data
     */
    formatBusinessData(placeData) {
        return {
            name: this.extractName(placeData),
            phone: this.extractPhone(placeData),
            address: this.extractAddress(placeData),
            website: this.extractWebsite(placeData),
            rating: this.extractRating(placeData),
            totalReviews: this.extractTotalReviews(placeData),
            openingHours: this.extractOpeningHours(placeData)
        };
    }

    /**
     * Extract business name from place data
     * @param {Object} placeData - Raw place data
     * @returns {string} Business name or empty string
     */
    extractName(placeData) {
        if (placeData.name && typeof placeData.name === 'string') {
            return placeData.name.trim();
        }
        return '';
    }

    /**
     * Extract formatted phone number from place data
     * @param {Object} placeData - Raw place data
     * @returns {string} Formatted phone number or empty string
     */
    extractPhone(placeData) {
        if (placeData.formatted_phone_number && typeof placeData.formatted_phone_number === 'string') {
            return placeData.formatted_phone_number.trim();
        }
        return '';
    }

    /**
     * Extract formatted address from place data
     * @param {Object} placeData - Raw place data
     * @returns {string} Formatted address or empty string
     */
    extractAddress(placeData) {
        if (placeData.formatted_address && typeof placeData.formatted_address === 'string') {
            return placeData.formatted_address.trim();
        }
        return '';
    }

    /**
     * Extract website URL from place data
     * @param {Object} placeData - Raw place data
     * @returns {string} Website URL or empty string
     */
    extractWebsite(placeData) {
        if (placeData.website && typeof placeData.website === 'string') {
            const website = placeData.website.trim();
            // Ensure URL has protocol
            if (website && !website.startsWith('http://') && !website.startsWith('https://')) {
                return `https://${website}`;
            }
            return website;
        }
        return '';
    }

    /**
     * Extract rating from place data
     * @param {Object} placeData - Raw place data
     * @returns {number|null} Rating value or null if not available
     */
    extractRating(placeData) {
        if (typeof placeData.rating === 'number' && placeData.rating >= 0 && placeData.rating <= 5) {
            return Math.round(placeData.rating * 10) / 10; // Round to 1 decimal place
        }
        return null;
    }

    /**
     * Extract total reviews count from place data
     * @param {Object} placeData - Raw place data
     * @returns {number|null} Total reviews count or null if not available
     */
    extractTotalReviews(placeData) {
        if (typeof placeData.user_ratings_total === 'number' && placeData.user_ratings_total >= 0) {
            return placeData.user_ratings_total;
        }
        return null;
    }

    /**
     * Extract opening hours from place data
     * @param {Object} placeData - Raw place data
     * @returns {Array} Array of opening hours or empty array
     */
    extractOpeningHours(placeData) {
        if (placeData.opening_hours &&
            placeData.opening_hours.weekday_text &&
            Array.isArray(placeData.opening_hours.weekday_text)) {

            return placeData.opening_hours.weekday_text
                .filter(hours => typeof hours === 'string' && hours.trim().length > 0)
                .map(hours => hours.trim());
        }
        return [];
    }

    /**
     * Get empty business data structure for error cases
     * @returns {Object} Empty business data with all fields as empty strings/null
     */
    getEmptyBusinessData() {
        return {
            name: '',
            phone: '',
            address: '',
            website: '',
            rating: null,
            totalReviews: null,
            openingHours: []
        };
    }

    /**
     * Validate place_id format
     * @param {string} placeId - Place ID to validate
     * @returns {boolean} True if place_id is valid format
     */
    validatePlaceId(placeId) {
        if (!placeId || typeof placeId !== 'string') {
            return false;
        }

        // Google Place IDs are typically alphanumeric with some special characters
        // and are usually between 20-100 characters long
        const placeIdRegex = /^[A-Za-z0-9_-]{15,200}$/;
        return placeIdRegex.test(placeId.trim());
    }

    /**
     * Get formatted error message for logging
     * @param {Error} error - Error object
     * @param {string} context - Context information
     * @returns {Object} Formatted error info
     */
    formatError(error, context) {
        return {
            message: error.message,
            context: context,
            timestamp: new Date().toISOString(),
            stack: error.stack
        };
    }
}

module.exports = GoogleMapsService;