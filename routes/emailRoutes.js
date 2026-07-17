/**
 * Email Integration Routes
 * Endpoints for SMTP configuration, SendGrid setup, and email sending
 */

const express = require('express');
const router = express.Router();
const SMTPService = require('../services/smtpService');
const EmailProviderRouter = require('../services/emailProviderRouter');
const SmtpConnection = require('../models/SmtpConnection');
const DatabaseService = require('../services/database');
const EncryptionService = require('../services/encryptionService');

const smtpService = new SMTPService();
const emailRouter = new EmailProviderRouter();
const databaseService = new DatabaseService();
const smtpConnection = new SmtpConnection(databaseService);

/**
 * POST /api/v1/email/smtp/add
 * Add new SMTP connection
 */
router.post('/smtp/add', async (req, res) => {
    try {
        const {
            providerName,
            smtpHost,
            smtpPort,
            senderEmail,
            senderName,
            username,
            password,
            encryptionType = 'TLS'
        } = req.body;
        const userEmail = req.headers['x-user-email'] || req.body.user_email;

        if (!userEmail || !smtpHost || !smtpPort || !senderEmail || !username || !password) {
            return res.status(400).json({ error: 'Missing required fields' });
        }

        // Test connection first
        const testResult = await smtpService.testConnection({
            host: smtpHost,
            port: smtpPort,
            user: username,
            pass: password,
            encryptionType
        });

        if (!testResult.success) {
            return res.status(400).json({
                error: 'SMTP connection test failed',
                details: testResult.error
            });
        }

        // Encrypt password before storing
        const encryptedPassword = EncryptionService.encrypt(password);

        // Create connection in database
        const connectionId = `smtp_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
        const connection = await smtpConnection.createConnection({
            connectionId,
            userEmail,
            providerName,
            smtpHost,
            smtpPort,
            senderEmail,
            senderName,
            username,
            password: encryptedPassword,
            encryptionType
        });

        res.json({
            success: true,
            connection_id: connection.connection_id,
            provider_name: connection.provider_name,
            sender_email: connection.sender_email,
            message: 'SMTP connection added successfully'
        });

    } catch (error) {
        console.error('Error adding SMTP connection:', error);
        res.status(500).json({ error: error.message });
    }
});

/**
 * GET /api/v1/email/smtp/list
 * Get all SMTP connections for user
 */
router.get('/smtp/list', async (req, res) => {
    try {
        const userEmail = req.headers['x-user-email'] || req.query.user_email;

        if (!userEmail) {
            return res.status(400).json({ error: 'User email required' });
        }

        const connections = await smtpConnection.getConnectionsByUser(userEmail);

        res.json({
            success: true,
            connections: connections.map(c => ({
                connection_id: c.connection_id,
                provider_name: c.provider_name,
                sender_email: c.sender_email,
                sender_name: c.sender_name,
                is_default: c.is_default,
                is_active: c.is_active,
                verified_at: c.verified_at,
                daily_limit: c.daily_limit,
                daily_sent_count: c.daily_sent_count,
                remaining: Math.max(0, c.daily_limit - c.daily_sent_count)
            }))
        });

    } catch (error) {
        console.error('Error getting SMTP connections:', error);
        res.status(500).json({ error: error.message });
    }
});

/**
 * POST /api/v1/email/smtp/set-default
 * Set default SMTP connection
 */
router.post('/smtp/set-default', async (req, res) => {
    try {
        const { connectionId } = req.body;
        const userEmail = req.headers['x-user-email'] || req.body.user_email;

        if (!userEmail || !connectionId) {
            return res.status(400).json({ error: 'Missing required fields' });
        }

        const connection = await smtpConnection.setDefaultConnection(connectionId, userEmail);

        res.json({
            success: true,
            connection_id: connection.connection_id,
            message: 'Default SMTP connection set'
        });

    } catch (error) {
        console.error('Error setting default SMTP:', error);
        res.status(500).json({ error: error.message });
    }
});

/**
 * POST /api/v1/email/test-send
 * Send test email via specified provider
 */
router.post('/test-send', async (req, res) => {
    try {
        const { toEmail, subject = 'Test Email', provider, connectionId } = req.body;
        const userEmail = req.headers['x-user-email'] || req.body.user_email;

        if (!userEmail || !toEmail) {
            return res.status(400).json({ error: 'Missing required fields' });
        }

        const htmlContent = `
            <h1>Test Email</h1>
            <p>This is a test email from our platform.</p>
            <p>Sent at: ${new Date().toISOString()}</p>
        `;

        const result = await emailRouter.sendEmail(userEmail, toEmail, subject, htmlContent, {
            provider,
            connectionId
        });

        res.json({
            success: result.success,
            message_id: result.messageId,
            provider_used: provider || 'auto-routed',
            timestamp: result.timestamp
        });

    } catch (error) {
        console.error('Error sending test email:', error);
        res.status(400).json({ error: error.message || error.error });
    }
});

/**
 * POST /api/v1/email/send
 * Send email with template rendering
 */
router.post('/send', async (req, res) => {
    try {
        const {
            toEmail,
            subject,
            htmlContent,
            provider,
            connectionId,
            media,
            leadId
        } = req.body;
        const userEmail = req.headers['x-user-email'] || req.body.user_email;

        if (!userEmail || !toEmail || !subject || !htmlContent) {
            return res.status(400).json({ error: 'Missing required fields' });
        }

        const options = { provider, connectionId };
        if (media && media.data) {
            options.attachments = [{
                filename: media.filename || 'attachment.pdf',
                content: media.data,
                encoding: 'base64',
                contentType: media.mimeType || 'application/pdf'
            }];
        }

        const result = await emailRouter.sendEmail(userEmail, toEmail, subject, htmlContent, options);

        if (leadId && result.success) {
            const query = `UPDATE business_data SET status = 'Contacted - Email', updated_at = NOW() WHERE id = $1 AND user_email = $2`;
            await databaseService.pool.query(query, [leadId, userEmail]).catch(e => console.error('Error updating single email status for lead:', e));
        }

        res.json({
            success: result.success,
            message_id: result.messageId,
            timestamp: result.timestamp
        });

    } catch (error) {
        console.error('Error sending email:', error);
        res.status(400).json({ error: error.message || error.error });
    }
});

/**
 * POST /api/v1/email/send-bulk
 * Send bulk emails with rate limiting
 */
router.post('/send-bulk', async (req, res) => {
    try {
        const { recipients, delayMs = 1000, media } = req.body;
        const userEmail = req.headers['x-user-email'] || req.body.user_email;

        if (!userEmail || !recipients || !Array.isArray(recipients)) {
            return res.status(400).json({ error: 'Recipients array required' });
        }

        // Format bulk media attachment if present
        const formattedRecipients = recipients.map(r => {
            const opt = { ...r.options };
            if (media && media.data) {
                opt.attachments = [{
                    filename: media.filename || 'attachment.pdf',
                    content: media.data,
                    encoding: 'base64',
                    contentType: media.mimeType || 'application/pdf'
                }];
            }
            return {
                ...r,
                options: opt
            };
        });

        const results = await emailRouter.sendBulkEmails(userEmail, formattedRecipients, delayMs);

        res.json({
            success: true,
            total: results.total,
            successful: results.successful,
            failed: results.failed,
            results: results.results
        });

    } catch (error) {
        console.error('Error sending bulk emails:', error);
        res.status(500).json({ error: error.message });
    }
});

/**
 * GET /api/v1/email/providers
 * Get available email providers for user
 */
router.get('/providers', async (req, res) => {
    try {
        const userEmail = req.headers['x-user-email'] || req.query.user_email;

        if (!userEmail) {
            return res.status(400).json({ error: 'User email required' });
        }

        const providers = await emailRouter.getAvailableProviders(userEmail);

        res.json({
            success: true,
            providers
        });

    } catch (error) {
        console.error('Error getting providers:', error);
        res.status(500).json({ error: error.message });
    }
});

/**
 * POST /api/v1/email/quota
 * Get email quota for a connection
 */
router.post('/quota', async (req, res) => {
    try {
        const { connectionId } = req.body;

        if (!connectionId) {
            return res.status(400).json({ error: 'Connection ID required' });
        }

        const quota = await smtpService.getQuotaInfo(connectionId);

        res.json({
            success: true,
            quota: quota
        });

    } catch (error) {
        console.error('Error getting quota:', error);
        res.status(500).json({ error: error.message });
    }
});

/**
 * DELETE /api/v1/email/smtp/:connectionId
 * Delete SMTP connection
 */
router.delete('/smtp/:connectionId', async (req, res) => {
    try {
        const { connectionId } = req.params;

        const deleted = await smtpConnection.deleteConnection(connectionId);

        if (!deleted) {
            return res.status(404).json({ error: 'Connection not found' });
        }

        // Invalidate cached transporter
        smtpService.invalidateTransporter(connectionId);

        res.json({
            success: true,
            message: 'SMTP connection deleted'
        });

    } catch (error) {
        console.error('Error deleting connection:', error);
        res.status(500).json({ error: error.message });
    }
});

module.exports = router;
