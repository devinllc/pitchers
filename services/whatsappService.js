/**
 * WhatsApp Service
 * Handles both QR-connected and Meta API message sending
 */

const axios = require('axios');
const WhatsAppConnection = require('../models/WhatsAppConnection');
const DatabaseService = require('./database');

class WhatsAppService {
    constructor() {
        this.databaseService = new DatabaseService();
        this.whatsAppConnection = new WhatsAppConnection(this.databaseService);
        this.metaApiVersion = 'v18.0';
        this.metaApiBaseUrl = `https://graph.facebook.com/${this.metaApiVersion}`;
    }

    /**
     * Send message via Meta WhatsApp Business API
     * @param {string} userEmail - User email
     * @param {string} phoneNumber - Recipient phone (E.164 format: +1234567890)
     * @param {string} message - Message text
     * @returns {Object} Send result with message ID
     */
    async sendViaMetaAPI(userEmail, phoneNumber, message) {
        try {
            const connection = await this.whatsAppConnection.getConnectionByEmail(userEmail);
            
            if (!connection || !connection.meta_api_enabled) {
                throw new Error('Meta API not configured for this user');
            }

            if (connection.active_mode !== 'meta_api') {
                throw new Error('Meta API is not the active mode. User must switch to Meta API mode.');
            }

            const { meta_phone_number_id, meta_api_token } = connection;

            if (!meta_phone_number_id || !meta_api_token) {
                throw new Error('Meta API credentials incomplete');
            }

            // Send message via Meta WhatsApp Business API
            const url = `${this.metaApiBaseUrl}/${meta_phone_number_id}/messages`;

            const payload = {
                messaging_product: 'whatsapp',
                to: phoneNumber.replace(/[^0-9+]/g, ''), // Clean phone number
                type: 'text',
                text: {
                    body: message
                }
            };

            const response = await axios.post(url, payload, {
                headers: {
                    'Authorization': `Bearer ${meta_api_token}`,
                    'Content-Type': 'application/json'
                }
            });

            // Log success
            console.log(`✅ WhatsApp message sent via Meta API to ${phoneNumber}:`, response.data.messages?.[0]?.id);

            // Update last message sent timestamp
            await this.whatsAppConnection.updateLastMessageSent(userEmail);

            return {
                success: true,
                messageId: response.data.messages?.[0]?.id,
                status: 'sent',
                phoneNumber,
                timestamp: new Date()
            };

        } catch (error) {
            console.error('❌ Error sending WhatsApp via Meta API:', error.response?.data || error.message);
            throw {
                success: false,
                error: error.response?.data?.error?.message || error.message,
                statusCode: error.response?.status
            };
        }
    }

    /**
     * Send message via QR-connected WhatsApp account
     * Uses WhatsApp Web simulation or Baileys library
     * @param {string} userEmail - User email
     * @param {string} phoneNumber - Recipient phone (WhatsApp format)
     * @param {string} message - Message text
     * @returns {Object} Send result
     */
    async sendViaQR(userEmail, phoneNumber, message) {
        try {
            const connection = await this.whatsAppConnection.getConnectionByEmail(userEmail);
            
            if (!connection || !connection.qr_enabled) {
                throw new Error('QR-connected WhatsApp not configured for this user');
            }

            if (connection.active_mode !== 'qr') {
                throw new Error('QR mode is not the active mode. User must switch to QR mode.');
            }

            // In production, integrate with Baileys library (WhatsApp Web automation)
            // For now, return a placeholder that would integrate with actual QR implementation
            console.log(`📱 QR Mode: Would send to ${phoneNumber} via WhatsApp Web`);

            // TODO: Integrate with Baileys library
            // const client = new Client({ ... });
            // await client.sendMessage(phoneNumber, { text: message });

            // Update last message sent
            await this.whatsAppConnection.updateLastMessageSent(userEmail);

            return {
                success: true,
                mode: 'qr',
                phoneNumber,
                message,
                status: 'queued_for_qr_client',
                timestamp: new Date(),
                note: 'QR mode requires Baileys integration to be fully implemented'
            };

        } catch (error) {
            console.error('❌ Error sending WhatsApp via QR:', error.message);
            throw {
                success: false,
                error: error.message
            };
        }
    }

    /**
     * Send message using active mode (determined by user preference)
     * @param {string} userEmail - User email
     * @param {string} phoneNumber - Recipient phone
     * @param {string} message - Message text
     * @returns {Object} Send result
     */
    async sendMessage(userEmail, phoneNumber, message) {
        try {
            const connection = await this.whatsAppConnection.getConnectionByEmail(userEmail);

            if (!connection || !connection.is_active) {
                throw new Error('WhatsApp integration not active for this user');
            }

            if (connection.active_mode === 'meta_api') {
                return await this.sendViaMetaAPI(userEmail, phoneNumber, message);
            } else if (connection.active_mode === 'qr') {
                return await this.sendViaQR(userEmail, phoneNumber, message);
            } else {
                throw new Error('No active WhatsApp mode configured');
            }

        } catch (error) {
            console.error('❌ Error sending WhatsApp message:', error);
            throw error;
        }
    }

    /**
     * Verify Meta API credentials
     * @param {string} userEmail - User email
     * @param {string} metaToken - Meta API token
     * @param {string} phoneNumberId - Phone number ID
     * @returns {Object} Verification result
     */
    async verifyMetaAPICredentials(userEmail, metaToken, phoneNumberId) {
        try {
            const url = `${this.metaApiBaseUrl}/${phoneNumberId}`;

            const response = await axios.get(url, {
                params: { access_token: metaToken },
                headers: { 'Content-Type': 'application/json' }
            });

            console.log('✅ Meta API credentials verified');

            return {
                success: true,
                verified: true,
                phoneNumber: response.data.display_phone_number,
                businessName: response.data.name
            };

        } catch (error) {
            console.error('❌ Meta API verification failed:', error.response?.data || error.message);
            return {
                success: false,
                verified: false,
                error: error.response?.data?.error?.message || error.message
            };
        }
    }

    /**
     * Get WhatsApp connection status
     * @param {string} userEmail - User email
     * @returns {Object} Connection status
     */
    async getConnectionStatus(userEmail) {
        try {
            const connection = await this.whatsAppConnection.getConnectionByEmail(userEmail);

            if (!connection) {
                return {
                    connected: false,
                    modes: { qr: false, meta_api: false },
                    activeMode: null
                };
            }

            return {
                connected: connection.is_active,
                modes: {
                    qr: connection.qr_enabled,
                    meta_api: connection.meta_api_enabled
                },
                activeMode: connection.active_mode,
                qrPhone: connection.qr_connected_phone,
                metaPhone: connection.meta_phone_number_id,
                lastMessageSent: connection.last_message_sent_at
            };

        } catch (error) {
            console.error('❌ Error getting connection status:', error);
            throw error;
        }
    }

    /**
     * Disconnect WhatsApp integration
     * @param {string} userEmail - User email
     */
    async disconnect(userEmail) {
        try {
            await this.whatsAppConnection.disableConnection(userEmail);
            console.log('✅ WhatsApp disconnected for user:', userEmail);
            return { success: true };
        } catch (error) {
            console.error('❌ Error disconnecting WhatsApp:', error);
            throw error;
        }
    }
}

module.exports = WhatsAppService;
