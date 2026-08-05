const express = require('express');
const dotenv = require('dotenv');
dotenv.config();
const fs = require('fs');
const path = require('path');
const ProcessingService = require('./services/processingService');

// Middleware
const ApiKeyAuthMiddleware = require('./middleware/apiKeyAuth');
const JWTAuthMiddleware = require('./middleware/jwtAuth');
const SubscriptionCheckMiddleware = require('./middleware/subscriptionCheck');
const UsageTrackingMiddleware = require('./middleware/usageTracking');

// Legacy Routes
const apiKeyRoutes = require('./routes/apiKeyRoutes');
const saasRoutes = require('./routes/saasRoutes');
const oauthRoutes = require('./routes/oauthRoutes');
const multiTenantSheetsRoutes = require('./routes/multiTenantSheetsRoutes');
const userDataRoutes = require('./routes/userDataRoutes');
const mainRoutes = require('./routes/mainRoutes');
const jobRoutes = require('./routes/jobRoutes');
const performanceRoutes = require('./routes/performanceRoutes');
const apiDocsRoutes = require('./routes/apiDocsRoutes');
const paymentRoutes = require('./routes/paymentRoutes');

// New Production-Ready Routes
const authRoutes = require('./routes/authRoutes');
const adminRoutes = require('./routes/adminRoutes');
const subscriptionRoutes = require('./routes/subscriptionRoutes');
const googleRoutes = require('./routes/googleRoutes');
const jobsRoutes = require('./routes/jobsRoutes');
const usageRoutes = require('./routes/usageRoutes');
const backgroundJobRoutes = require('./routes/backgroundJobRoutes');
const automationRoutes = require('./routes/automationRoutes');
const campaignRoutes = require('./routes/campaignRoutes');
const templateRoutes = require('./routes/templateRoutes');
const whatsappRoutes = require('./routes/whatsappRoutes');
const whatsappLightRoutes = require('./routes/whatsappLightRoutes');
const emailRoutes = require('./routes/emailRoutes');
const smsRoutes = require('./routes/smsRoutes');

// Load environment variables

const app = express();
const PORT = process.env.PORT || 3000;

// Initialize processing service
const processingService = new ProcessingService();

// Initialize middleware
const apiKeyMiddleware = new ApiKeyAuthMiddleware();
const jwtAuth = new JWTAuthMiddleware();
const subscriptionCheck = new SubscriptionCheckMiddleware();
const usageTracking = new UsageTrackingMiddleware();

// Middleware
// Middleware with increased payload limits for bulk campaign media attachments
app.use(express.json({ limit: '100mb' }));
app.use(express.urlencoded({ limit: '100mb', extended: true }));
app.use(express.static('public'));
app.use('/public', express.static('public')); // Also serve files at /public path

// CORS Middleware - Allow frontend to call this backend from different origin
app.use((req, res, next) => {
    const origin = req.headers.origin;
    const allowedOrigins = [
        'http://localhost:3000',      // Next.js dev
        'http://localhost:3001',      // Alt backend dev
        'http://localhost:4001',      // Backend self / SSR calls
        'http://127.0.0.1:3000',
        'http://127.0.0.1:3001',
        'http://127.0.0.1:4001',
        'http://localhost:5173',      // Vite dev
        'http://localhost:4200',      // Angular/other frameworks
        process.env.FRONTEND_URL,     // Production frontend URL if set
    ].filter(Boolean);

    if (allowedOrigins.includes(origin) || !origin) {
        res.header('Access-Control-Allow-Origin', origin || '*');
        res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, PATCH, OPTIONS');
        res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization, x-user-email, x-api-key');
        res.header('Access-Control-Allow-Credentials', 'true');
    }

    // Handle preflight requests
    if (req.method === 'OPTIONS') {
        return res.sendStatus(200);
    }

    next();
});

// Centralized API error logger for faster debugging of failed requests.
app.use((req, res, next) => {
    const start = Date.now();
    res.on('finish', () => {
        if (res.statusCode < 400) return;

        const durationMs = Date.now() - start;
        const safeBody = req.body && typeof req.body === 'object'
            ? Object.fromEntries(Object.entries(req.body).map(([key, value]) => {
                const sensitive = /(password|token|secret|signature|api.?key)/i.test(key);
                return [key, sensitive ? '[REDACTED]' : value];
            }))
            : req.body;

        console.error('[API_ERROR]', {
            method: req.method,
            url: req.originalUrl,
            statusCode: res.statusCode,
            durationMs,
            params: req.params,
            query: req.query,
            body: safeBody
        });
    });
    next();
});

// Store middleware instances in app locals for access in routes
app.locals.apiKeyMiddleware = apiKeyMiddleware;
app.locals.jwtAuth = jwtAuth;
app.locals.subscriptionCheck = subscriptionCheck;
app.locals.usageTrackingMiddleware = usageTracking;

// Utility: Discover Chrome executable path (Render-aware)
function discoverChromePath() {
    const exists = (p) => {
        try { return !!(p && fs.existsSync(p)); } catch { return false; }
    };
    let execPath = process.env.PUPPETEER_EXECUTABLE_PATH || process.env.CHROME_EXECUTABLE_PATH || '';
    if (execPath && !exists(execPath)) execPath = '';
    // Try puppeteer.executablePath() without hard dependency
    if (!execPath) {
        try {
            const puppeteer = require('puppeteer');
            const p = typeof puppeteer.executablePath === 'function' ? puppeteer.executablePath() : '';
            if (exists(p)) execPath = p;
        } catch (_) { }
    }
    // Cache scan (Render and general): search multiple bases including project-local cache
    const cacheBases = [
        process.env.PUPPETEER_CACHE_DIR,
        '/opt/render/project/src/.cache/puppeteer',
        path.resolve('.cache/puppeteer'),
        '/opt/render/.cache/puppeteer'
    ].filter(Boolean);
    let matchedBase = '';
    if (!execPath) {
        for (const base of cacheBases) {
            try {
                const chromeRoot = path.join(base, 'chrome');
                if (fs.existsSync(chromeRoot)) {
                    const entries = fs.readdirSync(chromeRoot).filter(Boolean);
                    if (entries.length) {
                        const latest = entries.sort().reverse()[0];
                        const platDir = path.join(chromeRoot, latest);
                        const candidates = [
                            path.join(platDir, 'chrome-linux64', 'chrome'),
                            path.join(platDir, 'chrome-mac', 'Chromium.app', 'Contents', 'MacOS', 'Chromium')
                        ];
                        for (const c of candidates) {
                            if (exists(c)) { execPath = c; matchedBase = base; break; }
                        }
                    }
                }
                if (execPath) break;
            } catch (_) { }
        }
    }

    // Fallback to standard system paths on macOS and Linux
    if (!execPath) {
        const commonPaths = [
            '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
            '/Applications/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing',
            '/Applications/Chromium.app/Contents/MacOS/Chromium',
            '/usr/bin/google-chrome',
            '/usr/bin/google-chrome-stable',
            '/usr/bin/chromium',
            '/usr/bin/chromium-browser',
        ];
        for (const p of commonPaths) {
            if (exists(p)) {
                execPath = p;
                break;
            }
        }
    }

    return { executablePath: execPath || '', valid: exists(execPath), cacheBase: matchedBase || cacheBases[0] || '', cacheBases };
}

// Discover Chrome at startup and set env for Puppeteer consumers
(() => {
    try {
        const info = discoverChromePath();
        if (info.executablePath && !process.env.PUPPETEER_EXECUTABLE_PATH) {
            process.env.PUPPETEER_EXECUTABLE_PATH = info.executablePath;
        }
        console.log(`Chrome discovery: path='${info.executablePath || ''}' valid=${info.valid} bases=${(info.cacheBases || []).join(',')}`);
    } catch (_) {
        // no-op
    }
})();

// Production-Ready API Routes (JWT Authentication)
app.use('/auth', authRoutes);
app.use('/subscription', subscriptionRoutes);
app.use('/google', googleRoutes);
app.use('/jobs', jobsRoutes);
app.use('/usage', usageRoutes);
app.use('/background-jobs', backgroundJobRoutes);
app.use('/api/v1/automation', automationRoutes);
app.use('/api/v1/campaigns', campaignRoutes);
app.use('/api/v1/templates', templateRoutes);
app.use('/api/v1/whatsapp', whatsappRoutes);
app.use('/api/v1/whatsapp-light', whatsappLightRoutes);
app.use('/api/v1/email', emailRoutes);
app.use('/api/v1/sms', smsRoutes);
const voiceRoutes = require('./routes/voiceRoutes');
app.use('/api/v1/voice', voiceRoutes);
const socialMediaRoutes = require('./routes/socialMediaRoutes');
app.use('/api/v1/social-media', socialMediaRoutes);
const socialPuppeteerRoutes = require('./routes/socialPuppeteerRoutes');
app.use('/api/v1/social', socialPuppeteerRoutes);
const socialAgentRoutes = require('./routes/socialAgentRoutes');
app.use('/api/v1/social-agent', socialAgentRoutes);
app.use('/admin', adminRoutes);

// Legacy Routes (for backward compatibility)
// API Key Management Routes (no authentication required for key generation)
app.use('/api-keys', apiKeyRoutes);

// Get API key stats by email (unauthenticated to allow dashboard widgets to fetch usage)
app.get('/api/v1/user/api-keys/stats', async (req, res) => {
    try {
        const userEmail = req.query.email || req.headers['x-user-email'];
        if (!userEmail) {
            return res.status(400).json({ success: false, error: 'Email is required' });
        }

        const DatabaseService = require('./services/database');
        const db = new DatabaseService();
        const ApiKey = require('./models/ApiKey');
        const apiKeyModel = new ApiKey(db);

        // Fetch active API key (highest tier first)
        const query = `
            SELECT * FROM api_keys 
            WHERE user_email = $1 AND is_active = true 
            ORDER BY 
              CASE plan_type 
                WHEN 'enterprise' THEN 4 
                WHEN 'pro' THEN 3 
                WHEN 'basic' THEN 2 
                WHEN 'trial' THEN 1 
                WHEN 'free' THEN 0 
                ELSE -1 
              END DESC,
              created_at DESC
            LIMIT 1
        `;
        const result = await db.pool.query(query, [userEmail]);

        if (result.rows.length === 0) {
            return res.json({
                success: true,
                stats: [{
                    autoReplyUsage: 0,
                    autoReplyLimit: 0,
                    whatsappCampaignUsage: 0,
                    whatsappCampaignLimit: 0
                }]
            });
        }

        const keyRow = result.rows[0];
        const limits = apiKeyModel.getPlanLimits(keyRow.plan_type);

        // Usage = Total - Remaining (ensuring it's not negative)
        const autoReplyUsage = Math.max(0, limits.autoReplyLimit - keyRow.auto_reply_limit);
        const whatsappCampaignUsage = Math.max(0, limits.whatsappCampaignLimit - keyRow.whatsapp_campaign_limit);

        res.json({
            success: true,
            stats: [{
                autoReplyUsage,
                autoReplyLimit: limits.autoReplyLimit,
                whatsappCampaignUsage,
                whatsappCampaignLimit: limits.whatsappCampaignLimit
            }]
        });
    } catch (error) {
        console.error('Error getting API key stats by email:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// SaaS API Routes (require API key authentication)
app.use('/api/v1',
    apiKeyMiddleware.authenticate(),
    apiKeyMiddleware.addRateLimitHeaders(),
    apiKeyMiddleware.addUsageHeaders(),
    saasRoutes
);

// OAuth Routes for Google Sheets (existing functionality)
app.use('/oauth', oauthRoutes);

// Multi-tenant Google Sheets Routes (new functionality)
app.use('/multi-tenant-sheets', multiTenantSheetsRoutes);

// User Data Routes (fetch all stored data by user email)
app.use('/user-data', userDataRoutes);

// Main Routes (health, legacy endpoints, etc.)
app.use('/', mainRoutes);

// Legacy Job Routes (search, status, jobs, etc.)
app.use('/', jobRoutes);

// Performance Routes
app.use('/', performanceRoutes);

// API Documentation Routes
app.use('/', apiDocsRoutes);

// Legacy Payment Routes
app.use('/', paymentRoutes);

// Cleanup rate limit store every 5 minutes
setInterval(() => {
    apiKeyMiddleware.cleanupRateLimitStore();
}, 5 * 60 * 1000);

// Global error handler
app.use((error, req, res, next) => {
    console.error('Unhandled error:', error);
    res.status(500).json({
        error: 'Internal server error',
        message: 'An unexpected error occurred'
    });
});

// Handle 404 for undefined routes
app.use('*', (req, res) => {
    res.status(404).json({
        error: 'Not found',
        message: `Route ${req.method} ${req.originalUrl} not found`
    });
});

// Graceful shutdown handler for production stability
process.on('SIGTERM', async () => {
    console.log('🔄 SIGTERM received, starting graceful shutdown...');
    await gracefulShutdown();
});

process.on('SIGINT', async () => {
    console.log('🔄 SIGINT received, starting graceful shutdown...');
    await gracefulShutdown();
});

async function gracefulShutdown() {
    try {
        console.log('🔄 Flushing any remaining batch operations...');

        // Flush any remaining Google Sheets batches
        if (processingService && processingService.flushBatchQueue) {
            await processingService.flushBatchQueue();
        }

        // Clean up WhatsApp Puppeteer sessions
        try {
            const WhatsAppPuppeteerService = require('./services/whatsappPuppeteerService');
            // The module-level instance in routes will be cleaned up when process exits,
            // but we log the intent for debugging.
            console.log('🔄 Cleaning up WhatsApp sessions...');
        } catch (_) {}

        console.log('✅ Graceful shutdown completed');
        process.exit(0);
    } catch (error) {
        console.error('❌ Error during graceful shutdown:', error);
        process.exit(1);
    }
}

// Handle uncaught exceptions to prevent crashes
process.on('uncaughtException', (error) => {
    console.error('❌ Uncaught Exception:', error);
    // Force garbage collection if available
    if (global.gc) {
        global.gc();
        console.log('[DEBUG] Forced GC after uncaught exception');
    }
    // Don't exit immediately, log and continue
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('❌ Unhandled Rejection at:', promise, 'reason:', reason);
    // Force garbage collection if available
    if (global.gc) {
        global.gc();
        console.log('[DEBUG] Forced GC after unhandled rejection');
    }
    // Don't exit immediately, log and continue
});

// Add memory monitoring and alerts
if (process.env.RENDER) {
    setInterval(() => {
        const mem = process.memoryUsage();
        const heapMB = Math.round(mem.heapUsed / 1024 / 1024);
        const rssMB = Math.round(mem.rss / 1024 / 1024);

        console.log(`[MEMORY] Heap: ${heapMB}MB, RSS: ${rssMB}MB`);

        // Force GC if memory is high
        if (heapMB > 300 && global.gc) {
            console.warn(`[MEMORY] High heap usage (${heapMB}MB), forcing GC`);
            global.gc();
        }

        // Alert if memory is critically high
        if (rssMB > 400) {
            console.error(`[MEMORY] CRITICAL: RSS ${rssMB}MB - potential memory leak!`);
        }
    }, 15000); // Check every 15 seconds
}

// Start server (only when executed directly, not when imported by serverless runtimes)
if (require.main === module) {
    const server = app.listen(PORT, '0.0.0.0', () => {
        console.log(`Server running on port ${PORT}`);
        console.log(`Job Control Dashboard: http://localhost:${PORT}/`);
        console.log(`SaaS Dashboard: http://localhost:${PORT}/saas`);
        console.log(`Health check available at: http://localhost:${PORT}/health`);
        console.log(`API documentation available at: http://localhost:${PORT}/api-docs`);
        console.log(`Search service available at: http://localhost:${PORT}/search-service`);
        console.log(`Job status available at: http://localhost:${PORT}/status/:jobId`);
        console.log(`Active jobs available at: http://localhost:${PORT}/status`);
        console.log(`All jobs available at: http://localhost:${PORT}/jobs`);
        
        // Boot up background services
        try {
            const whatsappPuppeteer = require('./services/whatsappPuppeteerService').getInstance();
            setTimeout(() => {
                whatsappPuppeteer.initializeAllActiveSessions();
            }, 3000); // Wait a few seconds for DB to be fully ready

            const whatsappOpenWa = require('./services/whatsappOpenWaService').getInstance();
            setTimeout(() => {
                whatsappOpenWa.autoStartSessions();
            }, 4000);
            
            const automationService = require('./services/automationService');
            setTimeout(() => {
                automationService.resumeAllRunningCampaigns();
            }, 5000);

            const emailAutomationService = require('./services/emailAutomationService').getInstance();
            setTimeout(() => {
                emailAutomationService.start();
            }, 7000);

            const socialAgentScheduler = require('./services/socialAgentScheduler');
            setTimeout(() => {
                socialAgentScheduler.start();
            }, 9000);
        } catch (e) {
            console.log('[Background Jobs] Boot error:', e.message);
        }
    });

    // Set server timeout for long-running operations
    server.timeout = 300000; // 5 minutes timeout
}

module.exports = app;