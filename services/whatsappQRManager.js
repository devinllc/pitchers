/**
 * WhatsApp QR Manager
 * Handles QR-based WhatsApp Web automation (via Baileys or similar)
 * This manages session tokens, connection state, and message delivery
 */

const EncryptionService = require('./encryptionService');
const WhatsAppConnection = require('../models/WhatsAppConnection');
const DatabaseService = require('./database');

class WhatsAppQRManager {
    constructor() {
        this.databaseService = new DatabaseService();
        this.whatsAppConnection = new WhatsAppConnection(this.databaseService);
        this.encryption = EncryptionService;
        this.activeSessions = new Map(); // In-memory session store (should use Redis in production)
    }

    /**
     * Generate QR code for WhatsApp authentication
     * In production, this would integrate with Baileys or similar
     * @param {string} userEmail - User email
     * @returns {Object} QR code data
     */
    async generateQRCode(userEmail) {
        try {
            // Get or create connection
            const connection = await this.whatsAppConnection.getOrCreateConnection(userEmail);

            // Generate session token
            const sessionToken = this.encryption.constructor.generateToken(32);

            // In production, initialize Baileys client here
            // const { default: makeWASocket } = require('@whiskeysockets/baileys');
            // const client = makeWASocket();
            // client.ev.on('connection.update', (update) => { ... })

            // For now, return QR code placeholder
            console.log(`📱 QR Code for ${userEmail} - Session: ${sessionToken}`);

            // Store session in memory (temporary - use Redis in production)
            this.activeSessions.set(userEmail, {
                sessionToken,
                createdAt: new Date(),
                status: 'waiting_for_scan'
            });

            return {
                success: true,
                sessionToken,
                status: 'qr_generated',
                expiresIn: 60000, // 1 minute
                message: 'Scan QR code with WhatsApp to connect'
            };

        } catch (error) {
            console.error('❌ Error generating QR code:', error);
            throw error;
        }
    }

    /**
     * Verify QR code scan and store session
     * Called after user scans QR code on their phone
     * @param {string} userEmail - User email
     * @param {string} sessionToken - Session token from QR generation
     * @param {string} phoneNumber - Connected phone number
     * @returns {Object} Verification result
     */
    async verifyQRScan(userEmail, sessionToken, phoneNumber) {
        try {
            // Check if session is valid
            const session = this.activeSessions.get(userEmail);

            if (!session || session.sessionToken !== sessionToken) {
                throw new Error('Invalid or expired session token');
            }

            // Check age (must be within 1 minute)
            const age = Date.now() - session.createdAt.getTime();
            if (age > 60000) {
                this.activeSessions.delete(userEmail);
                throw new Error('QR code expired. Please generate a new one.');
            }

            // Encrypt session token for storage
            const encryptedToken = this.encryption.encrypt(sessionToken);

            // Save to database
            await this.whatsAppConnection.updateQRConnection(userEmail, {
                sessionToken: encryptedToken,
                connectedPhone: phoneNumber,
                connectedAt: new Date()
            });

            // Update in-memory session
            session.status = 'connected';
            session.connectedPhone = phoneNumber;
            session.connectedAt = new Date();

            console.log(`✅ QR scan verified for ${userEmail} on phone ${phoneNumber}`);

            return {
                success: true,
                status: 'connected',
                phoneNumber,
                message: 'WhatsApp successfully connected!'
            };

        } catch (error) {
            console.error('❌ Error verifying QR scan:', error);
            throw error;
        }
    }

    /**
     * Keep-alive check for QR session
     * Verifies connection is still active
     * @param {string} userEmail - User email
     * @returns {Object} Connection status
     */
    async keepAlive(userEmail) {
        try {
            const session = this.activeSessions.get(userEmail);
            
            if (!session) {
                // Try to restore from database
                const connection = await this.whatsAppConnection.getConnectionByEmail(userEmail);
                
                if (!connection || !connection.qr_enabled) {
                    return { connected: false, message: 'No active session' };
                }

                // Restore to memory
                this.activeSessions.set(userEmail, {
                    sessionToken: connection.qr_session_token,
                    connectedPhone: connection.qr_connected_phone,
                    status: 'connected',
                    connectedAt: connection.qr_connected_at
                });

                return { connected: true, phoneNumber: connection.qr_connected_phone };
            }

            return {
                connected: session.status === 'connected',
                phoneNumber: session.connectedPhone,
                status: session.status
            };

        } catch (error) {
            console.error('❌ Error during keep-alive check:', error);
            throw error;
        }
    }

    /**
     * Refresh QR session (re-scan if expired)
     * @param {string} userEmail - User email
     * @returns {Object} New QR code data
     */
    async refreshSession(userEmail) {
        try {
            // Remove old session
            this.activeSessions.delete(userEmail);

            // Disable connection in database
            await this.whatsAppConnection.disableConnection(userEmail);

            // Generate new QR
            return await this.generateQRCode(userEmail);

        } catch (error) {
            console.error('❌ Error refreshing session:', error);
            throw error;
        }
    }

    /**
     * Disconnect QR session
     * @param {string} userEmail - User email
     */
    async disconnect(userEmail) {
        try {
            // Remove from memory
            this.activeSessions.delete(userEmail);

            // Disable in database
            await this.whatsAppConnection.disableConnection(userEmail);

            console.log(`✅ QR session disconnected for ${userEmail}`);

            return { success: true, message: 'Disconnected' };

        } catch (error) {
            console.error('❌ Error disconnecting:', error);
            throw error;
        }
    }

    /**
     * Send message via QR session (requires Baileys integration)
     * @param {string} userEmail - User email
     * @param {string} phoneNumber - Recipient phone
     * @param {string} message - Message text
     * @returns {Object} Send result
     */
    async sendMessage(userEmail, phoneNumber, message) {
        try {
            const session = this.activeSessions.get(userEmail);

            if (!session || session.status !== 'connected') {
                throw new Error('QR session not connected');
            }

            // In production, use Baileys to send:
            // const client = this.getClientForSession(userEmail);
            // const result = await client.sendMessage(phoneNumber, { text: message });

            console.log(`📤 Message queued for ${phoneNumber} via QR session`);

            return {
                success: true,
                status: 'queued',
                message,
                phoneNumber,
                note: 'Requires Baileys integration for actual delivery'
            };

        } catch (error) {
            console.error('❌ Error sending message via QR:', error);
            throw error;
        }
    }

    /**
     * Get all active sessions (admin function)
     * @returns {Array} List of active sessions
     */
    getActiveSessions() {
        const sessions = [];
        for (const [userEmail, sessionData] of this.activeSessions.entries()) {
            sessions.push({
                userEmail,
                status: sessionData.status,
                connectedPhone: sessionData.connectedPhone,
                connectedAt: sessionData.connectedAt
            });
        }
        return sessions;
    }

    /**
     * Cleanup expired sessions
     * Should be called periodically (e.g., every 5 minutes)
     */
    cleanupExpiredSessions() {
        const now = Date.now();
        const maxAge = 24 * 60 * 60 * 1000; // 24 hours

        for (const [userEmail, sessionData] of this.activeSessions.entries()) {
            const age = now - sessionData.createdAt.getTime();

            if (age > maxAge) {
                console.log(`⏱️ Removing expired session for ${userEmail}`);
                this.activeSessions.delete(userEmail);
            }
        }
    }
}

// Run cleanup every 5 minutes
setInterval(() => {
    new WhatsAppQRManager().cleanupExpiredSessions();
}, 5 * 60 * 1000);

module.exports = WhatsAppQRManager;
