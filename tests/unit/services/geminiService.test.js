const GeminiService = require('../../../services/geminiService');
const axios = require('axios');

// Mock axios
jest.mock('axios');
const mockedAxios = axios;
mockedAxios.post = jest.fn();

// Mock ErrorHandler
jest.mock('../../../services/errorHandler', () => {
    return jest.fn().mockImplementation(() => ({
        logProgress: jest.fn(),
        logApiCall: jest.fn(),
        logApiFailure: jest.fn(),
        logAndContinue: jest.fn()
    }));
});

// Mock dotenv
jest.mock('dotenv', () => ({
    config: jest.fn()
}));

describe('GeminiService', () => {
    let geminiService;
    const originalEnv = process.env;

    beforeEach(() => {
        jest.clearAllMocks();
        process.env = { ...originalEnv };
        delete process.env.OPENROUTER_API_KEY;
        delete process.env.GEMINI_API_KEY;
        process.env.GEMINI_API_KEY = 'test-api-key';
        geminiService = new GeminiService();
    });

    afterEach(() => {
        process.env = originalEnv;
    });

    describe('constructor', () => {
        it('should initialize with API key from environment', () => {
            expect(geminiService.apiKey).toBe('test-api-key');
            expect(geminiService.baseUrl).toBe('https://openrouter.ai/api/v1/chat/completions');
        });

        it('should throw error if API key is missing', () => {
            delete process.env.GEMINI_API_KEY;
            delete process.env.OPENROUTER_API_KEY;
            expect(() => new GeminiService()).toThrow('OPENROUTER_API_KEY or GEMINI_API_KEY environment variable is required');
        });
    });

    describe('generateSearchPhrases', () => {
        const mockApiResponse = {
            data: {
                choices: [{
                    message: {
                        content: 'Hazratganj bridal makeup artist, Gomti Nagar bridal makeup artist, Aminabad wedding makeup'
                    }
                }]
            }
        };

        it('should generate search phrases successfully', async () => {
            mockedAxios.post.mockResolvedValue(mockApiResponse);

            const result = await geminiService.generateSearchPhrases('Lucknow', 'bridal makeup artist');

            expect(result).toEqual([
                'Hazratganj bridal makeup artist',
                'Gomti Nagar bridal makeup artist',
                'Aminabad wedding makeup'
            ]);
            expect(mockedAxios.post).toHaveBeenCalledWith(
                'https://openrouter.ai/api/v1/chat/completions',
                expect.objectContaining({
                    model: expect.any(String),
                    messages: expect.arrayContaining([
                        expect.objectContaining({
                            role: 'user',
                            content: expect.stringContaining('bridal makeup artist')
                        })
                    ])
                }),
                expect.objectContaining({
                    headers: expect.objectContaining({
                        'Authorization': 'Bearer test-api-key',
                        'Content-Type': 'application/json'
                    })
                })
            );
        });

        it('should handle API errors gracefully', async () => {
            const apiError = new Error('API request failed');
            mockedAxios.post.mockRejectedValue(apiError);

            await expect(geminiService.generateSearchPhrases('Delhi', 'restaurant'))
                .rejects.toThrow('Failed to generate search phrases: API request failed');
        });

        it('should handle empty API response', async () => {
            mockedAxios.post.mockResolvedValue({ data: {} });

            await expect(geminiService.generateSearchPhrases('Mumbai', 'cafe'))
                .rejects.toThrow('Failed to generate search phrases: No text generated from API response');
        });

        it('should use exact prompt from requirements', async () => {
            mockedAxios.post.mockResolvedValue(mockApiResponse);

            await geminiService.generateSearchPhrases('Delhi', 'restaurant');

            const callArgs = mockedAxios.post.mock.calls[0];
            const requestBody = callArgs[1];
            const prompt = requestBody.messages[0].content;

            expect(prompt).toContain('You are a search marketing assistant. Follow these steps precisely:');
            expect(prompt).toContain('Step 1: Based on the keyword \'restaurant\'');
            expect(prompt).toContain('Step 2: Generate a list of up to 35 popular and commonly searched neighborhoods or localities in \'Delhi\', India');
            expect(prompt).toContain('Step 3: Combine each keyword from Step 1 with each neighborhood from Step 2');
            expect(prompt).toContain('Output ONLY the combined search phrases');
            expect(prompt).toContain('comma-separated list');
        });
    });

    describe('parseSearchPhrases', () => {
        it('should parse comma-separated phrases correctly', () => {
            const aiResponse = 'Connaught Place restaurant, Khan Market cafe, Karol Bagh food';
            const result = geminiService.parseSearchPhrases(aiResponse);

            expect(result).toEqual([
                'Connaught Place restaurant',
                'Khan Market cafe',
                'Karol Bagh food'
            ]);
        });

        it('should handle phrases with quotes', () => {
            const aiResponse = '"Sector 18 Noida restaurant", \'Gurgaon Cyber City cafe\', DLF Mall food';
            const result = geminiService.parseSearchPhrases(aiResponse);

            expect(result).toEqual([
                'Sector 18 Noida restaurant',
                'Gurgaon Cyber City cafe',
                'DLF Mall food'
            ]);
        });

        it('should filter out empty phrases', () => {
            const aiResponse = 'Valid phrase, , , Another valid phrase,  ';
            const result = geminiService.parseSearchPhrases(aiResponse);

            expect(result).toEqual([
                'Valid phrase',
                'Another valid phrase'
            ]);
        });

        it('should throw error for invalid input', () => {
            expect(() => geminiService.parseSearchPhrases(null))
                .toThrow('Invalid AI response for parsing');
            expect(() => geminiService.parseSearchPhrases(''))
                .toThrow('Invalid AI response for parsing');
        });
    });

    describe('validateSearchPhrases', () => {
        it('should validate phrases correctly', () => {
            const phrases = [
                'Valid phrase',
                'AB', // Too short
                'A'.repeat(201), // Too long
                'Valid phrase with <script>', // Special characters
                'Another valid phrase'
            ];

            const result = geminiService.validateSearchPhrases(phrases);

            expect(result).toEqual([
                'Valid phrase',
                'Another valid phrase'
            ]);
        });

        it('should handle empty array', () => {
            const result = geminiService.validateSearchPhrases([]);
            expect(result).toEqual([]);
        });

        it('should filter out phrases with problematic characters', () => {
            const phrases = [
                'Normal phrase',
                'Phrase with {brackets}',
                'Phrase with [square]',
                'Phrase with |pipe|',
                'Phrase with `backtick`'
            ];

            const result = geminiService.validateSearchPhrases(phrases);
            expect(result).toEqual(['Normal phrase']);
        });
    });
});