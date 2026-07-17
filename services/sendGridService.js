/**
 * SendGrid Service
 * Handles email delivery for automation campaigns
 */

const sgMail = require('@sendgrid/mail');
const config = require('../config/production');

// Initialize SendGrid
const SENDGRID_API_KEY = process.env.SENDGRID_API_KEY || config.sendgrid?.apiKey;
if (!SENDGRID_API_KEY) {
  console.warn('⚠️  SENDGRID_API_KEY not configured');
} else {
  sgMail.setApiKey(SENDGRID_API_KEY);
}

const FROM_EMAIL = process.env.SENDGRID_FROM_EMAIL || 'noreply@pitchers.ai';

class SendGridService {
  async sendEmail(payload) {
    return SendGridService.sendEmail(payload);
  }

  async sendBatchEmails(emails) {
    return SendGridService.sendBatchEmails(emails);
  }

  async getEmailStats(startDate, endDate) {
    return SendGridService.getEmailStats(startDate, endDate);
  }

  /**
   * Send automated email
   */
  static async sendEmail({ to, subject, html, from = FROM_EMAIL }) {
    try {
      if (!SENDGRID_API_KEY) {
        throw new Error('SendGrid API key not configured');
      }

      const msg = {
        to,
        from,
        subject,
        html,
        trackingSettings: {
          clickTracking: { enabled: true },
          openTracking: { enabled: true }
        }
      };

      const response = await sgMail.send(msg);
      console.log(`✅ Email sent to ${to} (Message ID: ${response[0].headers['x-message-id']})`);

      return {
        success: true,
        messageId: response[0].headers['x-message-id'],
        timestamp: new Date().toISOString()
      };
    } catch (error) {
      console.error(`❌ Failed to send email to ${to}:`, error.message);
      throw new Error(`SendGrid error: ${error.message}`);
    }
  }

  /**
   * Send batch emails
   */
  static async sendBatchEmails(emails) {
    const results = [];
    const errors = [];

    try {
      if (!SENDGRID_API_KEY) {
        throw new Error('SendGrid API key not configured');
      }

      // SendGrid batch limit is typically 1000 per request
      const batchSize = 1000;
      for (let i = 0; i < emails.length; i += batchSize) {
        const batch = emails.slice(i, i + batchSize);
        const msgs = batch.map(email => ({
          to: email.to,
          from: email.from || FROM_EMAIL,
          subject: email.subject,
          html: email.html,
          trackingSettings: {
            clickTracking: { enabled: true },
            openTracking: { enabled: true }
          }
        }));

        const response = await sgMail.sendMultiple({
          personalizations: msgs.map(msg => ({
            to: [{ email: msg.to }],
            subject: msg.subject
          })),
          from: { email: FROM_EMAIL },
          content: [{ type: 'text/html', value: msgs[0].html }]
        });

        results.push(...response);
      }

      console.log(`✅ Sent ${emails.length} batch emails`);
      return { success: true, sent: emails.length, results };
    } catch (error) {
      console.error(`❌ Batch email sending failed:`, error.message);
      throw new Error(`SendGrid batch error: ${error.message}`);
    }
  }

  /**
   * Get email statistics
   */
  static async getEmailStats(startDate, endDate) {
    try {
      if (!SENDGRID_API_KEY) {
        throw new Error('SendGrid API key not configured');
      }

      // This would require SendGrid API client initialization
      // For now, returning placeholder
      return {
        success: true,
        message: 'Email stats feature coming soon'
      };
    } catch (error) {
      console.error(`❌ Failed to get email stats:`, error.message);
      throw error;
    }
  }
}

module.exports = SendGridService;
