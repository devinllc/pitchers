const express = require('express');
const router = express.Router();
const ApiKeyAuthMiddleware = require('../middleware/apiKeyAuth');
const automationController = require('../controllers/automationController');

const apiKeyAuth = new ApiKeyAuthMiddleware();

router.use(apiKeyAuth.authenticate());

router.post('/create', automationController.createAndExecuteAutomation);
router.get('/', automationController.getUserCampaigns);
router.get('/:campaignId', automationController.getCampaignStatus);
router.get('/:campaignId/executions', automationController.getCampaignExecutions);
router.post('/:campaignId/pause', automationController.pauseCampaign);
router.post('/:campaignId/resume', automationController.resumeCampaign);

module.exports = router;
