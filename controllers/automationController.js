/**
 * Automation Controller
 * Handles API requests for automation campaigns
 */

const automationService = require('../services/automationService');

/**
 * POST /api/v1/automation/create
 * Create and execute a new automation campaign
 */
async function createAndExecuteAutomation(req, res) {
  try {
    const userEmail = req.apiKey?.data?.user_email || req.headers['x-user-email'] || req.body.userEmail;
    const { campaignType, leads, automationConfig, executeNow = true, delay = 1000 } = req.body;

    // Validate inputs
    if (!userEmail || !campaignType || !leads || leads.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'Missing required fields: userEmail, campaignType, leads'
      });
    }

    const validTypes = ['followups', 'pitches', 'coldDms', 'responses', 'promotionDemo'];
    if (!validTypes.includes(campaignType)) {
      return res.status(400).json({
        success: false,
        error: `Invalid campaign type. Must be one of: ${validTypes.join(', ')}`
      });
    }

    // Create campaign
    const campaign = await automationService.createCampaign(
      userEmail,
      campaignType,
      leads,
      automationConfig
    );

    // Build message template from leads
    const messageTemplate = leads[0]?.message || 'Default message template';

    // Add leads to campaign
    const executionIds = await automationService.addLeadsToCampaign(
      campaign.campaign_id,
      leads,
      messageTemplate,
      campaignType,
      userEmail
    );

    // Execute immediately if requested
    if (executeNow) {
      // Run in background to avoid timeout
      automationService.executeCampaign(campaign.campaign_id, delay).catch(error => {
        console.error(`Background execution failed for ${campaign.campaign_id}:`, error);
      });

      return res.status(200).json({
        success: true,
        message: 'Campaign created and execution started',
        campaignId: campaign.campaign_id,
        campaignType,
        totalLeads: leads.length,
        status: 'running'
      });
    } else {
      return res.status(200).json({
        success: true,
        message: 'Campaign created (not executed)',
        campaignId: campaign.campaign_id,
        campaignType,
        totalLeads: leads.length,
        status: 'draft'
      });
    }
  } catch (error) {
    console.error('❌ Error creating automation:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to create automation campaign'
    });
  }
}

/**
 * GET /api/v1/automation/campaign/:campaignId
 * Get campaign status and details
 */
async function getCampaignStatus(req, res) {
  try {
    const { campaignId } = req.params;

    if (!campaignId) {
      return res.status(400).json({
        success: false,
        error: 'campaignId is required'
      });
    }

    const campaign = await automationService.getCampaignStatus(campaignId);

    if (!campaign) {
      return res.status(404).json({
        success: false,
        error: 'Campaign not found'
      });
    }

    res.status(200).json({
      success: true,
      campaign
    });
  } catch (error) {
    console.error('❌ Error getting campaign status:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
}

/**
 * GET /api/v1/automation/campaign/:campaignId/executions
 * Get campaign execution logs
 */
async function getCampaignExecutions(req, res) {
  try {
    const { campaignId } = req.params;
    const { limit = 100, offset = 0 } = req.query;

    if (!campaignId) {
      return res.status(400).json({
        success: false,
        error: 'campaignId is required'
      });
    }

    const result = await automationService.getCampaignExecutions(
      campaignId,
      parseInt(limit),
      parseInt(offset)
    );

    res.status(200).json({
      success: true,
      ...result
    });
  } catch (error) {
    console.error('❌ Error getting campaign executions:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
}

/**
 * GET /api/v1/automation/my-campaigns
 * Get user's campaigns
 */
async function getUserCampaigns(req, res) {
  try {
    const userEmail = req.apiKey?.data?.user_email || req.headers['x-user-email'] || req.query.userEmail;
    const { limit = 50, offset = 0 } = req.query;

    if (!userEmail) {
      return res.status(400).json({
        success: false,
        error: 'userEmail is required'
      });
    }

    const result = await automationService.getUserCampaigns(
      userEmail,
      parseInt(limit),
      parseInt(offset)
    );

    res.status(200).json({
      success: true,
      ...result
    });
  } catch (error) {
    console.error('❌ Error getting user campaigns:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
}

/**
 * POST /api/v1/automation/campaign/:campaignId/pause
 * Pause a campaign
 */
async function pauseCampaign(req, res) {
  try {
    const { campaignId } = req.params;

    if (!campaignId) {
      return res.status(400).json({
        success: false,
        error: 'campaignId is required'
      });
    }

    await automationService.pauseCampaign(campaignId);

    res.status(200).json({
      success: true,
      message: `Campaign ${campaignId} paused`
    });
  } catch (error) {
    console.error('❌ Error pausing campaign:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
}

/**
 * POST /api/v1/automation/campaign/:campaignId/resume
 * Resume a campaign
 */
async function resumeCampaign(req, res) {
  try {
    const { campaignId } = req.params;

    if (!campaignId) {
      return res.status(400).json({
        success: false,
        error: 'campaignId is required'
      });
    }

    await automationService.resumeCampaign(campaignId);

    res.status(200).json({
      success: true,
      message: `Campaign ${campaignId} resumed`
    });
  } catch (error) {
    console.error('❌ Error resuming campaign:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
}

module.exports = {
  createAndExecuteAutomation,
  getCampaignStatus,
  getCampaignExecutions,
  getUserCampaigns,
  pauseCampaign,
  resumeCampaign
};
