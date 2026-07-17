/**
 * Twilio Service
 * Handles SMS and WhatsApp message delivery for automation campaigns
 */

const twilio = require('twilio');
const config = require('../config/production');

// Initialize Twilio
const TWILIO_ACCOUNT_SID = process.env.TWILIO_ACCOUNT_SID || config.twilio?.accountSid;
const TWILIO_AUTH_TOKEN = process.env.TWILIO_AUTH_TOKEN || config.twilio?.authToken;
const TWILIO_PHONE_NUMBER = process.env.TWILIO_PHONE_NUMBER || config.twilio?.phoneNumber;
const TWILIO_WHATSAPP_NUMBER = process.env.TWILIO_WHATSAPP_NUMBER || config.twilio?.whatsappNumber;

let client = null;

if (TWILIO_ACCOUNT_SID && TWILIO_AUTH_TOKEN) {
  client = twilio(TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN);
} else {
  console.warn('⚠️  Twilio credentials not configured');
}

class TwilioService {
  async sendSMS(payload) {
    return TwilioService.sendSMS(payload);
  }

  async sendWhatsApp(payload) {
    return TwilioService.sendWhatsApp(payload);
  }

  async getMessageStatus(messageSid) {
    return TwilioService.getMessageStatus(messageSid);
  }

  async sendBatchSMS(phones, message, from) {
    return TwilioService.sendBatchSMS(phones, message, from);
  }

  async sendBatchWhatsApp(phones, message, from) {
    return TwilioService.sendBatchWhatsApp(phones, message, from);
  }

  /**
   * Send SMS message
   */
  static async sendSMS({ phone, message, from = TWILIO_PHONE_NUMBER }) {
    try {
      if (!client || !from) {
        throw new Error('Twilio SMS service not configured');
      }

      // Normalize phone number (should include country code)
      const normalizedPhone = phone.startsWith('+') ? phone : `+${phone}`;

      const result = await client.messages.create({
        body: message,
        from,
        to: normalizedPhone
      });

      console.log(`✅ SMS sent to ${normalizedPhone} (SID: ${result.sid})`);

      return {
        success: true,
        messageSid: result.sid,
        status: result.status,
        timestamp: new Date().toISOString()
      };
    } catch (error) {
      console.error(`❌ Failed to send SMS to ${phone}:`, error.message);
      throw new Error(`Twilio SMS error: ${error.message}`);
    }
  }

  /**
   * Send WhatsApp message
   */
  static async sendWhatsApp({ phone, message, from = TWILIO_WHATSAPP_NUMBER }) {
    try {
      if (!client || !from) {
        throw new Error('Twilio WhatsApp service not configured');
      }

      // Normalize phone number
      const normalizedPhone = phone.startsWith('+') ? phone : `+${phone}`;

      const result = await client.messages.create({
        contentSid: undefined, // Use body instead of contentSid for WhatsApp
        body: message,
        from: `whatsapp:${from}`,
        to: `whatsapp:${normalizedPhone}`
      });

      console.log(`✅ WhatsApp message sent to ${normalizedPhone} (SID: ${result.sid})`);

      return {
        success: true,
        messageSid: result.sid,
        status: result.status,
        timestamp: new Date().toISOString()
      };
    } catch (error) {
      console.error(`❌ Failed to send WhatsApp to ${phone}:`, error.message);
      throw new Error(`Twilio WhatsApp error: ${error.message}`);
    }
  }

  /**
   * Track message delivery status
   */
  static async getMessageStatus(messageSid) {
    try {
      if (!client) {
        throw new Error('Twilio service not configured');
      }

      const message = await client.messages(messageSid).fetch();

      return {
        success: true,
        messageSid: message.sid,
        status: message.status, // 'accepted', 'queued', 'sent', 'delivered', 'failed', etc.
        dateCreated: message.dateCreated,
        dateSent: message.dateSent,
        errorCode: message.errorCode,
        errorMessage: message.errorMessage
      };
    } catch (error) {
      console.error(`❌ Failed to get message status for ${messageSid}:`, error.message);
      throw error;
    }
  }

  /**
   * Send batch SMS messages
   */
  static async sendBatchSMS(phones, message, from = TWILIO_PHONE_NUMBER) {
    const results = [];
    const errors = [];

    try {
      if (!client) {
        throw new Error('Twilio SMS service not configured');
      }

      for (const phone of phones) {
        try {
          const result = await this.sendSMS({ phone, message, from });
          results.push({ phone, ...result });
        } catch (error) {
          errors.push({ phone, error: error.message });
        }

        // Add small delay to avoid rate limiting
        await new Promise(resolve => setTimeout(resolve, 100));
      }

      console.log(`✅ Batch SMS sent: ${results.length} success, ${errors.length} failed`);
      return { success: true, sent: results.length, failed: errors.length, results, errors };
    } catch (error) {
      console.error(`❌ Batch SMS sending failed:`, error.message);
      throw error;
    }
  }

  /**
   * Send batch WhatsApp messages
   */
  static async sendBatchWhatsApp(phones, message, from = TWILIO_WHATSAPP_NUMBER) {
    const results = [];
    const errors = [];

    try {
      if (!client) {
        throw new Error('Twilio WhatsApp service not configured');
      }

      for (const phone of phones) {
        try {
          const result = await this.sendWhatsApp({ phone, message, from });
          results.push({ phone, ...result });
        } catch (error) {
          errors.push({ phone, error: error.message });
        }

        // Add delay to avoid rate limiting
        await new Promise(resolve => setTimeout(resolve, 150));
      }

      console.log(`✅ Batch WhatsApp sent: ${results.length} success, ${errors.length} failed`);
      return { success: true, sent: results.length, failed: errors.length, results, errors };
    } catch (error) {
      console.error(`❌ Batch WhatsApp sending failed:`, error.message);
      throw error;
    }
  }
}

module.exports = TwilioService;
