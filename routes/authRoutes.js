const express = require('express');
const router = express.Router();
const JWTAuthMiddleware = require('../middleware/jwtAuth');
const oauthController = require('../controllers/oauthController');
const gsheetsOauth = require('../controllers/googleSheetsOAuthController');

// Initialize JWT middleware
const jwtAuth = new JWTAuthMiddleware();

// Initialize JWT tables
jwtAuth.initialize().catch(console.error);

// Google OAuth Login
router.get('/google/authorize', async (req, res) => {
    try {
        const client = await gsheetsOauth.getClient();
        if (!client?.client_id) {
            return res.status(400).json({ 
                success: false, 
                message: 'OAuth client not configured' 
            });
        }
        
        const authParams = {
            client_id: client.client_id,
            redirect_uri: client.redirect_uri || gsheetsOauth.buildRedirectUri(),
            scope: 'https://www.googleapis.com/auth/userinfo.email https://www.googleapis.com/auth/userinfo.profile https://www.googleapis.com/auth/spreadsheets https://www.googleapis.com/auth/drive.file',
            response_type: 'code',
            access_type: 'offline',
            prompt: 'consent'
        };
        
        // Add state parameter if provided
        if (req.query.state) {
            authParams.state = req.query.state;
        } else if (req.query.redirectTo) {
            // Create state with redirectTo
            authParams.state = JSON.stringify({
                redirectTo: req.query.redirectTo
            });
        }
        
        const authUrl = `https://accounts.google.com/o/oauth2/v2/auth?${new URLSearchParams(authParams).toString()}`;
        
        return res.json({ success: true, authUrl });
    } catch (err) {
        return res.status(500).json({ success: false, message: err.message });
    }
});

// Google OAuth Callback
router.get('/google/callback', async (req, res) => {
    try {
        const { code, state } = req.query;
        
        if (!code) {
            return res.status(400).json({ 
                success: false, 
                message: 'Authorization code is required' 
            });
        }
        
        // Parse state parameter
        let redirectTo = null;
        try {
            const stateObj = JSON.parse(state);
            redirectTo = stateObj.redirectTo || null;
        } catch (e) {
            // If not valid JSON, use as-is
        }
        
        // Exchange code for tokens
        const client = await gsheetsOauth.getClient();
        const tokenResponse = await gsheetsOauth.exchangeCodeForTokens(code, client);
        
        if (!tokenResponse || !tokenResponse.access_token) {
            return res.status(400).json({ 
                success: false, 
                message: 'Failed to exchange authorization code for tokens' 
            });
        }
        
        // Get user info from Google
        const userInfo = await gsheetsOauth.getUserInfo(tokenResponse.access_token);
        
        if (!userInfo || !userInfo.email) {
            return res.status(400).json({ 
                success: false, 
                message: 'Failed to get user information' 
            });
        }
        
        // Save user to database
        const user = await jwtAuth.saveUser({
            email: userInfo.email,
            name: userInfo.name,
            picture: userInfo.picture,
            google_id: userInfo.id,
            google_refresh_token: tokenResponse.refresh_token
        });
        
        // Generate JWT token
        const token = jwtAuth.generateToken({
            email: userInfo.email,
            name: userInfo.name
        });
        
        // Generate refresh token
        const refreshToken = jwtAuth.generateRefreshToken({
            email: userInfo.email
        });
        
        // Return tokens and user info
        return res.json({
            success: true,
            message: 'Authentication successful',
            token,
            refreshToken,
            user: {
                email: userInfo.email,
                name: userInfo.name,
                picture: userInfo.picture
            },
            redirectTo: redirectTo || '/'
        });
    } catch (err) {
        return res.status(500).json({ success: false, message: err.message });
    }
});

// Refresh JWT token
router.post('/refresh-token', async (req, res) => {
    try {
        const { refreshToken } = req.body;
        
        if (!refreshToken) {
            return res.status(400).json({ 
                success: false, 
                message: 'Refresh token is required' 
            });
        }
        
        // Verify refresh token
        const decoded = await jwtAuth.verifyRefreshToken(refreshToken);
        
        if (!decoded) {
            return res.status(401).json({ 
                success: false, 
                message: 'Invalid or expired refresh token' 
            });
        }
        
        // Generate new JWT token
        const token = jwtAuth.generateToken({
            email: decoded.sub
        });
        
        return res.json({
            success: true,
            message: 'Token refreshed successfully',
            token
        });
    } catch (err) {
        return res.status(500).json({ success: false, message: err.message });
    }
});

// Logout (revoke refresh token)
router.post('/logout', async (req, res) => {
    try {
        const { refreshToken } = req.body;
        
        if (refreshToken) {
            await jwtAuth.revokeRefreshToken(refreshToken);
        }
        
        return res.json({
            success: true,
            message: 'Logged out successfully'
        });
    } catch (err) {
        return res.status(500).json({ success: false, message: err.message });
    }
});

// Get current user (requires authentication)
router.get('/me', jwtAuth.authenticate(), async (req, res) => {
    try {
        const userEmail = req.user.email;
        
        // Get user from database
        const user = await jwtAuth.getUser(userEmail);
        
        if (!user) {
            return res.status(404).json({ 
                success: false, 
                message: 'User not found' 
            });
        }
        
        return res.json({
            success: true,
            user: {
                email: user.email,
                name: user.name,
                picture: user.picture
            }
        });
    } catch (err) {
        return res.status(500).json({ success: false, message: err.message });
    }
});

module.exports = router;
