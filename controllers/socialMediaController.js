/**
 * Enhanced Automation Controller
 * Supports email, SMS, WhatsApp, and Social Media DMs
 */

const automationService = require('../services/automationService');
const socialMediaDMService = require('../services/socialMediaDMService');
const DatabaseService = require('../services/database');
const pool = new DatabaseService().pool;
const { v4: uuidv4 } = require('uuid');

/**
 * POST /api/v1/automation/social-dm
 * Send cold DMs across social media platforms
 */
async function sendSocialDMs(req, res) {
  try {
    const userEmail = req.user?.email || req.body.userEmail;
    const { 
      platforms, // ['facebook', 'instagram', 'linkedin', 'twitter']
      leads,
      message,
      mediaUrl,
      executeNow = true 
    } = req.body;

    // Validate inputs
    if (!userEmail || !platforms || platforms.length === 0 || !leads || leads.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'Missing required fields: userEmail, platforms[], leads[]'
      });
    }

    // Check available platforms
    const availablePlatforms = socialMediaDMService.getAvailablePlatforms();
    const requestedPlatforms = platforms.filter(p => availablePlatforms.includes(p.toLowerCase()));

    if (requestedPlatforms.length === 0) {
      return res.status(400).json({
        success: false,
        error: `No configured platforms available. Configured: ${availablePlatforms.join(', ')}`
      });
    }

    // Create campaign
    const campaignId = `camp_social_${Date.now()}_${uuidv4().substring(0, 8)}`;
    
    const campaignQuery = `
      INSERT INTO automation_campaigns 
      (campaign_id, user_email, campaign_type, total_leads, status, config, metadata)
      VALUES ($1, $2, $3, $4, $5, $6, $7)
      RETURNING *
    `;

    const campaignResult = await pool.query(campaignQuery, [
      campaignId,
      userEmail,
      'coldDms_social',
      leads.length * requestedPlatforms.length,
      'running',
      JSON.stringify({ platforms: requestedPlatforms, messageLength: message.length }),
      JSON.stringify({ mediaUrl: mediaUrl || null })
    ]);

    const results = {
      campaignId,
      timestamp: new Date(),
      platforms: {},
      summaryStats: {
        totalMessages: 0,
        successCount: 0,
        failureCount: 0,
        platformStats: {}
      }
    };

    // Send DMs for each platform
    for (const platform of requestedPlatforms) {
      const platformLeads = [];

      // Extract handles from leads for this platform
      for (const lead of leads) {
        const handle = socialMediaDMService.extractPlatformHandle(lead, platform);
        if (handle) {
          platformLeads.push({
            id: handle,
            original_id: lead.id,
            name: lead.name || lead.business_name,
            ...lead
          });
        }
      }

      if (platformLeads.length === 0) {
        results.platforms[platform] = {
          status: 'skipped',
          reason: `No ${platform} handles found in leads`
        };
        continue;
      }

      // Send bulk DMs via social media service
      const sendResult = await socialMediaDMService.sendBulkDMs(platform, platformLeads, message);

      results.platforms[platform] = sendResult;
      results.summaryStats.totalMessages += sendResult.totalSent;
      results.summaryStats.successCount += sendResult.successCount;
      results.summaryStats.failureCount += sendResult.failureCount;
      results.summaryStats.platformStats[platform] = {
        sent: sendResult.successCount,
        failed: sendResult.failureCount,
        successRate: sendResult.successRate
      };

      // Log each communication to database
      for (const result of sendResult.results) {
        const communicationId = `comm_${Date.now()}_${uuidv4().substring(0, 8)}`;
        
        const logQuery = `
          INSERT INTO social_media_communications 
          (communication_id, user_email, platform, recipient_handle, message, status, 
           campaign_type, campaign_id, provider_response, sent_at)
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
          ON CONFLICT DO NOTHING
        `;

        await pool.query(logQuery, [
          communicationId,
          userEmail,
          platform,
          result.recipientId,
          message,
          result.status,
          'coldDms_social',
          campaignId,
          JSON.stringify(result),
          result.timestamp
        ]);
      }
    }

    // Update campaign status
    await pool.query(
      `UPDATE automation_campaigns 
       SET leads_sent = $1, leads_failed = $2, status = $3, completed_at = NOW()
       WHERE campaign_id = $4`,
      [results.summaryStats.successCount, results.summaryStats.failureCount, 'completed', campaignId]
    );

    return res.status(200).json({
      success: true,
      campaign: results,
      message: `Social media DMs sent successfully`
    });

  } catch (error) {
    console.error('❌ Social DM campaign failed:', error);
    return res.status(500).json({
      success: false,
      error: error.message
    });
  }
}

/**
 * GET /api/v1/automation/communications
 * Get all communications (emails, SMS, WhatsApp, social DMs)
 */
async function getAllCommunications(req, res) {
  try {
    const userEmail = req.user?.email;
    const { 
      campaignType, 
      status, 
      platform,
      limit = 100,
      offset = 0 
    } = req.query;

    let query = `
      SELECT 
        campaign_id, campaign_type, COUNT(*) as total_messages,
        SUM(CASE WHEN status = 'sent' THEN 1 ELSE 0 END) as sent,
        SUM(CASE WHEN status = 'delivered' THEN 1 ELSE 0 END) as delivered,
        SUM(CASE WHEN status = 'opened' THEN 1 ELSE 0 END) as opened,
        SUM(CASE WHEN status = 'replied' THEN 1 ELSE 0 END) as replied,
        SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) as failed,
        MAX(created_at) as last_activity,
        array_agg(DISTINCT platform) as platforms
      FROM (
        SELECT campaign_id, campaign_type, status, created_at, NULL as platform FROM automation_executions WHERE user_email = $1
        UNION ALL
        SELECT campaign_id, campaign_type, status, created_at, platform FROM social_media_communications WHERE user_email = $1
      ) combined_communications
      WHERE user_email = $1
        ${campaignType ? 'AND campaign_type = $2' : ''}
        ${status ? 'AND status = $3' : ''}
    `;

    const params = [userEmail];
    if (campaignType) params.push(campaignType);
    if (status) params.push(status);

    query += ` GROUP BY campaign_id, campaign_type ORDER BY last_activity DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;
    params.push(limit, offset);

    const result = await pool.query(query, params);

    return res.status(200).json({
      success: true,
      communications: result.rows,
      total: result.rowCount
    });

  } catch (error) {
    console.error('❌ Get communications failed:', error);
    return res.status(500).json({
      success: false,
      error: error.message
    });
  }
}

/**
 * GET /api/v1/automation/communications/by-platform
 * Get communications grouped by platform
 */
async function getCommunicationsByPlatform(req, res) {
  try {
    const userEmail = req.user?.email;

    const query = `
      SELECT 
        platform,
        COUNT(*) as total_messages,
        SUM(CASE WHEN status IN ('sent', 'delivered', 'opened') THEN 1 ELSE 0 END) as successful,
        SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) as failed,
        SUM(CASE WHEN status = 'replied' THEN 1 ELSE 0 END) as replied,
        ROUND(
          (SUM(CASE WHEN status IN ('sent', 'delivered', 'opened') THEN 1 ELSE 0 END)::numeric / 
           NULLIF(COUNT(*), 0) * 100), 2
        ) as success_rate,
        MAX(updated_at) as last_activity
      FROM social_media_communications
      WHERE user_email = $1
      GROUP BY platform
      ORDER BY total_messages DESC
    `;

    const result = await pool.query(query, [userEmail]);

    return res.status(200).json({
      success: true,
      platforms: result.rows
    });

  } catch (error) {
    console.error('❌ Get platform stats failed:', error);
    return res.status(500).json({
      success: false,
      error: error.message
    });
  }
}

/**
 * GET /api/v1/automation/platform/available
 * Get list of available social media platforms
 */
async function getAvailablePlatforms(req, res) {
  try {
    const platforms = socialMediaDMService.getAvailablePlatforms();
    
    const platformDetails = {
      email: true, // Always available
      sms: !!process.env.TWILIO_ACCOUNT_SID,
      whatsapp: !!process.env.TWILIO_ACCOUNT_SID,
      facebook: socialMediaDMService.isAvailable('facebook'),
      instagram: socialMediaDMService.isAvailable('instagram'),
      linkedin: socialMediaDMService.isAvailable('linkedin'),
      twitter: socialMediaDMService.isAvailable('twitter')
    };

    return res.status(200).json({
      success: true,
      availablePlatforms: platforms,
      allChannels: platformDetails,
      message: `${platforms.length} platforms configured`
    });

  } catch (error) {
    console.error('❌ Get platforms failed:', error);
    return res.status(500).json({
      success: false,
      error: error.message
    });
  }
}

/**
 * POST /api/v1/automation/test-platform
 * Send test message to verify platform configuration
 */
async function testPlatformConfiguration(req, res) {
  try {
    const { platform, testRecipientId } = req.body;

    if (!platform || !testRecipientId) {
      return res.status(400).json({
        success: false,
        error: 'Missing platform or testRecipientId'
      });
    }

    const result = await socialMediaDMService.sendTestMessage(platform, testRecipientId);

    return res.status(result.success ? 200 : 400).json({
      success: result.success,
      result
    });

  } catch (error) {
    console.error('❌ Platform test failed:', error);
    return res.status(500).json({
      success: false,
      error: error.message
    });
  }
}

/**
 * GET /api/v1/automation/dashboard-metrics
 * Get comprehensive dashboard metrics for all communications
 */
async function getDashboardMetrics(req, res) {
  try {
    const userEmail = req.user?.email;

    // Get aggregated stats
    const statsQuery = `
      SELECT 
        COUNT(*) as total_campaigns,
        SUM(total_leads) as total_leads_targeted,
        SUM(leads_sent) as total_messages_sent,
        SUM(leads_failed) as total_messages_failed,
        COUNT(CASE WHEN status = 'completed' THEN 1 END) as completed_campaigns,
        COUNT(CASE WHEN status = 'running' THEN 1 END) as active_campaigns
      FROM automation_campaigns
      WHERE user_email = $1
    `;

    // Get channel breakdown
    const channelQuery = `
      SELECT 
        campaign_type,
        COUNT(*) as messages,
        SUM(CASE WHEN status = 'sent' THEN 1 ELSE 0 END) as sent,
        SUM(CASE WHEN status = 'opened' THEN 1 ELSE 0 END) as opened,
        SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) as failed
      FROM automation_executions
      WHERE user_email = $1
      GROUP BY campaign_type
    `;

    // Get platform breakdown (social media)
    const platformQuery = `
      SELECT 
        platform,
        COUNT(*) as messages,
        SUM(CASE WHEN status IN ('sent', 'delivered') THEN 1 ELSE 0 END) as sent,
        SUM(CASE WHEN status = 'replied' THEN 1 ELSE 0 END) as replied,
        SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) as failed
      FROM social_media_communications
      WHERE user_email = $1
      GROUP BY platform
    `;

    // Get recent activity
    const recentQuery = `
      SELECT 
        campaign_id, campaign_type, status, COUNT(*) as count, MAX(updated_at) as last_update
      FROM (
        SELECT campaign_id, campaign_type, status, updated_at FROM automation_executions WHERE user_email = $1
        UNION ALL
        SELECT campaign_id, campaign_type, status, updated_at FROM social_media_communications WHERE user_email = $1
      ) combined
      GROUP BY campaign_id, campaign_type, status
      ORDER BY last_update DESC
      LIMIT 10
    `;

    const [statsResult, channelResult, platformResult, recentResult] = await Promise.all([
      pool.query(statsQuery, [userEmail]),
      pool.query(channelQuery, [userEmail]),
      pool.query(platformQuery, [userEmail]),
      pool.query(recentQuery, [userEmail])
    ]);

    return res.status(200).json({
      success: true,
      metrics: {
        overview: statsResult.rows[0] || {},
        channels: channelResult.rows,
        platforms: platformResult.rows,
        recentActivity: recentResult.rows
      }
    });

  } catch (error) {
    console.error('❌ Get metrics failed:', error);
    return res.status(500).json({
      success: false,
      error: error.message
    });
  }
}

/**
 * Isolated Social Scraping Job controllers
 */
async function startSocialScrapeJob(req, res) {
  try {
    const userEmail = req.user?.email || req.body.userEmail;
    const { platform, segment, searchType, searchValue } = req.body;

    if (!userEmail || !platform || !segment || !searchType || !searchValue) {
      return res.status(400).json({
        success: false,
        error: 'Missing required fields: userEmail, platform, segment, searchType, searchValue'
      });
    }

    const socialScraperService = require('../services/socialScraperService');
    const jobInfo = await socialScraperService.startExtractionJob(
      platform,
      segment,
      searchType,
      searchValue,
      userEmail
    );

    return res.status(200).json({
      success: true,
      job: jobInfo,
      message: 'Social lead extraction job started'
    });
  } catch (error) {
    console.error('❌ Start social scrape job failed:', error);
    return res.status(500).json({
      success: false,
      error: error.message
    });
  }
}

async function getSocialScrapeJobs(req, res) {
  try {
    const userEmail = req.user?.email || req.query.userEmail;
    if (!userEmail) {
      return res.status(400).json({
        success: false,
        error: 'userEmail parameter is required'
      });
    }

    const socialJobManager = require('../services/socialJobManager');
    const jobs = await socialJobManager.getAllJobs();

    return res.status(200).json({
      success: true,
      jobs
    });
  } catch (error) {
    console.error('❌ Get social jobs failed:', error);
    return res.status(500).json({
      success: false,
      error: error.message
    });
  }
}

async function getSocialScrapeJobStatus(req, res) {
  try {
    const { jobId } = req.params;
    if (!jobId) {
      return res.status(400).json({
        success: false,
        error: 'jobId parameter is required'
      });
    }

    const socialJobManager = require('../services/socialJobManager');
    const status = await socialJobManager.getJobStatus(jobId);

    if (!status) {
      return res.status(404).json({
        success: false,
        error: 'Job not found'
      });
    }

    return res.status(200).json({
      success: true,
      job: status
    });
  } catch (error) {
    console.error('❌ Get social job status failed:', error);
    return res.status(500).json({
      success: false,
      error: error.message
    });
  }
}

module.exports = {
  sendSocialDMs,
  getAllCommunications,
  getCommunicationsByPlatform,
  getAvailablePlatforms,
  testPlatformConfiguration,
  getDashboardMetrics,
  startSocialScrapeJob,
  getSocialScrapeJobs,
  getSocialScrapeJobStatus
};
