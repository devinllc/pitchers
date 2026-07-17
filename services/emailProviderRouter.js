/**
 * Email Provider Router
 * Routes emails to appropriate provider (SendGrid or SMTP) based on user preference
 */

const SendGridService = require('./sendGridService');
const SMTPService = require('./smtpService');
const SmtpConnection = require('../models/SmtpConnection');
const DatabaseService = require('./database');

class EmailProviderRouter {
    constructor() {
        this.sendgridService = new SendGridService();
        this.smtpService = new SMTPService();
        this.databaseService = new DatabaseService();
        this.smtpConnection = new SmtpConnection(this.databaseService);
    }

    /**
     * Send email via best available provider
     * @param {string} userEmail - User email (account owner)
     * @param {string} toEmail - Recipient email
     * @param {string} subject - Email subject
     * @param {string} htmlContent - Email HTML content
     * @param {Object} options - Additional options {provider: 'sendgrid'|'smtp', connectionId}
     * @returns {Object} Send result
     */
    async sendEmail(userEmail, toEmail, subject, htmlContent, options = {}) {
        try {
            const { provider, connectionId } = options;

            // If provider specified, use it
            if (provider === 'sendgrid') {
                return await this.sendViaProvider('sendgrid', toEmail, subject, htmlContent);
            }

            if (provider === 'smtp' && connectionId) {
                return await this.sendViaProvider('smtp', toEmail, subject, htmlContent, connectionId);
            }

            // Otherwise, use smart routing
            return await this.smartRoute(userEmail, toEmail, subject, htmlContent);

        } catch (error) {
            console.error('❌ Error routing email:', error);
            throw error;
        }
    }

    /**
     * Send via specific provider
     * @private
     */
    async sendViaProvider(provider, toEmail, subject, htmlContent, connectionId = null) {
        try {
            if (provider === 'sendgrid') {
                return await this.sendgridService.sendEmail(toEmail, subject, htmlContent);
            }

            if (provider === 'smtp' && connectionId) {
                return await this.smtpService.sendEmail(connectionId, toEmail, subject, htmlContent);
            }

            throw new Error('Invalid provider or missing configuration');

        } catch (error) {
            console.error(`❌ Error sending via ${provider}:`, error);
            throw error;
        }
    }

    /**
     * Smart routing: Try preferred provider first, fallback to other
     * @private
     */
    async smartRoute(userEmail, toEmail, subject, htmlContent) {
        try {
            // Get user's default SMTP connection if available
            const defaultSMTP = await this.smtpConnection.getDefaultConnection(userEmail);

            // Priority: SMTP (if available and quota) > SendGrid
            if (defaultSMTP) {
                const canSend = await this.smtpService.smtpConnection.canSendEmail(defaultSMTP.connection_id);

                if (canSend) {
                    try {
                        console.log(`📧 Routing email via SMTP: ${defaultSMTP.provider_name}`);
                        return await this.smtpService.sendEmail(
                            defaultSMTP.connection_id,
                            toEmail,
                            subject,
                            htmlContent
                        );
                    } catch (smtpError) {
                        console.warn('⚠️ SMTP failed, falling back to SendGrid:', smtpError.message);
                        // Fall through to SendGrid
                    }
                } else {
                    console.warn('⚠️ SMTP daily limit reached, using SendGrid');
                    // Fall through to SendGrid
                }
            }

            // Fallback to SendGrid
            console.log('📧 Routing email via SendGrid');
            return await this.sendgridService.sendEmail(toEmail, subject, htmlContent);

        } catch (error) {
            console.error('❌ Smart routing failed:', error);
            throw error;
        }
    }

    /**
     * Send bulk emails with smart provider routing
     * @param {string} userEmail - User email
     * @param {Array} recipients - Array of {email, subject, htmlContent}
     * @param {number} delayMs - Delay between emails
     * @returns {Object} Bulk send results
     */
    async sendBulkEmails(userEmail, recipients, delayMs = 1000) {
        try {
            const results = [];
            const defaultSMTP = await this.smtpConnection.getDefaultConnection(userEmail);

            for (let i = 0; i < recipients.length; i++) {
                const recipient = recipients[i];

                try {
                    let result;

                    // Try SMTP first if available
                    if (defaultSMTP) {
                        const canSend = await this.smtpService.smtpConnection.canSendEmail(defaultSMTP.connection_id);
                        if (canSend) {
                            result = await this.smtpService.sendEmail(
                                defaultSMTP.connection_id,
                                recipient.email,
                                recipient.subject,
                                recipient.htmlContent,
                                recipient.options
                            );
                        } else {
                            // SMTP limit reached, use SendGrid
                            result = await this.sendgridService.sendEmail(
                                recipient.email,
                                recipient.subject,
                                recipient.htmlContent
                            );
                        }
                    } else {
                        // No SMTP, use SendGrid
                        result = await this.sendgridService.sendEmail(
                            recipient.email,
                            recipient.subject,
                            recipient.htmlContent
                        );
                    }

                    // Update status in database if lead has an ID
                    if (recipient.id) {
                        const query = `UPDATE business_data SET status = 'Contacted - Email', updated_at = NOW() WHERE id = $1 AND user_email = $2`;
                        await this.databaseService.pool.query(query, [recipient.id, userEmail]).catch(e => console.error('Error updating email status for lead:', e));
                    }

                    results.push({
                        email: recipient.email,
                        ...result
                    });

                } catch (error) {
                    const errorMsg = error.message || error.error || error;

                    if (recipient.id) {
                        const query = `UPDATE business_data SET status = 'Failed - Email', notes = CONCAT(COALESCE(notes, ''), '\nEmail Fail: ', $1::text), updated_at = NOW() WHERE id = $2 AND user_email = $3`;
                        await this.databaseService.pool.query(query, [String(errorMsg), recipient.id, userEmail]).catch(e => console.error('Error updating email fail status for lead:', e));
                    }

                    results.push({
                        email: recipient.email,
                        success: false,
                        error: errorMsg
                    });
                }

                // Rate limiting
                if (i < recipients.length - 1) {
                    await new Promise(resolve => setTimeout(resolve, delayMs));
                }
            }

            return {
                total: recipients.length,
                successful: results.filter(r => r.success).length,
                failed: results.filter(r => !r.success).length,
                results
            };

        } catch (error) {
            console.error('❌ Error in bulk email routing:', error);
            throw error;
        }
    }

    /**
     * Get user's available email providers
     * @param {string} userEmail - User email
     * @returns {Object} Available providers
     */
    async getAvailableProviders(userEmail) {
        try {
            const smtpConnections = await this.smtpConnection.getConnectionsByUser(userEmail);
            const hasDefaultSMTP = smtpConnections.some(c => c.is_default && c.is_active);

            return {
                sendgrid: {
                    available: !!process.env.SENDGRID_API_KEY,
                    name: 'SendGrid',
                    description: 'Cloud email service with tracking',
                    daily_limit: 100 // free tier limit
                },
                smtp: {
                    available: smtpConnections.length > 0,
                    default: hasDefaultSMTP,
                    connections: smtpConnections.map(c => ({
                        connection_id: c.connection_id,
                        provider_name: c.provider_name,
                        sender_email: c.sender_email,
                        is_default: c.is_default,
                        daily_limit: c.daily_limit,
                        daily_sent_count: c.daily_sent_count,
                        remaining: Math.max(0, c.daily_limit - c.daily_sent_count)
                    }))
                }
            };

        } catch (error) {
            console.error('❌ Error getting available providers:', error);
            throw error;
        }
    }
}

module.exports = EmailProviderRouter;
