const jwt = require('jsonwebtoken');
const DatabaseService = require('../services/database');

class JWTAuthMiddleware {
    constructor() {
        this.databaseService = new DatabaseService();
        this.JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key-change-in-production';
        this.JWT_EXPIRY = process.env.JWT_EXPIRY || '24h';
        this.REFRESH_TOKEN_EXPIRY = process.env.REFRESH_TOKEN_EXPIRY || '30d';
    }
    
    // Save user to database
    async saveUser(userData) {
        const client = await this.databaseService.pool.connect();
        try {
            // Check if user exists
            const existingUser = await client.query(`
                SELECT * FROM users WHERE email = $1
            `, [userData.email]);
            
            if (existingUser.rows.length > 0) {
                // Update existing user
                await client.query(`
                    UPDATE users
                    SET name = $1,
                        picture = $2,
                        google_id = $3,
                        google_refresh_token = COALESCE($4, google_refresh_token),
                        updated_at = CURRENT_TIMESTAMP
                    WHERE email = $5
                `, [
                    userData.name,
                    userData.picture,
                    userData.google_id,
                    userData.google_refresh_token,
                    userData.email
                ]);
                
                return existingUser.rows[0];
            } else {
                // Create new user
                const result = await client.query(`
                    INSERT INTO users (email, name, picture, google_id, google_refresh_token)
                    VALUES ($1, $2, $3, $4, $5)
                    RETURNING *
                `, [
                    userData.email,
                    userData.name,
                    userData.picture,
                    userData.google_id,
                    userData.google_refresh_token
                ]);
                
                return result.rows[0];
            }
        } catch (error) {
            console.error('Error saving user:', error);
            throw error;
        } finally {
            client.release();
        }
    }
    
    // Get user from database
    async getUser(email) {
        const client = await this.databaseService.pool.connect();
        try {
            const result = await client.query(`
                SELECT * FROM users WHERE email = $1
            `, [email]);
            
            return result.rows[0] || null;
        } catch (error) {
            console.error('Error getting user:', error);
            throw error;
        } finally {
            client.release();
        }
    }

    // Generate JWT token for a user
    generateToken(user) {
        const payload = {
            sub: user.email,
            email: user.email,
            name: user.name || '',
            iat: Math.floor(Date.now() / 1000)
        };

        return jwt.sign(payload, this.JWT_SECRET, { expiresIn: this.JWT_EXPIRY });
    }

    // Generate refresh token
    generateRefreshToken(user) {
        const payload = {
            sub: user.email,
            type: 'refresh',
            iat: Math.floor(Date.now() / 1000)
        };

        const refreshToken = jwt.sign(payload, this.JWT_SECRET, { expiresIn: this.REFRESH_TOKEN_EXPIRY });
        
        // Store refresh token in database
        this.storeRefreshToken(user.email, refreshToken).catch(console.error);
        
        return refreshToken;
    }

    // Store refresh token in database
    async storeRefreshToken(userEmail, refreshToken) {
        const client = await this.databaseService.pool.connect();
        try {
            // Create refresh_tokens table if it doesn't exist
            await client.query(`
                CREATE TABLE IF NOT EXISTS refresh_tokens (
                    id SERIAL PRIMARY KEY,
                    user_email VARCHAR(255) NOT NULL,
                    token TEXT NOT NULL,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    expires_at TIMESTAMP NOT NULL,
                    is_revoked BOOLEAN DEFAULT FALSE
                );
            `);

            // Calculate expiry date
            const expiresAt = new Date();
            expiresAt.setDate(expiresAt.getDate() + 30); // 30 days from now

            // Insert new refresh token
            await client.query(`
                INSERT INTO refresh_tokens (user_email, token, expires_at)
                VALUES ($1, $2, $3)
            `, [userEmail, refreshToken, expiresAt]);
        } finally {
            client.release();
        }
    }

    // Verify refresh token
    async verifyRefreshToken(refreshToken) {
        try {
            // Verify JWT signature
            const decoded = jwt.verify(refreshToken, this.JWT_SECRET);
            
            // Check if token is in database and not revoked
            const client = await this.databaseService.pool.connect();
            try {
                const result = await client.query(`
                    SELECT * FROM refresh_tokens
                    WHERE token = $1 AND is_revoked = FALSE AND expires_at > NOW()
                `, [refreshToken]);
                
                if (result.rows.length === 0) {
                    return null;
                }
                
                return decoded;
            } finally {
                client.release();
            }
        } catch (error) {
            console.error('Refresh token verification error:', error);
            return null;
        }
    }

    // Revoke refresh token
    async revokeRefreshToken(refreshToken) {
        const client = await this.databaseService.pool.connect();
        try {
            await client.query(`
                UPDATE refresh_tokens
                SET is_revoked = TRUE
                WHERE token = $1
            `, [refreshToken]);
            
            return true;
        } catch (error) {
            console.error('Error revoking refresh token:', error);
            return false;
        } finally {
            client.release();
        }
    }

    // Revoke all refresh tokens for a user
    async revokeAllUserTokens(userEmail) {
        const client = await this.databaseService.pool.connect();
        try {
            await client.query(`
                UPDATE refresh_tokens
                SET is_revoked = TRUE
                WHERE user_email = $1
            `, [userEmail]);
            
            return true;
        } catch (error) {
            console.error('Error revoking user tokens:', error);
            return false;
        } finally {
            client.release();
        }
    }

    // JWT authentication middleware
    authenticate() {
        return async (req, res, next) => {
            try {
                const token = this.extractToken(req);

                if (!token) {
                    return res.status(401).json({
                        success: false,
                        error: 'Authentication required',
                        message: 'JWT token is required. Include it in Authorization header as "Bearer your-token"'
                    });
                }

                try {
                    // Check if this is a development token (for admin dashboard)
                    let decoded;
                    
                    // Try to verify with normal JWT verification
                    try {
                        decoded = jwt.verify(token, this.JWT_SECRET);
                    } catch (jwtError) {
                        // If JWT verification fails, check if it's our development token
                        if (process.env.NODE_ENV !== 'production') {
                            try {
                                // Parse the token parts
                                const parts = token.split('.');
                                if (parts.length === 3) {
                                    try {
                                        // Handle padding issues with base64 decoding
                                        const base64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
                                        const padded = base64 + '==='.slice(0, (4 - base64.length % 4) % 4);
                                        const payload = JSON.parse(Buffer.from(padded, 'base64').toString());
                                        
                                        // Check if this is our development token for admin@example.com
                                        if (payload.email === 'admin@example.com') {
                                            console.log('Development admin token detected');
                                            
                                            // Use the payload as our decoded token
                                            decoded = payload;
                                        }
                                    } catch (parseError) {
                                        console.error('Error parsing development token:', parseError);
                                    }
                                }
                            } catch (devTokenError) {
                                // If development token check fails, throw the original JWT error
                                throw jwtError;
                            }
                        } else {
                            // In production, throw the original JWT error
                            throw jwtError;
                        }
                    }
                    
                    if (!decoded) {
                        throw new Error('Invalid token format');
                    }
                    
                    // Attach user info to request
                    req.user = {
                        email: decoded.email,
                        sub: decoded.sub,
                        name: decoded.name,
                        role: decoded.role,
                        is_admin: decoded.is_admin,
                        is_super_admin: decoded.is_super_admin
                    };
                    
                    next();
                } catch (error) {
                    if (error.name === 'TokenExpiredError') {
                        return res.status(401).json({
                            success: false,
                            error: 'Token expired',
                            message: 'Your session has expired. Please login again.',
                            code: 'token_expired'
                        });
                    }
                    
                    return res.status(401).json({
                        success: false,
                        error: 'Invalid token',
                        message: 'Invalid authentication token',
                        code: 'invalid_token'
                    });
                }
            } catch (error) {
                console.error('JWT authentication error:', error);
                return res.status(500).json({
                    success: false,
                    error: 'Authentication error',
                    message: 'An error occurred during authentication'
                });
            }
        };
    }

    // Extract JWT token from request
    extractToken(req) {
        const authHeader = req.headers.authorization;
        
        if (authHeader && authHeader.startsWith('Bearer ')) {
            return authHeader.substring(7);
        }
        
        // Fallback to query parameter (less secure, but sometimes needed)
        if (req.query && req.query.token) {
            return req.query.token;
        }
        
        return null;
    }

    // Initialize database tables
    async initialize() {
        const client = await this.databaseService.pool.connect();
        try {
            // Create users table if it doesn't exist
            await client.query(`
                CREATE TABLE IF NOT EXISTS users (
                    id SERIAL PRIMARY KEY,
                    email VARCHAR(255) UNIQUE NOT NULL,
                    name VARCHAR(255),
                    picture TEXT,
                    google_id VARCHAR(255),
                    google_refresh_token TEXT,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                );
            `);

            // Create refresh_tokens table if it doesn't exist
            await client.query(`
                CREATE TABLE IF NOT EXISTS refresh_tokens (
                    id SERIAL PRIMARY KEY,
                    user_email VARCHAR(255) NOT NULL,
                    token TEXT NOT NULL,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    expires_at TIMESTAMP NOT NULL,
                    is_revoked BOOLEAN DEFAULT FALSE
                );
            `);

            console.log('JWT authentication tables initialized');
            return true;
        } catch (error) {
            console.error('Error initializing JWT authentication tables:', error);
            throw error;
        } finally {
            client.release();
        }
    }
}

module.exports = JWTAuthMiddleware;
