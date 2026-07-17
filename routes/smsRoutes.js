/**
 * SMS Routes
 * Endpoints for SMS/WhatsApp automation via Twilio
 */

const express = require('express');
const router = express.Router();
const SMSQueueManager = require('../services/smsQueueManager');
const CampaignExecution = require('../models/CampaignExecution');
const DatabaseService = require('../services/database');

const smsQueue = new SMSQueueManager();
const databaseService = new DatabaseService();
const campaignExecution = new CampaignExecution(databaseService);

/**
 * POST /api/v1/sms/send
 * Send single SMS
 */
router.post('/send', async (req, res) => {
    try {
        const { phoneNumber, message } = req.body;

        if (!phoneNumber || !message) {
            return res.status(400).json({ error: 'Phone number and message required' });
        }

        const TwilioService = require('../services/twilioService');
        const twilioService = new TwilioService();

        const result = await twilioService.sendSMS({ phone: phoneNumber, message });

        res.json({
            success: true,
            message_id: result.sid,
            status: result.status,
            timestamp: new Date()
        });

    } catch (error) {
        console.error('Error sending SMS:', error);
        res.status(400).json({ error: error.message });
    }
});

/**
 * POST /api/v1/sms/send-bulk
 * Queue bulk SMS campaign
 */
router.post('/send-bulk', async (req, res) => {
    try {
        const {
            campaignId,
            recipients, // Array of {phoneNumber, message}
            staggerRate = 50, // messages per unit
            staggerUnit = 'per_minute' // 'per_minute' or 'per_hour'
        } = req.body;

        if (!campaignId || !recipients || !Array.isArray(recipients)) {
            return res.status(400).json({ error: 'Campaign ID and recipients array required' });
        }

        const result = await smsQueue.queueBulkSMS(campaignId, recipients, {
            staggerRate,
            staggerUnit
        });

        res.json(result);

    } catch (error) {
        console.error('Error queuing bulk SMS:', error);
        res.status(500).json({ error: error.message });
    }
});

/**
 * GET /api/v1/sms/queue-stats
 * Get SMS queue statistics
 */
router.get('/queue-stats', async (req, res) => {
    try {
        const { campaignId } = req.query;

        const stats = await smsQueue.getQueueStats(campaignId);

        res.json({
            success: true,
            stats
        });

    } catch (error) {
        console.error('Error getting queue stats:', error);
        res.status(500).json({ error: error.message });
    }
});

/**
 * POST /api/v1/sms/retry-failed
 * Manually trigger retry of failed messages
 */
router.post('/retry-failed', async (req, res) => {
    try {
        const result = await smsQueue.retryFailedSMS();

        res.json({
            success: true,
            retried: result.retried,
            message: `${result.retried} failed SMS messages retried`
        });

    } catch (error) {
        console.error('Error retrying failed SMS:', error);
        res.status(500).json({ error: error.message });
    }
});

/**
 * GET /api/v1/sms/campaign/:campaignId/status
 * Get campaign SMS delivery status
 */
router.get('/campaign/:campaignId/status', async (req, res) => {
    try {
        const { campaignId } = req.params;

        const stats = await campaignExecution.getCampaignStats(campaignId);

        res.json({
            success: true,
            campaign_id: campaignId,
            total_messages: stats.total,
            sent: stats.sent,
            delivered: stats.delivered,
            failed: stats.failed,
            bounced: stats.bounced,
            delivery_rate: stats.total > 0 ? ((stats.delivered / stats.total) * 100).toFixed(2) + '%' : 'N/A'
        });

    } catch (error) {
        console.error('Error getting campaign status:', error);
        res.status(500).json({ error: error.message });
    }
});

/**
 * GET /api/v1/sms/campaign/:campaignId/executions
 * Get all execution records for a campaign
 */
router.get('/campaign/:campaignId/executions', async (req, res) => {
    try {
        const { campaignId } = req.params;
        const { status } = req.query;

        const executions = await campaignExecution.getCampaignExecutions(
            campaignId,
            { status }
        );

        res.json({
            success: true,
            count: executions.length,
            executions: executions.map(e => ({
                execution_id: e.execution_id,
                phone: e.lead_phone,
                name: e.lead_name,
                status: e.status,
                sent_at: e.sent_at,
                delivered_at: e.delivered_at,
                error: e.error_message
            }))
        });

    } catch (error) {
        console.error('Error getting executions:', error);
        res.status(500).json({ error: error.message });
    }
});

module.exports = router;
