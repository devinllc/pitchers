const JWTAuthMiddleware = require('./jwtAuth');
const DatabaseService = require('../services/database');

class AdminAuthMiddleware {
    constructor() {
        this.jwtAuth = new JWTAuthMiddleware();
        this.databaseService = new DatabaseService();
    }

    // Admin authentication middleware
    authenticate() {
        return async (req, res, next) => {
            try {
                // If there's an x-user-email header, we can authenticate directly if it's a registered admin!
                const headerEmail = req.headers['x-user-email'];
                if (headerEmail) {
                    const isAdmin = await this.isAdmin(headerEmail);
                    if (isAdmin) {
                        const isSuper = await this.isSuperAdmin(headerEmail);
                        req.user = { 
                            email: headerEmail,
                            is_admin: true,
                            is_super_admin: isSuper
                        };
                        req.isAdmin = true;
                        if (isSuper) req.isSuperAdmin = true;
                        return next();
                    }
                }

                // First authenticate with JWT
                const jwtMiddleware = this.jwtAuth.authenticate();
                
                // Create a promise wrapper around the JWT middleware
                await new Promise((resolve, reject) => {
                    jwtMiddleware(req, res, (err) => {
                        if (err) {
                            reject(err);
                        } else {
                            resolve();
                        }
                    });
                });
                
                // If JWT auth passes, check if user is admin
                const userEmail = req.user?.email;
                
                if (!userEmail) {
                    return res.status(401).json({
                        success: false,
                        error: 'Authentication required',
                        message: 'User authentication is required for admin access'
                    });
                }
                
                const isAdmin = await this.isAdmin(userEmail);
                
                if (!isAdmin) {
                    return res.status(403).json({
                        success: false,
                        error: 'Admin access required',
                        message: 'You do not have admin privileges'
                    });
                }
                
                // Add admin info to request
                req.isAdmin = true;
                
                next();
            } catch (error) {
                // If JWT auth fails, it will already send a response
                if (!res.headersSent) {
                    console.error('Admin authentication error:', error);
                    return res.status(500).json({
                        success: false,
                        error: 'Authentication error',
                        message: 'An error occurred during admin authentication'
                    });
                }
            }
        };
    }

    // Super admin authentication middleware (for admin management)
    authenticateSuperAdmin() {
        return async (req, res, next) => {
            try {
                // If there's an x-user-email header, we can authenticate directly if it's a registered super admin!
                const headerEmail = req.headers['x-user-email'];
                if (headerEmail) {
                    const isSuper = await this.isSuperAdmin(headerEmail);
                    if (isSuper) {
                        req.user = { 
                            email: headerEmail,
                            is_admin: true,
                            is_super_admin: true
                        };
                        req.isAdmin = true;
                        req.isSuperAdmin = true;
                        return next();
                    }
                }

                // First authenticate as admin
                const adminMiddleware = this.authenticate();
                
                // Create a promise wrapper around the admin middleware
                await new Promise((resolve, reject) => {
                    adminMiddleware(req, res, (err) => {
                        if (err) {
                            reject(err);
                        } else {
                            resolve();
                        }
                    });
                });
                
                // If admin auth passes, check if user is super admin
                const userEmail = req.user?.email;
                const isSuperAdmin = await this.isSuperAdmin(userEmail);
                
                if (!isSuperAdmin) {
                    return res.status(403).json({
                        success: false,
                        error: 'Super admin access required',
                        message: 'You do not have super admin privileges'
                    });
                }
                
                // Add super admin info to request
                req.isSuperAdmin = true;
                
                next();
            } catch (error) {
                // If admin auth fails, it will already send a response
                if (!res.headersSent) {
                    console.error('Super admin authentication error:', error);
                    return res.status(500).json({
                        success: false,
                        error: 'Authentication error',
                        message: 'An error occurred during super admin authentication'
                    });
                }
            }
        };
    }

    // Check if user is admin
    async isAdmin(email) {
        try {
            const client = await this.databaseService.pool.connect();
            try {
                const result = await client.query(`
                    SELECT * FROM admin_users WHERE email = $1
                `, [email]);
                
                return result.rows.length > 0;
            } finally {
                client.release();
            }
        } catch (error) {
            console.error('Error checking admin status:', error);
            return false;
        }
    }

    // Check if user is super admin
    async isSuperAdmin(email) {
        try {
            const client = await this.databaseService.pool.connect();
            try {
                const result = await client.query(`
                    SELECT * FROM admin_users WHERE email = $1 AND is_super_admin = true
                `, [email]);
                
                return result.rows.length > 0;
            } finally {
                client.release();
            }
        } catch (error) {
            console.error('Error checking super admin status:', error);
            return false;
        }
    }
}

module.exports = AdminAuthMiddleware;
