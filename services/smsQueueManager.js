/**
 * SMS Queue Manager
 * Handles bulk SMS delivery with staggered rates and retry logic
 */

const TwilioService = require('./twilioService');
const CampaignExecution = require('../models/CampaignExecution');
const DatabaseService = require('./database');

class SMSQueueManager {
    constructor() {
        this.twilioService = new TwilioService();
        this.databaseService = new DatabaseService();
        this.campaignExecution = new CampaignExecution(this.databaseService);
        this.maxRetries = 3;
        this.retryDelays = [30000, 300000, 1800000]; // 30s, 5m, 30m
    }

    /**
     * Queue bulk SMS campaign
     * @param {string} campaignId - Campaign ID
     * @param {Array} recipients - Array of {phoneNumber, message, executionId}
     * @param {Object} options - {staggerRate, staggerUnit: 'per_minute'|'per_hour'}
     * @returns {Object} Queue info
     */
    async queueBulkSMS(campaignId, recipients, options = {}) {
        try {
            const {
                staggerRate = 50, // messages per unit
                staggerUnit = 'per_minute'
            } = options;

            // Calculate delay between messages
            let delayMs = 1000; // default 1 msg/sec
            if (staggerUnit === 'per_minute' && staggerRate > 0) {
                delayMs = Math.floor(60000 / staggerRate);
            } else if (staggerUnit === 'per_hour' && staggerRate > 0) {
                delayMs = Math.floor(3600000 / staggerRate);
            }

            console.log(`📱 SMS Queue: ${recipients.length} messages @ ${staggerRate} ${staggerUnit}, delay: ${delayMs}ms`);

            // Process in background
            this.processSMSQueue(recipients, delayMs, campaignId).catch(error => {
                console.error(`❌ SMS queue processing failed for campaign ${campaignId}:`, error);
            });

            return {
                success: true,
                campaignId,
                totalMessages: recipients.length,
                staggerRate,
                estimatedTime: Math.ceil((recipients.length * delayMs) / 1000),
                message: 'SMS campaign queued for delivery'
            };

        } catch (error) {
            console.error('❌ Error queueing bulk SMS:', error);
            throw error;
        }
    }

    /**
     * Process SMS queue with staggered delivery
     * @private
     */
    async processSMSQueue(recipients, delayMs, campaignId) {
        try {
            console.log(`⏳ Starting SMS queue processing for ${recipients.length} messages...`);

            for (let i = 0; i < recipients.length; i++) {
                const recipient = recipients[i];

                try {
                    // Send SMS
                    const result = await this.twilioService.sendSMS({
                        phone: recipient.phoneNumber,
                        message: recipient.message
                    });

                    // Update execution record
                    if (recipient.executionId) {
                        await this.campaignExecution.updateExecutionStatus(
                            recipient.executionId,
                            'sent',
                            {
                                providerMessageId: result.sid,
                                sentAt: new Date()
                            }
                        );
                    }

                    console.log(`✅ SMS ${i + 1}/${recipients.length} sent to ${recipient.phoneNumber}`);

                } catch (error) {
                    console.error(`❌ Failed to send SMS to ${recipient.phoneNumber}:`, error.message);

                    // Mark as failed in database
                    if (recipient.executionId) {
                        await this.campaignExecution.updateExecutionStatus(
                            recipient.executionId,
                            'failed',
                            {
                                errorMessage: error.message,
                                retryCount: 0
                            }
                        );
                    }
                }

                // Rate limiting (except for last message)
                if (i < recipients.length - 1) {
                    await new Promise(resolve => setTimeout(resolve, delayMs));
                }
            }

            console.log(`✅ SMS queue processing completed for campaign ${campaignId}`);

        } catch (error) {
            console.error('❌ SMS queue processing error:', error);
        }
    }

    /**
     * Retry failed SMS messages
     * Runs periodically (e.g., every 5 minutes)
     */
    async retryFailedSMS() {
        try {
            // Get failed executions
            const failed = await this.campaignExecution.getFailedExecutions(this.maxRetries);

            if (failed.length === 0) {
                return { retried: 0 };
            }

            console.log(`⏳ Retrying ${failed.length} failed SMS messages...`);

            let retried = 0;

            for (const execution of failed) {
                try {
                    // Check if enough time has passed for retry
                    const timeSinceUpdate = Date.now() - new Date(execution.updated_at).getTime();
                    const requiredDelay = this.retryDelays[execution.retry_count] || this.retryDelays[this.retryDelays.length - 1];

                    if (timeSinceUpdate < requiredDelay) {
                        continue; // Not ready to retry yet
                    }

                    // Send retry
                    const result = await this.twilioService.sendSMS({
                        phone: execution.lead_phone,
                        message: execution.rendered_message
                    });

                    // Update retry count
                    await this.campaignExecution.updateExecutionStatus(
                        execution.execution_id,
                        'sent',
                        {
                            providerMessageId: result.sid,
                            retryCount: execution.retry_count + 1
                        }
                    );

                    retried++;
                    console.log(`✅ SMS retry sent to ${execution.lead_phone} (attempt ${execution.retry_count + 2})`);

                } catch (error) {
                    console.error(`❌ SMS retry failed for ${execution.lead_phone}:`, error.message);

                    // Update retry count (will eventually exceed maxRetries)
                    await this.campaignExecution.updateExecutionStatus(
                        execution.execution_id,
                        'failed',
                        {
                            retryCount: execution.retry_count + 1,
                            errorMessage: error.message
                        }
                    );
                }
            }

            return { retried };

        } catch (error) {
            console.error('❌ Error retrying failed SMS:', error);
            throw error;
        }
    }

    /**
     * Get queue statistics
     * @param {string} campaignId - Campaign ID (optional, for specific campaign)
     * @returns {Object} Queue stats
     */
    async getQueueStats(campaignId = null) {
        try {
            let query = `
                SELECT 
                    COUNT(*) as total,
                    COUNT(CASE WHEN status = 'pending' THEN 1 END) as pending,
                    COUNT(CASE WHEN status = 'sent' THEN 1 END) as sent,
                    COUNT(CASE WHEN status = 'delivered' THEN 1 END) as delivered,
                    COUNT(CASE WHEN status = 'failed' THEN 1 END) as failed
                FROM campaign_executions
                WHERE campaign_type = 'sms'
            `;

            if (campaignId) {
                query += ` AND campaign_id = $1`;
            }

            query += ';';

            const result = await this.databaseService.pool.query(
                query,
                campaignId ? [campaignId] : []
            );

            return result.rows[0];

        } catch (error) {
            console.error('❌ Error getting queue stats:', error);
            throw error;
        }
    }
}

// Auto-run SMS retry every 5 minutes
setInterval(async () => {
    try {
        const manager = new SMSQueueManager();
        const result = await manager.retryFailedSMS();
        if (result.retried > 0) {
            console.log(`🔄 SMS retry cycle: ${result.retried} messages retried`);
        }
    } catch (error) {
        console.error('❌ SMS retry cycle failed:', error);
    }
}, 5 * 60 * 1000);

module.exports = SMSQueueManager;
