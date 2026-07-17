/**
 * SMTP Email Service
 * Handles email sending via configured SMTP servers (Gmail, custom SMTP, etc.)
 */

const nodemailer = require('nodemailer');
const SmtpConnection = require('../models/SmtpConnection');
const DatabaseService = require('./database');
const EncryptionService = require('./encryptionService');

class SMTPService {
    constructor() {
        this.databaseService = new DatabaseService();
        this.smtpConnection = new SmtpConnection(this.databaseService);
        this.encryption = EncryptionService;
        this.transporters = new Map(); // Cache of SMTP transporters per connection
    }

    /**
     * Get or create SMTP transporter for a connection
     * @param {Object} connectionConfig - SMTP connection config from database
     * @returns {Object} Nodemailer transporter
     */
    async getOrCreateTransporter(connectionConfig) {
        const cacheKey = connectionConfig.connection_id;

        // Check if transporter is cached
        if (this.transporters.has(cacheKey)) {
            return this.transporters.get(cacheKey);
        }

        try {
            // Decrypt password
            let password = connectionConfig.password;
            try {
                // The decrypt function expects a base64 string and will throw if invalid
                const decrypted = this.encryption.decrypt(password);
                if (decrypted) password = decrypted;
            } catch (error) {
                // If it fails to decrypt, it might be an old unencrypted password or corrupted.
                // We'll pass the raw string and let SMTP auth fail gracefully if it's wrong.
            }

            // Create transporter
            const transporter = nodemailer.createTransport({
                host: connectionConfig.smtp_host,
                port: connectionConfig.smtp_port,
                secure: connectionConfig.encryption_type === 'SSL', // true for SSL, false for TLS
                auth: {
                    user: connectionConfig.username,
                    pass: password
                },
                from: `"${connectionConfig.sender_name}" <${connectionConfig.sender_email}>`,
                connectionTimeout: 10000, // 10 seconds timeout
                greetingTimeout: 10000,
                socketTimeout: 15000
            });

            // Cache transporter
            this.transporters.set(cacheKey, transporter);

            return transporter;

        } catch (error) {
            console.error('❌ Error creating SMTP transporter:', error);
            throw error;
        }
    }

    /**
     * Send single email
     * @param {string} connectionId - SMTP connection ID
     * @param {string} toEmail - Recipient email
     * @param {string} subject - Email subject
     * @param {string} htmlContent - Email HTML content
     * @param {Object} options - Additional options (cc, bcc, attachments, etc.)
     * @returns {Object} Send result
     */
    async sendEmail(connectionId, toEmail, subject, htmlContent, options = {}) {
        try {
            // Get connection config from database
            const connectionConfig = await this.smtpConnection.getConnectionById(connectionId);

            if (!connectionConfig) {
                throw new Error('SMTP connection not found');
            }

            // Check if can send (daily limit)
            const canSend = await this.smtpConnection.canSendEmail(connectionId);
            if (!canSend) {
                throw new Error('Daily email limit reached for this SMTP connection');
            }

            // Get or create transporter
            const transporter = await this.getOrCreateTransporter(connectionConfig);

            // Prepare email
            const mailOptions = {
                from: `"${connectionConfig.sender_name}" <${connectionConfig.sender_email}>`,
                to: toEmail,
                subject: subject,
                html: htmlContent,
                ...options
            };

            // Send email
            const info = await transporter.sendMail(mailOptions);

            // Update sent count
            await this.smtpConnection.updateDailySentCount(connectionId);

            console.log(`✅ Email sent via SMTP (${connectionConfig.provider_name}) to ${toEmail}:`, info.messageId);

            return {
                success: true,
                messageId: info.messageId,
                response: info.response,
                timestamp: new Date()
            };

        } catch (error) {
            console.error('❌ Error sending SMTP email:', error);
            throw {
                success: false,
                error: error.message
            };
        }
    }

    /**
     * Send bulk emails via SMTP with rate limiting
     * @param {string} connectionId - SMTP connection ID
     * @param {Array} recipients - Array of {email, subject, htmlContent}
     * @param {number} delayMs - Delay between emails (default: 1000ms)
     * @returns {Array} Results for each email
     */
    async sendBulkEmails(connectionId, recipients, delayMs = 1000) {
        try {
            const results = [];

            for (let i = 0; i < recipients.length; i++) {
                const recipient = recipients[i];

                try {
                    const result = await this.sendEmail(
                        connectionId,
                        recipient.email,
                        recipient.subject,
                        recipient.htmlContent,
                        recipient.options
                    );

                    results.push({
                        email: recipient.email,
                        ...result
                    });

                } catch (error) {
                    results.push({
                        email: recipient.email,
                        success: false,
                        error: error.message || error.error
                    });
                }

                // Rate limiting between emails (except for last one)
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
            console.error('❌ Error sending bulk emails:', error);
            throw error;
        }
    }

    /**
     * Test SMTP connection
     * @param {Object} config - SMTP config {host, port, user, pass, encryptionType}
     * @returns {Object} Test result
     */
    async testConnection(config) {
        try {
            const transporter = nodemailer.createTransport({
                host: config.host,
                port: config.port,
                secure: config.encryptionType === 'SSL',
                auth: {
                    user: config.user,
                    pass: config.pass
                },
                connectionTimeout: 10000,
                greetingTimeout: 10000,
                socketTimeout: 15000
            });

            // Test connection
            await transporter.verify();

            console.log('✅ SMTP connection verified');

            return {
                success: true,
                verified: true,
                message: 'SMTP connection successful'
            };

        } catch (error) {
            console.error('❌ SMTP connection test failed:', error);
            return {
                success: false,
                verified: false,
                error: error.message
            };
        }
    }

    /**
     * Get SMTP connection details (safe, no password)
     * @param {string} connectionId - Connection ID
     * @returns {Object} Connection details
     */
    async getConnectionDetails(connectionId) {
        try {
            const config = await this.smtpConnection.getConnectionById(connectionId);

            if (!config) {
                throw new Error('Connection not found');
            }

            // Don't return password
            delete config.password;

            return {
                success: true,
                connection: config
            };

        } catch (error) {
            console.error('❌ Error getting connection details:', error);
            throw error;
        }
    }

    /**
     * Check remaining email quota for a connection
     * @param {string} connectionId - Connection ID
     * @returns {Object} Quota info
     */
    async getQuotaInfo(connectionId) {
        try {
            const connection = await this.smtpConnection.getConnectionById(connectionId);

            if (!connection) {
                throw new Error('Connection not found');
            }

            const remaining = Math.max(0, connection.daily_limit - connection.daily_sent_count);

            return {
                success: true,
                daily_limit: connection.daily_limit,
                sent_today: connection.daily_sent_count,
                remaining,
                resets_at: connection.daily_reset_at
            };

        } catch (error) {
            console.error('❌ Error getting quota info:', error);
            throw error;
        }
    }

    /**
     * Invalidate transporter cache (call when updating connection)
     * @param {string} connectionId - Connection ID
     */
    invalidateTransporter(connectionId) {
        this.transporters.delete(connectionId);
    }
}

module.exports = SMTPService;
