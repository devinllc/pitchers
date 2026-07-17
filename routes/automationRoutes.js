/**
 * Automation Routes
 * Endpoints for creating and managing automation campaigns
 */

const express = require('express');
const router = express.Router();
const automationController = require('../controllers/automationController');
const ApiKeyAuthMiddleware = require('../middleware/apiKeyAuth');

const apiKeyAuth = new ApiKeyAuthMiddleware();

// All automation endpoints require API key authentication
router.use(apiKeyAuth.authenticate());

/**
 * POST /automation/create
 * Create and execute automation campaign
 */
router.post('/create', automationController.createAndExecuteAutomation);

/**
 * GET /automation/campaign/:campaignId
 * Get campaign status
 */
router.get('/campaign/:campaignId', automationController.getCampaignStatus);

/**
 * GET /automation/campaign/:campaignId/executions
 * Get campaign execution logs
 */
router.get('/campaign/:campaignId/executions', automationController.getCampaignExecutions);

/**
 * GET /automation/my-campaigns
 * Get user's campaigns
 */
router.get('/my-campaigns', automationController.getUserCampaigns);

/**
 * POST /automation/campaign/:campaignId/pause
 * Pause a campaign
 */
router.post('/campaign/:campaignId/pause', automationController.pauseCampaign);

/**
 * POST /automation/campaign/:campaignId/resume
 * Resume a campaign
 */
router.post('/campaign/:campaignId/resume', automationController.resumeCampaign);

module.exports = router;
