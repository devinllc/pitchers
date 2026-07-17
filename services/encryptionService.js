/**
 * Encryption Service
 * Handles encryption/decryption of sensitive data (API keys, passwords, tokens)
 */

const crypto = require('crypto');

class EncryptionService {
    constructor() {
        // Get encryption key from environment or use default (should be changed in production)
        this.encryptionKey = process.env.ENCRYPTION_KEY || crypto.randomBytes(32);
        
        if (typeof this.encryptionKey === 'string') {
            // Convert hex string to buffer
            this.encryptionKey = Buffer.from(this.encryptionKey, 'hex');
        }

        // Ensure key is 32 bytes for AES-256
        if (this.encryptionKey.length !== 32) {
            console.warn('Encryption key is not 32 bytes, generating new key');
            this.encryptionKey = crypto.randomBytes(32);
        }
    }

    /**
     * Encrypt sensitive data
     * @param {string} plaintext - Data to encrypt
     * @returns {string} Base64 encoded IV + encrypted data
     */
    encrypt(plaintext) {
        try {
            // Generate random IV (Initialization Vector)
            const iv = crypto.randomBytes(16);

            // Create cipher
            const cipher = crypto.createCipheriv('aes-256-cbc', this.encryptionKey, iv);

            // Encrypt the data
            let encrypted = cipher.update(plaintext, 'utf8', 'hex');
            encrypted += cipher.final('hex');

            // Combine IV + encrypted data and encode as base64
            const combined = iv.toString('hex') + ':' + encrypted;
            return Buffer.from(combined).toString('base64');
        } catch (error) {
            console.error('Encryption error:', error);
            throw new Error('Failed to encrypt data');
        }
    }

    /**
     * Decrypt sensitive data
     * @param {string} encryptedData - Base64 encoded IV + encrypted data
     * @returns {string} Decrypted plaintext
     */
    decrypt(encryptedData) {
        try {
            // Decode from base64
            const combined = Buffer.from(encryptedData, 'base64').toString('utf8');
            const parts = combined.split(':');
            
            if (parts.length !== 2) {
                throw new Error('Invalid encrypted data format');
            }

            const iv = Buffer.from(parts[0], 'hex');
            const encrypted = parts[1];

            // Create decipher
            const decipher = crypto.createDecipheriv('aes-256-cbc', this.encryptionKey, iv);

            // Decrypt the data
            let decrypted = decipher.update(encrypted, 'hex', 'utf8');
            decrypted += decipher.final('utf8');

            return decrypted;
        } catch (error) {
            console.error('Decryption error:', error);
            throw new Error('Failed to decrypt data');
        }
    }

    /**
     * Hash a value (one-way, for verification)
     * @param {string} plaintext - Data to hash
     * @returns {string} Hex-encoded hash
     */
    hash(plaintext) {
        try {
            return crypto.createHash('sha256').update(plaintext).digest('hex');
        } catch (error) {
            console.error('Hashing error:', error);
            throw new Error('Failed to hash data');
        }
    }

    /**
     * Verify that plaintext matches hash
     * @param {string} plaintext - Data to verify
     * @param {string} hash - Hash to compare against
     * @returns {boolean} True if matches
     */
    verifyHash(plaintext, hash) {
        try {
            const computed = this.hash(plaintext);
            return computed === hash;
        } catch (error) {
            console.error('Hash verification error:', error);
            return false;
        }
    }

    /**
     * Generate a random encryption key (call once and store in .env)
     * @returns {string} Hex-encoded 32-byte key
     */
    static generateKey() {
        return crypto.randomBytes(32).toString('hex');
    }

    /**
     * Generate a random token
     * @param {number} length - Token length in bytes (default: 32)
     * @returns {string} Hex-encoded random token
     */
    static generateToken(length = 32) {
        return crypto.randomBytes(length).toString('hex');
    }
}

module.exports = new EncryptionService();
