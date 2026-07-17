const GoogleMapsService = require('../../../services/googleMapsService');
const axios = require('axios');

// Mock axios
jest.mock('axios');
const mockedAxios = axios;
mockedAxios.get = jest.fn();

// Mock RateLimiter
jest.mock('../../../services/rateLimiter', () => {
    return jest.fn().mockImplementation(() => ({
        delay: jest.fn().mockResolvedValue()
    }));
});

// Mock ErrorHandler
jest.mock('../../../services/errorHandler', () => {
    return jest.fn().mockImplementation(() => ({
        logProgress: jest.fn(),
        logApiCall: jest.fn(),
        logApiFailure: jest.fn(),
        logAndContinue: jest.fn(),
        logRateLimit: jest.fn()
    }));
});

describe('GoogleMapsService', () => {
    let googleMapsService;
    const originalEnv = process.env;

    beforeEach(() => {
        jest.clearAllMocks();
        process.env = { ...originalEnv };
        process.env.GOOGLE_MAPS_API_KEY = 'test-maps-api-key';
        googleMapsService = new GoogleMapsService();
    });

    afterEach(() => {
        process.env = originalEnv;
    });

    describe('constructor', () => {
        it('should initialize with API key from environment', () => {
            expect(googleMapsService.apiKey).toBe('test-maps-api-key');
            expect(googleMapsService.textSearchUrl).toBe('https://maps.googleapis.com/maps/api/place/textsearch/json');
            expect(googleMapsService.placeDetailsUrl).toBe('https://maps.googleapis.com/maps/api/place/details/json');
        });

        it('should throw error if API key is missing', () => {
            delete process.env.GOOGLE_MAPS_API_KEY;
            expect(() => new GoogleMapsService()).toThrow('GOOGLE_MAPS_API_KEY environment variable is required');
        });
    });

    describe('textSearch', () => {
        const mockSearchResponse = {
            data: {
                status: 'OK',
                results: [
                    { place_id: 'place1', name: 'Business 1' },
                    { place_id: 'place2', name: 'Business 2' }
                ],
                next_page_token: 'next_token_123'
            }
        };

        it('should perform text search successfully', async () => {
            mockedAxios.get.mockResolvedValue(mockSearchResponse);

            const result = await googleMapsService.textSearch('Delhi restaurant');

            expect(result).toEqual({
                results: mockSearchResponse.data.results,
                place_ids: ['place1', 'place2'],
                next_page_token: 'next_token_123',
                status: 'OK'
            });

            expect(mockedAxios.get).toHaveBeenCalledWith(
                'https://maps.googleapis.com/maps/api/place/textsearch/json',
                {
                    params: {
                        query: 'Delhi restaurant',
                        key: 'test-maps-api-key'
                    },
                    timeout: 10000
                }
            );
        });

        it('should handle pagination with next page token', async () => {
            mockedAxios.get.mockResolvedValue(mockSearchResponse);

            const result = await googleMapsService.textSearch('Mumbai cafe', 'next_token_456');

            expect(mockedAxios.get).toHaveBeenCalledWith(
                'https://maps.googleapis.com/maps/api/place/textsearch/json',
                {
                    params: {
                        query: 'Mumbai cafe',
                        key: 'test-maps-api-key',
                        pagetoken: 'next_token_456'
                    },
                    timeout: 10000
                }
            );
        });

        it('should handle ZERO_RESULTS status', async () => {
            mockedAxios.get.mockResolvedValue({
                data: {
                    status: 'ZERO_RESULTS',
                    results: []
                }
            });

            const result = await googleMapsService.textSearch('Nonexistent place');

            expect(result.status).toBe('ZERO_RESULTS');
            expect(result.place_ids).toEqual([]);
        });

        it('should handle API errors gracefully', async () => {
            const apiError = new Error('Network error');
            mockedAxios.get.mockRejectedValue(apiError);

            const result = await googleMapsService.textSearch('Test query');

            expect(result).toEqual({
                results: [],
                place_ids: [],
                next_page_token: null,
                status: 'ERROR',
                error: 'Network error'
            });
        });

        it('should handle API error status responses', async () => {
            mockedAxios.get.mockResolvedValue({
                data: {
                    status: 'REQUEST_DENIED',
                    error_message: 'API key invalid'
                }
            });

            const result = await googleMapsService.textSearch('Test query');

            expect(result.status).toBe('ERROR');
            expect(result.error).toContain('REQUEST_DENIED');
        });
    });

    describe('extractPlaceIds', () => {
        it('should extract place_ids from results', () => {
            const results = [
                { place_id: 'place1', name: 'Business 1' },
                { place_id: 'place2', name: 'Business 2' },
                { name: 'Business without place_id' }, // Should be filtered out
                { place_id: '', name: 'Business with empty place_id' } // Should be filtered out
            ];

            const placeIds = googleMapsService.extractPlaceIds(results);
            expect(placeIds).toEqual(['place1', 'place2']);
        });

        it('should handle empty or invalid results', () => {
            expect(googleMapsService.extractPlaceIds([])).toEqual([]);
            expect(googleMapsService.extractPlaceIds(null)).toEqual([]);
            expect(googleMapsService.extractPlaceIds(undefined)).toEqual([]);
        });
    });

    describe('validateQuery', () => {
        it('should validate queries correctly', () => {
            expect(googleMapsService.validateQuery('Valid query')).toBe(true);
            expect(googleMapsService.validateQuery('AB')).toBe(false); // Too short
            expect(googleMapsService.validateQuery('A'.repeat(201))).toBe(false); // Too long
            expect(googleMapsService.validateQuery('')).toBe(false); // Empty
            expect(googleMapsService.validateQuery(null)).toBe(false); // Null
            expect(googleMapsService.validateQuery(123)).toBe(false); // Not string
        });
    });

    describe('searchWithPagination', () => {
        it('should handle pagination correctly', async () => {
            // Mock first page response
            mockedAxios.get.mockResolvedValueOnce({
                data: {
                    status: 'OK',
                    results: [{ place_id: 'place1' }, { place_id: 'place2' }],
                    next_page_token: 'token1'
                }
            });

            // Mock second page response
            mockedAxios.get.mockResolvedValueOnce({
                data: {
                    status: 'OK',
                    results: [{ place_id: 'place3' }, { place_id: 'place4' }],
                    next_page_token: null
                }
            });

            const result = await googleMapsService.searchWithPagination('test query', 3);

            expect(result).toEqual({
                place_ids: ['place1', 'place2', 'place3', 'place4'],
                totalResults: 4,
                pagesProcessed: 2,
                duplicatesRemoved: 0
            });
        });

        it('should limit to maximum pages', async () => {
            // Mock responses for all pages
            mockedAxios.get.mockResolvedValue({
                data: {
                    status: 'OK',
                    results: [{ place_id: 'place1' }],
                    next_page_token: 'token'
                }
            });

            const result = await googleMapsService.searchWithPagination('test query', 2);

            expect(result.pagesProcessed).toBe(2);
            expect(mockedAxios.get).toHaveBeenCalledTimes(2);
        });

        it('should handle invalid queries', async () => {
            const result = await googleMapsService.searchWithPagination('AB'); // Too short

            expect(result).toEqual({
                place_ids: [],
                totalResults: 0,
                pagesProcessed: 0,
                error: 'Invalid query'
            });
        });

        it('should remove duplicate place_ids', async () => {
            mockedAxios.get.mockResolvedValueOnce({
                data: {
                    status: 'OK',
                    results: [{ place_id: 'place1' }, { place_id: 'place2' }],
                    next_page_token: 'token1'
                }
            });

            mockedAxios.get.mockResolvedValueOnce({
                data: {
                    status: 'OK',
                    results: [{ place_id: 'place1' }, { place_id: 'place3' }], // place1 is duplicate
                    next_page_token: null
                }
            });

            const result = await googleMapsService.searchWithPagination('test query');

            expect(result.place_ids).toEqual(['place1', 'place2', 'place3']);
            expect(result.duplicatesRemoved).toBe(1);
        });
    });

    describe('getPlaceDetails', () => {
        const mockPlaceDetailsResponse = {
            data: {
                status: 'OK',
                result: {
                    name: 'Test Business',
                    formatted_phone_number: '+91 98765 43210',
                    formatted_address: '123 Test Street, Delhi, India',
                    website: 'https://testbusiness.com',
                    rating: 4.5,
                    user_ratings_total: 150,
                    opening_hours: {
                        weekday_text: [
                            'Monday: 9:00 AM – 6:00 PM',
                            'Tuesday: 9:00 AM – 6:00 PM'
                        ]
                    }
                }
            }
        };

        it('should get place details successfully', async () => {
            mockedAxios.get.mockResolvedValue(mockPlaceDetailsResponse);

            const result = await googleMapsService.getPlaceDetails('test_place_id');

            expect(result).toEqual({
                name: 'Test Business',
                phone: '+91 98765 43210',
                address: '123 Test Street, Delhi, India',
                website: 'https://testbusiness.com',
                rating: 4.5,
                totalReviews: 150,
                openingHours: [
                    'Monday: 9:00 AM – 6:00 PM',
                    'Tuesday: 9:00 AM – 6:00 PM'
                ]
            });

            expect(mockedAxios.get).toHaveBeenCalledWith(
                'https://maps.googleapis.com/maps/api/place/details/json',
                {
                    params: {
                        place_id: 'test_place_id',
                        fields: 'name,formatted_phone_number,formatted_address,website,rating,user_ratings_total,opening_hours',
                        key: 'test-maps-api-key'
                    },
                    timeout: 10000
                }
            );
        });

        it('should handle invalid place_id', async () => {
            const result = await googleMapsService.getPlaceDetails('');

            expect(result).toEqual(googleMapsService.getEmptyBusinessData());
            expect(mockedAxios.get).not.toHaveBeenCalled();
        });

        it('should handle API errors', async () => {
            mockedAxios.get.mockRejectedValue(new Error('API error'));

            const result = await googleMapsService.getPlaceDetails('test_place_id');

            expect(result).toEqual(googleMapsService.getEmptyBusinessData());
        });

        it('should handle missing place data', async () => {
            mockedAxios.get.mockResolvedValue({
                data: {
                    status: 'OK',
                    result: null
                }
            });

            const result = await googleMapsService.getPlaceDetails('test_place_id');

            expect(result).toEqual(googleMapsService.getEmptyBusinessData());
        });
    });

    describe('formatBusinessData', () => {
        it('should format business data correctly', () => {
            const placeData = {
                name: 'Test Business',
                formatted_phone_number: '+91 98765 43210',
                formatted_address: '123 Test Street, Delhi',
                website: 'testbusiness.com', // Without protocol
                rating: 4.7,
                user_ratings_total: 200,
                opening_hours: {
                    weekday_text: ['Monday: 9:00 AM – 6:00 PM']
                }
            };

            const result = googleMapsService.formatBusinessData(placeData);

            expect(result).toEqual({
                name: 'Test Business',
                phone: '+91 98765 43210',
                address: '123 Test Street, Delhi',
                website: 'https://testbusiness.com', // Protocol added
                rating: 4.7,
                totalReviews: 200,
                openingHours: ['Monday: 9:00 AM – 6:00 PM']
            });
        });

        it('should handle missing data gracefully', () => {
            const placeData = {};

            const result = googleMapsService.formatBusinessData(placeData);

            expect(result).toEqual({
                name: '',
                phone: '',
                address: '',
                website: '',
                rating: null,
                totalReviews: null,
                openingHours: []
            });
        });
    });

    describe('validatePlaceId', () => {
        it('should validate place_ids correctly', () => {
            expect(googleMapsService.validatePlaceId('ChIJN1t_tDeuEmsRUsoyG83frY4')).toBe(true);
            expect(googleMapsService.validatePlaceId('valid_place_id_123')).toBe(true);
            expect(googleMapsService.validatePlaceId('')).toBe(false);
            expect(googleMapsService.validatePlaceId(null)).toBe(false);
            expect(googleMapsService.validatePlaceId('short')).toBe(false); // Too short
            expect(googleMapsService.validatePlaceId('invalid@place#id')).toBe(false); // Invalid characters
        });
    });

    describe('getEmptyBusinessData', () => {
        it('should return empty business data structure', () => {
            const result = googleMapsService.getEmptyBusinessData();

            expect(result).toEqual({
                name: '',
                phone: '',
                address: '',
                website: '',
                rating: null,
                totalReviews: null,
                openingHours: []
            });
        });
    });
});