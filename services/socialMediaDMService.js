/**
 * Social Media DM Service
 * Handles sending direct messages across all social platforms
 * (Facebook, Instagram, LinkedIn, Twitter/X)
 */

const axios = require('axios');

class SocialMediaDMService {
  constructor() {
    this.facebook = process.env.FACEBOOK_PAGE_ACCESS_TOKEN;
    this.instagram = process.env.INSTAGRAM_BUSINESS_ACCOUNT_TOKEN;
    this.linkedin = process.env.LINKEDIN_API_TOKEN;
    this.twitter = process.env.TWITTER_API_TOKEN;
  }

  /**
   * Send Facebook DM
   */
  async sendFacebookDM(recipientId, message, mediaUrl = null) {
    try {
      if (!this.facebook) {
        throw new Error('Facebook token not configured');
      }

      const payload = {
        recipient: { id: recipientId },
        message: {
          text: message
        }
      };

      // Add media if provided
      if (mediaUrl) {
        payload.message.attachment = {
          type: 'image',
          payload: {
            url: mediaUrl
          }
        };
      }

      const response = await axios.post(
        `https://graph.facebook.com/v18.0/me/messages`,
        payload,
        {
          params: {
            access_token: this.facebook
          }
        }
      );

      return {
        success: true,
        provider: 'facebook',
        messageId: response.data.message_id,
        timestamp: new Date(),
        status: 'sent'
      };
    } catch (error) {
      console.error('❌ Facebook DM failed:', error.message);
      return {
        success: false,
        provider: 'facebook',
        error: error.message,
        timestamp: new Date(),
        status: 'failed'
      };
    }
  }

  /**
   * Send Instagram DM
   */
  async sendInstagramDM(recipientId, message, mediaUrl = null) {
    try {
      if (!this.instagram) {
        throw new Error('Instagram token not configured');
      }

      const payload = {
        recipient_type: 'individual',
        message_type: 'MESSAGE',
        to: recipientId,
        message: {
          text: message
        }
      };

      if (mediaUrl) {
        payload.message.image = {
          link: mediaUrl
        };
      }

      const response = await axios.post(
        `https://graph.instagram.com/v18.0/me/messages`,
        payload,
        {
          params: {
            access_token: this.instagram
          }
        }
      );

      return {
        success: true,
        provider: 'instagram',
        messageId: response.data.message_id,
        timestamp: new Date(),
        status: 'sent'
      };
    } catch (error) {
      console.error('❌ Instagram DM failed:', error.message);
      return {
        success: false,
        provider: 'instagram',
        error: error.message,
        timestamp: new Date(),
        status: 'failed'
      };
    }
  }

  /**
   * Send LinkedIn DM
   */
  async sendLinkedInDM(recipientUrn, message) {
    try {
      if (!this.linkedin) {
        throw new Error('LinkedIn API token not configured');
      }

      // LinkedIn DM API requires URN format: urn:li:person:{ID}
      const payload = {
        elementContent: {
          'com.linkedin.voyager.messaging.create.MessageContent': {
            attributesDetail: {},
            body: message
          }
        },
        attachmentContent: {},
        mediaContent: {},
        recipients: [recipientUrn],
        subject: ''
      };

      const response = await axios.post(
        `https://api.linkedin.com/v2/messaging/conversations?action=CREATE`,
        {
          participants: [recipientUrn],
          message: {
            body: message
          }
        },
        {
          headers: {
            'Authorization': `Bearer ${this.linkedin}`,
            'Content-Type': 'application/json'
          }
        }
      );

      return {
        success: true,
        provider: 'linkedin',
        conversationId: response.data.entityUrn,
        timestamp: new Date(),
        status: 'sent'
      };
    } catch (error) {
      console.error('❌ LinkedIn DM failed:', error.message);
      return {
        success: false,
        provider: 'linkedin',
        error: error.message,
        timestamp: new Date(),
        status: 'failed'
      };
    }
  }

  /**
   * Send Twitter/X DM
   */
  async sendTwitterDM(recipientId, message) {
    try {
      if (!this.twitter) {
        throw new Error('Twitter API token not configured');
      }

      const response = await axios.post(
        `https://api.twitter.com/2/dm_conversations/with/${recipientId}/messages`,
        {
          text: message
        },
        {
          headers: {
            'Authorization': `Bearer ${this.twitter}`,
            'Content-Type': 'application/json'
          }
        }
      );

      return {
        success: true,
        provider: 'twitter',
        messageId: response.data.data.dm_event_id,
        timestamp: new Date(),
        status: 'sent'
      };
    } catch (error) {
      console.error('❌ Twitter DM failed:', error.message);
      return {
        success: false,
        provider: 'twitter',
        error: error.message,
        timestamp: new Date(),
        status: 'failed'
      };
    }
  }

  /**
   * Send DM via specified platform
   */
  async sendDMByPlatform(platform, recipientId, message, mediaUrl = null) {
    switch (platform.toLowerCase()) {
      case 'facebook':
        return this.sendFacebookDM(recipientId, message, mediaUrl);
      case 'instagram':
        return this.sendInstagramDM(recipientId, message, mediaUrl);
      case 'linkedin':
        return this.sendLinkedInDM(recipientId, message);
      case 'twitter':
      case 'x':
        return this.sendTwitterDM(recipientId, message);
      default:
        throw new Error(`Unsupported platform: ${platform}`);
    }
  }

  /**
   * Send bulk DMs across platform
   */
  async sendBulkDMs(platform, recipients, message, delay = 1000) {
    const results = [];
    let successCount = 0;
    let failureCount = 0;

    for (let i = 0; i < recipients.length; i++) {
      const recipient = recipients[i];
      
      try {
        const result = await this.sendDMByPlatform(platform, recipient.id, message);
        results.push({
          recipientId: recipient.id,
          ...result
        });

        if (result.success) successCount++;
        else failureCount++;

        // Add delay between sends to avoid rate limiting
        if (i < recipients.length - 1) {
          await new Promise(resolve => setTimeout(resolve, delay));
        }
      } catch (error) {
        failureCount++;
        results.push({
          recipientId: recipient.id,
          success: false,
          error: error.message,
          timestamp: new Date()
        });
      }
    }

    return {
      platform,
      totalSent: results.length,
      successCount,
      failureCount,
      successRate: ((successCount / results.length) * 100).toFixed(2) + '%',
      results,
      timestamp: new Date()
    };
  }

  /**
   * Get social media handle from lead data
   */
  extractPlatformHandle(lead, platform) {
    const handleMap = {
      facebook: ['facebook_url', 'facebook_handle', 'facebook_id'],
      instagram: ['instagram_url', 'instagram_handle', 'instagram_id'],
      linkedin: ['linkedin_url', 'linkedin_handle', 'linkedin_id'],
      twitter: ['twitter_url', 'twitter_handle', 'twitter_id', 'x_url', 'x_handle'],
      x: ['twitter_url', 'twitter_handle', 'twitter_id', 'x_url', 'x_handle']
    };

    const possibleFields = handleMap[platform.toLowerCase()] || [];
    
    for (const field of possibleFields) {
      if (lead[field]) {
        return lead[field];
      }
    }

    return null;
  }

  /**
   * Check platform availability (token configured)
   */
  isAvailable(platform) {
    const availability = {
      facebook: !!this.facebook,
      instagram: !!this.instagram,
      linkedin: !!this.linkedin,
      twitter: !!this.twitter,
      x: !!this.twitter
    };

    return availability[platform.toLowerCase()] || false;
  }

  /**
   * Get all available platforms
   */
  getAvailablePlatforms() {
    const platforms = [];
    if (this.facebook) platforms.push('facebook');
    if (this.instagram) platforms.push('instagram');
    if (this.linkedin) platforms.push('linkedin');
    if (this.twitter) platforms.push('twitter');
    return platforms;
  }

  /**
   * Send test message to verify platform connectivity
   */
  async sendTestMessage(platform, testRecipientId) {
    const testMessage = `🧪 Test message from Pitchers automation system - ${new Date().toISOString()}`;
    
    try {
      const result = await this.sendDMByPlatform(platform, testRecipientId, testMessage);
      return result;
    } catch (error) {
      return {
        success: false,
        provider: platform,
        error: error.message,
        timestamp: new Date()
      };
    }
  }
}

module.exports = new SocialMediaDMService();
