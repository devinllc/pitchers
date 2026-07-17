const axios = require('axios');
const ErrorHandler = require('./errorHandler');
require('dotenv').config();

class GeminiService {
    constructor() {
        this.apiKey = process.env.OPENROUTER_API_KEY || process.env.GEMINI_API_KEY;
        this.baseUrl = 'https://openrouter.ai/api/v1/chat/completions';
        this.errorHandler = new ErrorHandler();

        if (!this.apiKey) {
            throw new Error('OPENROUTER_API_KEY or GEMINI_API_KEY environment variable is required');
        }
    }

    /**
     * Generate search phrases using OpenRouter with the exact prompt from requirements
     * @param {string} city - The city name
     * @param {string} keyword - The business keyword
     * @param {Object} [options] - Optional parameters
     * @param {number} [options.maxPhrases] - Maximum number of phrases to return
     * @returns {Promise<string[]>} Array of search phrases
     */
    async generateSearchPhrases(city, keyword, options = {}) {
        const startTime = Date.now();
        const context = {
            operation: 'generateSearchPhrases',
            city: city,
            keyword: keyword
        };

        try {
            this.errorHandler.logProgress('generateSearchPhrases', {
                status: 'started',
                city: city,
                keyword: keyword
            });

            // Hardcoded counts per original specification
            const maxKeywords = 20;
            const maxNeighborhoods = 35;
            const targetPhrases = Number.isInteger(options.maxPhrases) && options.maxPhrases > 0 ? options.maxPhrases : 100;

            // Exact prompt from requirements 2.1 with target phrases instruction
            const prompt = `You are a search marketing assistant. Follow these steps precisely:

Goal: Produce up to ${targetPhrases} unique combined search phrases in total.

Step 1: Based on the keyword '${keyword}', generate a diverse list of up to ${maxKeywords} highly relevant and commonly searched keywords. Include variations, synonyms, and long-tail terms people may use.

Step 2: Generate a list of up to ${maxNeighborhoods} popular and commonly searched neighborhoods or localities in '${city}', India. Include both well-known and emerging areas if applicable.

Step 3: Combine each keyword from Step 1 with each neighborhood from Step 2 into search-friendly phrases (e.g., 'Hazratganj ${keyword}', 'Gomti Nagar bridal makeup artist').

IMPORTANT:
- Output ONLY the combined search phrases.
- Output them as a plain comma-separated list, with no headings, no bullet points, no explanations.
- Do NOT summarize or truncate the result.
- Ensure phrases are clean and readable, in Title Case where appropriate.

Return only the final list of search phrases, comma-separated.`;

            // Check for pause before API call
            if (this.isPaused && this.isPaused()) {
                console.log('⏸️ API call paused by user request');
                while (this.isPaused && this.isPaused()) {
                    await new Promise(resolve => setTimeout(resolve, 1000));
                }
                console.log('▶️ API call resumed by user request');
            }

            const modelName = process.env.OPENROUTER_MODEL || process.env.NEXT_PUBLIC_OPENROUTER_MODEL || 'deepseek/deepseek-v4-flash:free';
            const requestBody = {
                model: modelName, // Read from env
                messages: [{
                    role: 'user',
                    content: prompt
                }]
            };

            const maxAttempts = Number(process.env.OPENROUTER_RETRY_ATTEMPTS || 3);
            let response = null;
            let lastError = null;

            for (let attempt = 1; attempt <= maxAttempts; attempt++) {
                try {
                    response = await axios.post(
                        this.baseUrl,
                        requestBody,
                        {
                            headers: {
                                'Authorization': `Bearer ${this.apiKey}`,
                                'Content-Type': 'application/json'
                            }
                        }
                    );
                    lastError = null;
                    break;
                } catch (err) {
                    lastError = err;
                    const shouldRetry = this.isRetriableError(err);
                    if (!shouldRetry || attempt >= maxAttempts) {
                        break;
                    }

                    const delayMs = this.getRetryDelayMs(attempt);
                    console.warn(`OpenRouter request failed (attempt ${attempt}/${maxAttempts}). Retrying in ${delayMs}ms...`);
                    await this.sleep(delayMs);
                }
            }

            if (!response) {
                if (this.isRetriableError(lastError)) {
                    const fallbackPhrases = this.generateFallbackSearchPhrases(city, keyword, targetPhrases);
                    const fallbackDuration = Date.now() - startTime;
                    this.errorHandler.logProgress('generateSearchPhrases', {
                        status: 'fallback_used',
                        reason: lastError?.message || 'AI provider unavailable',
                        phrasesGenerated: fallbackPhrases.length,
                        duration: `${fallbackDuration}ms`
                    });
                    return fallbackPhrases;
                }

                throw lastError || new Error('OpenRouter response missing after retries');
            }

            const duration = Date.now() - startTime;
            this.errorHandler.logApiCall('OpenRouter AI', { city, keyword }, response.data, duration);

            // Extract the generated text from the response
            console.log(`[DEBUG] OpenRouter Full Response:`, JSON.stringify(response.data, null, 2));
            const generatedText = response.data?.choices?.[0]?.message?.content;

            if (!generatedText || generatedText.trim().length === 0) {
                console.warn('⚠️ OpenRouter returned empty response. Using fallback search phrases.');
                const fallbackPhrases = this.generateFallbackSearchPhrases(city, keyword, options?.maxPhrases || 30);
                return fallbackPhrases;
            }

            // Parse comma-separated response into array of search phrases
            let searchPhrases = this.parseSearchPhrases(generatedText);

            console.log(`🔍 Debug OpenRouter: Original phrases = ${searchPhrases.length}, maxPhrases = ${options?.maxPhrases}`);

            // Respect caller limit if provided
            if (options && typeof options.maxPhrases === 'number' && options.maxPhrases > 0) {
                const originalCount = searchPhrases.length;
                searchPhrases = searchPhrases.slice(0, options.maxPhrases);
                console.log(`🎯 Limited phrases: ${originalCount} → ${searchPhrases.length} (maxPhrases: ${options.maxPhrases})`);
            }

            this.errorHandler.logProgress('generateSearchPhrases', {
                status: 'completed',
                phrasesGenerated: searchPhrases.length,
                duration: `${duration}ms`
            });

            return searchPhrases;

        } catch (error) {
            this.errorHandler.logApiFailure('OpenRouter AI', error, { city, keyword });
            this.errorHandler.logAndContinue(error, context);
            throw new Error(`Failed to generate search phrases: ${error.message}`);
        }
    }

    isRetriableError(error) {
        const status = error?.response?.status;
        if (status === 429) return true;
        if (typeof status === 'number' && status >= 500) return true;

        const code = error?.code;
        return code === 'ECONNRESET' || code === 'ECONNABORTED' || code === 'ETIMEDOUT';
    }

    getRetryDelayMs(attempt) {
        const baseDelay = Number(process.env.OPENROUTER_RETRY_BASE_DELAY_MS || 1200);
        const jitter = Math.floor(Math.random() * 250);
        return baseDelay * Math.pow(2, Math.max(0, attempt - 1)) + jitter;
    }

    sleep(ms) {
        return new Promise((resolve) => setTimeout(resolve, ms));
    }

    generateFallbackSearchPhrases(city, keyword, maxCount = 30) {
        const cleanCity = String(city || '').trim();
        const cleanKeyword = String(keyword || '').trim();
        const desiredCount = Number.isInteger(maxCount) && maxCount > 0 ? maxCount : 30;

        const localityHints = [
            'near me',
            'city center',
            'central',
            'west',
            'east',
            'north',
            'south',
            'best',
            'top rated',
            'budget',
            'premium'
        ];

        const basePhrases = [
            `${cleanKeyword} ${cleanCity}`,
            `${cleanCity} ${cleanKeyword}`,
            `best ${cleanKeyword} in ${cleanCity}`,
            `${cleanKeyword} services ${cleanCity}`,
            `${cleanKeyword} ${cleanCity} contact`
        ];

        const generated = new Set(
            basePhrases
                .map((v) => v.replace(/\s+/g, ' ').trim())
                .filter(Boolean)
        );

        for (const hint of localityHints) {
            if (generated.size >= desiredCount) break;
            generated.add(`${cleanKeyword} ${hint} ${cleanCity}`.replace(/\s+/g, ' ').trim());
            if (generated.size >= desiredCount) break;
            generated.add(`${hint} ${cleanKeyword} in ${cleanCity}`.replace(/\s+/g, ' ').trim());
        }

        return Array.from(generated).slice(0, desiredCount);
    }

    /**
     * Parse comma-separated AI response into clean array of search phrases
     * @param {string} aiResponse - Raw AI response text
     * @returns {string[]} Array of cleaned search phrases
     */
    parseSearchPhrases(aiResponse) {
        try {
            if (!aiResponse || typeof aiResponse !== 'string') {
                throw new Error('Invalid AI response for parsing');
            }

            // Split by comma and clean each phrase
            const phrases = aiResponse
                .split(',')
                .map(phrase => phrase.trim())
                .filter(phrase => phrase.length > 0)
                .map(phrase => {
                    // Remove any quotes or extra formatting
                    return phrase.replace(/^["']|["']$/g, '').trim();
                })
                .filter(phrase => phrase.length > 0);

            if (phrases.length === 0) {
                throw new Error('No valid search phrases found in AI response');
            }

            this.errorHandler.logProgress('parseSearchPhrases', {
                status: 'completed',
                phrasesExtracted: phrases.length
            });

            return phrases;

        } catch (error) {
            this.errorHandler.logAndContinue(error, {
                operation: 'parseSearchPhrases',
                responseLength: aiResponse?.length || 0
            });
            throw error;
        }
    }

    /**
     * Validate that search phrases are compatible with Google Maps API
     * @param {string[]} phrases - Array of search phrases
     * @returns {string[]} Array of validated phrases
     */
    validateSearchPhrases(phrases) {
        const validPhrases = phrases.filter(phrase => {
            // Basic validation for Google Maps API compatibility
            if (phrase.length < 3 || phrase.length > 200) {
                this.errorHandler.logProgress('validateSearchPhrases', {
                    status: 'skipped_phrase',
                    reason: 'invalid_length',
                    phrase: phrase.substring(0, 50) + '...'
                });
                return false;
            }

            // Remove phrases with potentially problematic characters
            if (/[<>{}[\]\\|`~]/.test(phrase)) {
                this.errorHandler.logProgress('validateSearchPhrases', {
                    status: 'skipped_phrase',
                    reason: 'special_characters',
                    phrase: phrase.substring(0, 50) + '...'
                });
                return false;
            }

            return true;
        });

        this.errorHandler.logProgress('validateSearchPhrases', {
            status: 'completed',
            totalPhrases: phrases.length,
            validPhrases: validPhrases.length,
            skippedPhrases: phrases.length - validPhrases.length
        });

        return validPhrases;
    }
}

module.exports = GeminiService;