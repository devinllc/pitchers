/**
 * WhatsApp Meta API Service
 * Focused implementation of Meta Business Messaging API
 */

const axios = require('axios');

class WhatsAppMetaAPI {
    constructor() {
        this.apiVersion = 'v18.0';
        this.baseUrl = `https://graph.facebook.com/${this.apiVersion}`;
    }

    /**
     * Send template message (pre-approved templates for business messages)
     * @param {string} accessToken - Meta API token
     * @param {string} phoneNumberId - Phone number ID
     * @param {string} recipientPhone - Recipient phone (E.164)
     * @param {string} templateName - Template name (e.g., 'hello_world')
     * @param {Array} variables - Template variables (optional)
     * @returns {Object} Send response with message ID
     */
    async sendTemplateMessage(accessToken, phoneNumberId, recipientPhone, templateName, variables = []) {
        try {
            const url = `${this.baseUrl}/${phoneNumberId}/messages`;

            const payload = {
                messaging_product: 'whatsapp',
                to: recipientPhone.replace(/[^0-9+]/g, ''),
                type: 'template',
                template: {
                    name: templateName,
                    language: {
                        code: 'en_US'
                    }
                }
            };

            if (variables.length > 0) {
                payload.template.components = [{
                    type: 'body',
                    parameters: variables.map(v => ({ type: 'text', text: v }))
                }];
            }

            const response = await axios.post(url, payload, {
                headers: {
                    'Authorization': `Bearer ${accessToken}`,
                    'Content-Type': 'application/json'
                }
            });

            return {
                success: true,
                messageId: response.data.messages?.[0]?.id,
                status: 'sent'
            };

        } catch (error) {
            console.error('❌ Error sending template message:', error.response?.data);
            throw error;
        }
    }

    /**
     * Send text message
     * @param {string} accessToken - Meta API token
     * @param {string} phoneNumberId - Phone number ID
     * @param {string} recipientPhone - Recipient phone (E.164)
     * @param {string} messageText - Message text
     * @returns {Object} Send response
     */
    async sendTextMessage(accessToken, phoneNumberId, recipientPhone, messageText) {
        try {
            const url = `${this.baseUrl}/${phoneNumberId}/messages`;

            const payload = {
                messaging_product: 'whatsapp',
                to: recipientPhone.replace(/[^0-9+]/g, ''),
                type: 'text',
                text: {
                    body: messageText
                }
            };

            const response = await axios.post(url, payload, {
                headers: {
                    'Authorization': `Bearer ${accessToken}`,
                    'Content-Type': 'application/json'
                }
            });

            return {
                success: true,
                messageId: response.data.messages?.[0]?.id,
                status: 'sent',
                recipient: recipientPhone
            };

        } catch (error) {
            console.error('❌ Error sending text message:', error.response?.data);
            throw error;
        }
    }

    /**
     * Get message status
     * @param {string} accessToken - Meta API token
     * @param {string} messageId - Message ID
     * @returns {Object} Message status
     */
    async getMessageStatus(accessToken, messageId) {
        try {
            const url = `${this.baseUrl}/${messageId}`;

            const response = await axios.get(url, {
                params: { access_token: accessToken },
                headers: { 'Content-Type': 'application/json' }
            });

            return {
                messageId,
                status: response.data.status,
                timestamp: response.data.timestamp
            };

        } catch (error) {
            console.error('❌ Error getting message status:', error.response?.data);
            throw error;
        }
    }

    /**
     * Get phone number details
     * @param {string} accessToken - Meta API token
     * @param {string} phoneNumberId - Phone number ID
     * @returns {Object} Phone details
     */
    async getPhoneNumberDetails(accessToken, phoneNumberId) {
        try {
            const url = `${this.baseUrl}/${phoneNumberId}`;

            const response = await axios.get(url, {
                params: { access_token: accessToken },
                headers: { 'Content-Type': 'application/json' }
            });

            return {
                phoneNumberId,
                phoneNumber: response.data.display_phone_number,
                businessName: response.data.name,
                quality: response.data.quality_rating,
                verified: response.data.quality_rating !== 'FLAG_GREEN' ? false : true
            };

        } catch (error) {
            console.error('❌ Error getting phone details:', error.response?.data);
            throw error;
        }
    }

    /**
     * Get list of available templates
     * @param {string} accessToken - Meta API token
     * @param {string} businessAccountId - Business Account ID
     * @returns {Array} List of templates
     */
    async getAvailableTemplates(accessToken, businessAccountId) {
        try {
            const url = `${this.baseUrl}/${businessAccountId}/message_templates`;

            const response = await axios.get(url, {
                params: {
                    access_token: accessToken,
                    fields: 'name,status,category,language'
                },
                headers: { 'Content-Type': 'application/json' }
            });

            return response.data.data || [];

        } catch (error) {
            console.error('❌ Error getting templates:', error.response?.data);
            throw error;
        }
    }

    /**
     * Handle webhook for message status updates
     * @param {Object} webhookData - Webhook payload from Meta
     * @returns {Object} Parsed webhook data
     */
    parseWebhookData(webhookData) {
        try {
            const statuses = [];
            
            if (webhookData.entry && Array.isArray(webhookData.entry)) {
                webhookData.entry.forEach(entry => {
                    if (entry.changes && Array.isArray(entry.changes)) {
                        entry.changes.forEach(change => {
                            if (change.value.statuses) {
                                change.value.statuses.forEach(status => {
                                    statuses.push({
                                        messageId: status.id,
                                        status: status.status, // sent, delivered, read, failed
                                        timestamp: status.timestamp,
                                        recipientId: status.recipient_id,
                                        error: status.errors ? status.errors[0].message : null
                                    });
                                });
                            }
                        });
                    }
                });
            }

            return statuses;

        } catch (error) {
            console.error('❌ Error parsing webhook data:', error);
            throw error;
        }
    }

    /**
     * Format phone number to E.164 standard
     * @param {string} phone - Phone number
     * @param {string} countryCode - Country code (e.g., 'US')
     * @returns {string} Formatted phone in E.164 format
     */
    static formatPhoneNumber(phone, countryCode = 'US') {
        // Simple formatting - in production, use libphonenumber-js
        const cleaned = phone.replace(/[^0-9+]/g, '');
        
        if (cleaned.startsWith('+')) {
            return cleaned;
        }
        
        // Default country codes
        const countryCodes = {
            'US': '+1',
            'IN': '+91',
            'UK': '+44',
            'CA': '+1'
        };
        
        const code = countryCodes[countryCode] || '+1';
        return code + cleaned;
    }
}

module.exports = WhatsAppMetaAPI;
