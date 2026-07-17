/**
 * Social Media Automation Routes
 * Endpoints for sending cold DMs across platforms
 */

const express = require('express');
const router = express.Router();
const socialMediaController = require('../controllers/socialMediaController');
const UserEmailAuthMiddleware = require('../middleware/userEmailAuth');

const userAuth = new UserEmailAuthMiddleware();

// Middleware to ensure email authentication and build context
const verifyUserEmail = [
    userAuth.extractUserEmail(),
    (req, res, next) => {
        if (!req.userEmail) {
            return res.status(400).json({
                error: 'User email required',
                message: 'User email must be provided via userEmail in request body, query parameter, or x-user-email header',
                timestamp: new Date().toISOString()
            });
        }
        // Attach user email to req.user for downstream controllers
        if (!req.user) {
            req.user = {};
        }
        req.user.email = req.userEmail;
        next();
    }
];

// Middleware to ensure authentication
router.use(verifyUserEmail);

/**
 * POST /api/v1/social-media/send-dm
 * Send cold DMs to leads across specified social media platforms
 * 
 * Request Body:
 * {
 *   "userEmail": "user@example.com",
 *   "platforms": ["facebook", "instagram", "linkedin", "twitter"],
 *   "leads": [
 *     {
 *       "id": 123,
 *       "name": "John Doe",
 *       "facebook_handle": "john.doe",
 *       "instagram_handle": "johndoe",
 *       "linkedin_id": "ACoAA123456",
 *       "twitter_handle": "johndoe"
 *     }
 *   ],
 *   "message": "Hey John! Check out our amazing service...",
 *   "mediaUrl": "https://example.com/image.jpg" (optional)
 * }
 */
router.post('/send-dm', socialMediaController.sendSocialDMs);

/**
 * GET /api/v1/social-media/communications
 * Get all communications sent (emails, SMS, WhatsApp, social DMs)
 * 
 * Query Parameters:
 * - campaignType: followups, pitches, coldDms_social, responses
 * - status: sent, delivered, opened, replied, failed
 * - platform: facebook, instagram, linkedin, twitter
 * - limit: default 100
 * - offset: default 0
 */
router.get('/communications', socialMediaController.getAllCommunications);

/**
 * GET /api/v1/social-media/communications/by-platform
 * Get communications aggregated by platform with success rates
 */
router.get('/communications/by-platform', socialMediaController.getCommunicationsByPlatform);

/**
 * GET /api/v1/social-media/platforms
 * Get list of available platforms for this user
 */
router.get('/platforms', socialMediaController.getAvailablePlatforms);

/**
 * POST /api/v1/social-media/test-platform
 * Send test message to verify platform configuration
 * 
 * Request Body:
 * {
 *   "platform": "facebook",
 *   "testRecipientId": "1234567890"
 * }
 */
router.post('/test-platform', socialMediaController.testPlatformConfiguration);

/**
 * GET /api/v1/social-media/dashboard-metrics
 * Get comprehensive dashboard metrics for all communications
 */
router.get('/dashboard-metrics', socialMediaController.getDashboardMetrics);

/**
 * Isolated B2C/C2C Social Scraping Jobs Endpoints
 */
router.post('/scrape', socialMediaController.startSocialScrapeJob);
router.get('/jobs', socialMediaController.getSocialScrapeJobs);
router.get('/jobs/:jobId', socialMediaController.getSocialScrapeJobStatus);

module.exports = router;
