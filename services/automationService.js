/**
 * Automation Service
 * Handles execution of automated campaigns (followups, pitches, cold DMs, responses)
 */

const { v4: uuidv4 } = require('uuid');
const DatabaseService = require('./database');
const pool = new DatabaseService().pool;
const SendGridService = require('./sendGridService');
const TwilioService = require('./twilioService');
const SMTPService = require('./smtpService');
const smtpService = new SMTPService();

class AutomationService {
  /**
   * Create a new automation campaign
   */
  async createCampaign(userEmail, campaignType, leads, automationConfig = {}) {
    const campaignId = `camp_${Date.now()}_${uuidv4().substring(0, 8)}`;
    
    try {
      // Insert campaign
      const campaignQuery = `
        INSERT INTO automation_campaigns 
        (campaign_id, user_email, campaign_type, total_leads, status, config)
        VALUES ($1, $2, $3, $4, $5, $6)
        RETURNING *
      `;
      
      const campaignResult = await pool.query(campaignQuery, [
        campaignId,
        userEmail,
        campaignType,
        leads.length,
        'draft',
        JSON.stringify(automationConfig)
      ]);

      console.log(`✅ Campaign created: ${campaignId}`);
      return campaignResult.rows[0];
    } catch (error) {
      console.error('❌ Campaign creation failed:', error);
      throw error;
    }
  }

  /**
   * Add leads to a campaign
   */
  async addLeadsToCampaign(campaignId, leads, messageTemplate, campaignType, userEmail) {
    const executionIds = [];

    try {
      for (const lead of leads) {
        const executionId = `exec_${Date.now()}_${uuidv4().substring(0, 8)}`;
        const channel = lead.channel || 'email';
        
        const query = `
          INSERT INTO automation_executions 
          (execution_id, campaign_id, lead_id, user_email, campaign_type, contact_channel, 
           lead_email, lead_phone, lead_name, business_name, message_template, status)
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
          RETURNING *
        `;

        await pool.query(query, [
          executionId,
          campaignId,
          lead.id,
          lead.userEmail || userEmail,
          campaignType,
          channel,
          lead.email || null,
          lead.phone || null,
          lead.name || null,
          lead.business_name || null,
          messageTemplate,
          'pending'
        ]);

        executionIds.push(executionId);
      }

      console.log(`✅ Added ${leads.length} leads to campaign ${campaignId}`);
      return executionIds;
    } catch (error) {
      console.error('❌ Error adding leads to campaign:', error);
      throw error;
    }
  }

  /**
   * Execute a campaign - send all pending messages
   */
  async executeCampaign(campaignId, delay = 1000) {
    try {
      console.log(`🚀 Starting campaign execution: ${campaignId}`);

      // Update campaign status to running
      await pool.query(
        'UPDATE automation_campaigns SET status = $1, started_at = NOW() WHERE campaign_id = $2',
        ['running', campaignId]
      );

      // Get all pending executions
      const pendingQuery = `
        SELECT * FROM automation_executions 
        WHERE campaign_id = $1 AND status = 'pending'
        ORDER BY created_at ASC
      `;

      const result = await pool.query(pendingQuery, [campaignId]);
      const pendingExecutions = result.rows;

      if (pendingExecutions.length === 0) {
        console.log(`⚠️  No pending executions for campaign ${campaignId}`);
        return { sent: 0, failed: 0 };
      }

      let sent = 0;
      let failed = 0;

      // Process each execution with delay to prevent rate limiting
      for (const execution of pendingExecutions) {
        try {
          await this.sendMessage(execution);
          sent++;
        } catch (error) {
          console.error(`❌ Failed to send message for execution ${execution.execution_id}:`, error);
          failed++;
          
          // Log the failure
          await pool.query(
            `UPDATE automation_executions 
             SET status = 'failed', failed_at = NOW(), error_message = $1 
             WHERE execution_id = $2`,
            [error.message, execution.execution_id]
          );
        }

        // Add delay between sends (except for last one)
        if (pendingExecutions.indexOf(execution) < pendingExecutions.length - 1) {
          await new Promise(resolve => setTimeout(resolve, delay));
        }
      }

      // Update campaign stats
      await pool.query(
        `UPDATE automation_campaigns 
         SET leads_sent = leads_sent + $1, 
             leads_failed = leads_failed + $2,
             status = 'completed',
             completed_at = NOW()
         WHERE campaign_id = $3`,
        [sent, failed, campaignId]
      );

      console.log(`✅ Campaign ${campaignId} completed: ${sent} sent, ${failed} failed`);
      return { sent, failed, total: pendingExecutions.length };
    } catch (error) {
      console.error('❌ Campaign execution failed:', error);
      // Mark campaign as failed
      await pool.query(
        'UPDATE automation_campaigns SET status = $1, completed_at = NOW() WHERE campaign_id = $2',
        ['failed', campaignId]
      );
      throw error;
    }
  }

  /**
   * Send a single message based on channel
   */
  async sendMessage(execution) {
    const { contact_channel, execution_id, lead_email, lead_phone, message_template } = execution;

    try {
      let response;

      // Plan limit check for all automation channels (highest tier first)
      const apiKeyQuery = `
        SELECT id, automation_limit FROM api_keys 
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
      const apiKeyResult = await pool.query(apiKeyQuery, [execution.user_email]);
      
      if (apiKeyResult.rows.length > 0) {
        const apiKey = apiKeyResult.rows[0];
        if (apiKey.automation_limit <= 0) {
          throw new Error('Monthly automation limit reached for this plan');
        }
        // Decrement limit
        await pool.query('UPDATE api_keys SET automation_limit = automation_limit - 1 WHERE id = $1', [apiKey.id]);
      }

      if (contact_channel === 'email' && lead_email) {

        // Check if user has a custom SMTP connection
        const SmtpConnection = require('../models/SmtpConnection');
        const smtpConnModel = new SmtpConnection({ pool });
        const customConn = await smtpConnModel.getDefaultConnection(execution.user_email);

        if (customConn) {
          console.log(`📧 Sending email via custom SMTP (${customConn.sender_email})`);
          response = await smtpService.sendEmail(
            customConn.connection_id,
            lead_email,
            `${execution.campaign_type === 'followups' ? 'Follow-up' : 'Message'} from Pitchers`,
            message_template
          );
        } else {
          console.log(`📧 Sending email via SendGrid (fallback)`);
          response = await SendGridService.sendEmail({
            to: lead_email,
            subject: `${execution.campaign_type === 'followups' ? 'Follow-up' : 'Message'} from Pitchers`,
            html: message_template
          });
        }

        // Log email send
        await pool.query(
          `UPDATE automation_executions 
           SET status = 'sent', message_sent = $1, sent_at = NOW(), provider_response = $2
           WHERE execution_id = $3`,
          [message_template, JSON.stringify(response), execution_id]
        );

      } else if (contact_channel === 'whatsapp' && lead_phone) {
        response = await TwilioService.sendWhatsApp({
          phone: lead_phone,
          message: message_template
        });

        await pool.query(
          `UPDATE automation_executions 
           SET status = 'sent', message_sent = $1, sent_at = NOW(), provider_response = $2
           WHERE execution_id = $3`,
          [message_template, JSON.stringify(response), execution_id]
        );

      } else if (contact_channel === 'sms' && lead_phone) {
        response = await TwilioService.sendSMS({
          phone: lead_phone,
          message: message_template
        });

        await pool.query(
          `UPDATE automation_executions 
           SET status = 'sent', message_sent = $1, sent_at = NOW(), provider_response = $2
           WHERE execution_id = $3`,
          [message_template, JSON.stringify(response), execution_id]
        );

      } else {
        // No valid channel, mark as failed
        throw new Error(`No valid contact channel for execution ${execution_id}`);
      }

    } catch (error) {
      console.error(`❌ Failed to send message via ${contact_channel}:`, error);
      throw error;
    }
  }

  /**
   * Get campaign status
   */
  async getCampaignStatus(campaignId) {
    try {
      const query = `
        SELECT * FROM automation_campaigns 
        WHERE campaign_id = $1
      `;
      
      const result = await pool.query(query, [campaignId]);
      return result.rows[0] || null;
    } catch (error) {
      console.error('❌ Error getting campaign status:', error);
      throw error;
    }
  }

  /**
   * Get campaign executions/logs
   */
  async getCampaignExecutions(campaignId, limit = 100, offset = 0) {
    try {
      const query = `
        SELECT * FROM automation_executions 
        WHERE campaign_id = $1
        ORDER BY created_at DESC
        LIMIT $2 OFFSET $3
      `;
      
      const result = await pool.query(query, [campaignId, limit, offset]);
      
      // Get total count
      const countResult = await pool.query(
        'SELECT COUNT(*) as total FROM automation_executions WHERE campaign_id = $1',
        [campaignId]
      );

      return {
        executions: result.rows,
        total: parseInt(countResult.rows[0].total),
        limit,
        offset
      };
    } catch (error) {
      console.error('❌ Error getting campaign executions:', error);
      throw error;
    }
  }

  /**
   * Pause campaign
   */
  async pauseCampaign(campaignId) {
    try {
      await pool.query(
        'UPDATE automation_campaigns SET status = $1 WHERE campaign_id = $2',
        ['paused', campaignId]
      );
      console.log(`⏸️  Campaign paused: ${campaignId}`);
    } catch (error) {
      console.error('❌ Error pausing campaign:', error);
      throw error;
    }
  }

  /**
   * Resume campaign
   */
  async resumeCampaign(campaignId) {
    try {
      await pool.query(
        'UPDATE automation_campaigns SET status = $1, started_at = NOW() WHERE campaign_id = $2',
        ['running', campaignId]
      );
      
      // Execute pending messages
      // Run asynchronously so we don't block
      this.executeCampaign(campaignId).catch(err => {
        console.error(`❌ Background campaign execution failed for ${campaignId}:`, err.message);
      });
      
      console.log(`▶️  Campaign resumed: ${campaignId}`);
    } catch (error) {
      console.error('❌ Error resuming campaign:', error);
      throw error;
    }
  }

  /**
   * Resume all running campaigns on startup
   */
  async resumeAllRunningCampaigns() {
    try {
      const result = await pool.query(
        `SELECT campaign_id FROM automation_campaigns WHERE status = 'running'`
      );
      
      if (result.rows.length > 0) {
        console.log(`[Automation] Found ${result.rows.length} interrupted campaigns. Resuming...`);
        for (const row of result.rows) {
          // Fire and forget
          this.executeCampaign(row.campaign_id).catch(err => {
             console.error(`❌ Failed to resume campaign ${row.campaign_id}:`, err.message);
          });
        }
      }
    } catch (error) {
      console.error('❌ Error resuming all campaigns:', error.message);
    }
  }

  /**
   * Get user's campaigns
   */
  async getUserCampaigns(userEmail, limit = 50, offset = 0) {
    try {
      const query = `
        SELECT * FROM automation_campaigns 
        WHERE user_email = $1
        ORDER BY created_at DESC
        LIMIT $2 OFFSET $3
      `;
      
      const result = await pool.query(query, [userEmail, limit, offset]);
      
      // Get total count
      const countResult = await pool.query(
        'SELECT COUNT(*) as total FROM automation_campaigns WHERE user_email = $1',
        [userEmail]
      );

      return {
        campaigns: result.rows,
        total: parseInt(countResult.rows[0].total),
        limit,
        offset
      };
    } catch (error) {
      console.error('❌ Error getting user campaigns:', error);
      throw error;
    }
  }
}

module.exports = new AutomationService();
