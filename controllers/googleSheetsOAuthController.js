const GoogleSheetsService = require('../services/googleSheets');
const MultiTenantGoogleSheetsService = require('../services/multiTenantGoogleSheets');
const ApiKey = require('../models/ApiKey');
const DatabaseService = require('../services/database');
const querystring = require('querystring');
const { google } = require('googleapis');
const oauthStore = require('../services/oauthStore');
const https = require('https');

// Initialize database service and API key model for auto-generation
const dbService = new DatabaseService();
const apiKeyModel = new ApiKey(dbService);

const OAUTH_SCOPE = 'https://www.googleapis.com/auth/spreadsheets';
const CLIENT_KEY = 'google_sheets_client';
const TOKEN_KEY = 'google_sheets_tokens';
const COMBINED_KEY = 'google_sheets_oauth';

function buildRedirectUri() {
  // Prefer standardized provider-style callback for Google Sheets
  return process.env.GOOGLE_OAUTH_REDIRECT_URI || 'http://localhost:3000/oauth/google-sheets/callback';
}

exports.setup = async (req, res) => {
  try {
    const { client_id, client_secret, redirect_uri } = req.body || {};
    if (!client_id || !client_secret) {
      return res.status(400).json({ success: false, message: 'client_id and client_secret are required' });
    }
    const client = {
      client_id,
      client_secret,
      redirect_uri: redirect_uri || buildRedirectUri(),
      scope: OAUTH_SCOPE,
      created_at: new Date().toISOString(),
    };
    await oauthStore.set(CLIENT_KEY, client);

    // Build auth URL for immediate redirect or display
    const authParams = {
      client_id: client.client_id,
      redirect_uri: client.redirect_uri,
      scope: OAUTH_SCOPE,
      response_type: 'code',
      access_type: 'offline',
    };
    const authUrl = 'https://accounts.google.com/o/oauth2/v2/auth?' + querystring.stringify(authParams);

    return res.json({ success: true, message: 'Client saved', authUrl });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
};

exports.authorize = async (req, res) => {
  try {
    const client = await oauthStore.get(CLIENT_KEY);
    if (!client?.client_id) {
      return res.status(400).json({ success: false, message: 'No client configured. POST /oauth/sheets/setup first.' });
    }
    const authParams = {
      client_id: client.client_id,
      redirect_uri: client.redirect_uri || buildRedirectUri(),
      scope: OAUTH_SCOPE,
      response_type: 'code',
      access_type: 'offline',
    };
    const authUrl = 'https://accounts.google.com/o/oauth2/v2/auth?' + querystring.stringify(authParams);
    return res.json({ success: true, authUrl });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
};

exports.callback = async (req, res) => {
  const code = req.query.code;
  const stateParam = req.query.state; // Multi-tenant: user email and redirectTo passed as state
  
  if (!code) {
    return res.status(400).json({ success: false, message: 'Missing code' });
  }
  
  try {
    // Parse state parameter - could be JSON string or plain email
    let userEmail = '';
    let redirectTo = null;
    
    try {
      // Try to parse as JSON
      const stateObj = JSON.parse(stateParam);
      userEmail = stateObj.userEmail || '';
      redirectTo = stateObj.redirectTo || null;
    } catch (e) {
      // If not valid JSON, use as-is (backward compatibility)
      userEmail = stateParam;
    }
    
    // Check if this is a multi-tenant OAuth flow (has userEmail in state)
    if (userEmail && userEmail.includes('@')) {
      // Multi-tenant flow - delegate to multi-tenant controller
      const MultiTenantSheetsController = require('./multiTenantSheetsController');
      const DatabaseService = require('../services/database');
      const db = new DatabaseService();
      const controller = new MultiTenantSheetsController(db);
      
      // Create a mock request object with the user email
      const mockReq = {
        ...req,
        query: { ...req.query, userEmail },
        user: { email: userEmail }
      };
      
      try {
        const result = await controller.handleOAuthCallback(mockReq, res);
        // If successful, auto-generate API key for new users
        if (result && result.success) {
          const apiKeyData = await controller.ensureUserApiKey(userEmail);
          
          // Always return JSON response with redirect information and API key
          redirectTo = redirectTo || result.redirectTo || req.query.redirect_to || 'multi-tenant-dashboard';
          
          // Format response for frontend consumption
          return res.json({
            success: true,
            message: 'OAuth completed successfully',
            user: {
              email: userEmail,
              connected: true,
              connectionTime: new Date().toISOString()
            },
            api: {
              key: apiKeyData.api_key,
              plan: apiKeyData.plan_type,
              usageLimit: apiKeyData.usage_limit,
              usageCount: apiKeyData.usage_count,
              expiresAt: apiKeyData.expires_at
            },
            oauth: {
              provider: 'google-sheets',
              scope: result.scope || OAUTH_SCOPE,
              connected: true
            },
            redirectTo: redirectTo,
            redirectUrl: redirectTo && redirectTo.startsWith('http') 
              ? `${redirectTo}?userEmail=${encodeURIComponent(userEmail)}&connected=true`
              : redirectTo === 'job-control'
              ? `/job-control.html?userEmail=${encodeURIComponent(userEmail)}&connected=true`
              : `/multi-tenant-dashboard.html?userEmail=${encodeURIComponent(userEmail)}&connected=true`
          });
        }
        return result;
      } catch (error) {
        console.error('Multi-tenant OAuth callback error:', error);
        // Always return JSON response with error information
        redirectTo = redirectTo || req.query.redirect_to || 'multi-tenant-dashboard';
        return res.json({
          success: false,
          error: 'OAuth failed',
          message: error.message || 'OAuth callback failed',
          user: {
            email: userEmail,
            connected: false
          },
          redirectTo: redirectTo,
          redirectUrl: redirectTo && redirectTo.startsWith('http') 
            ? `${redirectTo}?userEmail=${encodeURIComponent(userEmail)}&error=oauth_failed`
            : redirectTo === 'job-control'
            ? `/job-control.html?userEmail=${encodeURIComponent(userEmail)}&error=oauth_failed`
            : `/multi-tenant-dashboard.html?userEmail=${encodeURIComponent(userEmail)}&error=oauth_failed`
        });
      }
    }
    
    // Original single-tenant flow
    const client = await oauthStore.get(CLIENT_KEY);
    if (!client?.client_id) {
      return res.status(400).json({ success: false, message: 'No client configured. Run setup first.' });
    }

    const tokenData = querystring.stringify({
      client_id: client.client_id,
      client_secret: client.client_secret,
      code,
      grant_type: 'authorization_code',
      redirect_uri: client.redirect_uri || buildRedirectUri(),
    });

    const tokenResponse = await new Promise((resolve, reject) => {
      const options = {
        hostname: 'oauth2.googleapis.com',
        port: 443,
        path: '/token',
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Content-Length': Buffer.byteLength(tokenData),
        },
      };
      const reqHttps = https.request(options, (resp) => {
        let data = '';
        resp.on('data', (chunk) => (data += chunk));
        resp.on('end', () => {
          try {
            const parsed = JSON.parse(data);
            if (resp.statusCode === 200) return resolve(parsed);
            return reject(new Error(`HTTP ${resp.statusCode}: ${parsed.error_description || parsed.error || data}`));
          } catch (e) {
            return reject(new Error(`Failed to parse response: ${data}`));
          }
        });
      });
      reqHttps.on('error', reject);
      reqHttps.write(tokenData);
      reqHttps.end();
    });

    const tokens = {
      refresh_token: tokenResponse.refresh_token,
      access_token: tokenResponse.access_token,
      expiry_date: tokenResponse.expires_in ? Date.now() + tokenResponse.expires_in * 1000 : null,
      scope: OAUTH_SCOPE,
      token_type: 'Bearer',
      obtained_at: new Date().toISOString(),
    };

    await oauthStore.set(TOKEN_KEY, tokens);
    await oauthStore.set(COMBINED_KEY, { ...client, ...tokens });

    // Provide a ready-to-paste env JSON
    const envJson = JSON.stringify({
      client_id: client.client_id,
      client_secret: client.client_secret,
      redirect_uri: client.redirect_uri || buildRedirectUri(),
      refresh_token: tokens.refresh_token,
      access_token: tokens.access_token,
      token_type: 'Bearer',
      expiry_date: tokens.expiry_date || 0,
      scope: OAUTH_SCOPE,
    });

    const singleTenantRedirectTo = req.query.redirect || '/?oauth=success';
    return res.json({ success: true, message: 'OAuth completed', GOOGLE_SHEETS_OAUTH_JSON: envJson, redirectTo: singleTenantRedirectTo });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
};

// Ensure user has an API key (auto-generate if needed)
exports.ensureUserApiKey = async (userEmail) => {
  try {
    // Check if user already has an API key
    const existingKeys = await apiKeyModel.getUserApiKeys(userEmail);
    
    if (existingKeys && existingKeys.length > 0) {
      console.log(`User ${userEmail} already has ${existingKeys.length} API key(s)`);
      return existingKeys[0]; // Return first active key
    }
    
    // Create new API key with free plan for new users
    console.log(`Creating new API key for user: ${userEmail}`);
    const newApiKey = await apiKeyModel.createApiKey(userEmail, 'free');
    console.log(`✅ API key created for ${userEmail}: ${newApiKey.api_key.substring(0, 12)}...`);
    
    return newApiKey;
  } catch (error) {
    console.error(`Error ensuring API key for ${userEmail}:`, error);
    throw error;
  }
};

exports.status = async (req, res) => {
  try {
    const client = await oauthStore.get(CLIENT_KEY);
    const tokens = await oauthStore.get(TOKEN_KEY);
    return res.json({
      success: true,
      clientConfigured: !!(client && client.client_id),
      tokensPresent: !!(tokens && (tokens.refresh_token || tokens.access_token)),
      redirect_uri: client?.redirect_uri || buildRedirectUri(),
      scope: OAUTH_SCOPE,
    });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
};

// Provider-style alias: connect -> authorize
exports.connect = async (req, res) => exports.authorize(req, res);

// Refresh access token using stored refresh_token
exports.refresh = async (req, res) => {
  try {
    const client = await oauthStore.get(CLIENT_KEY);
    const tokens = await oauthStore.get(TOKEN_KEY);
    if (!client?.client_id || !tokens?.refresh_token) {
      return res.status(400).json({ success: false, message: 'Missing client or refresh_token' });
    }

    const postData = querystring.stringify({
      client_id: client.client_id,
      client_secret: client.client_secret,
      grant_type: 'refresh_token',
      refresh_token: tokens.refresh_token,
    });

    const tokenResponse = await new Promise((resolve, reject) => {
      const options = {
        hostname: 'oauth2.googleapis.com',
        port: 443,
        path: '/token',
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Content-Length': Buffer.byteLength(postData),
        },
      };
      const reqHttps = https.request(options, (resp) => {
        let data = '';
        resp.on('data', (chunk) => (data += chunk));
        resp.on('end', () => {
          try {
            const parsed = JSON.parse(data);
            if (resp.statusCode === 200) return resolve(parsed);
            return reject(new Error(`HTTP ${resp.statusCode}: ${parsed.error_description || parsed.error || data}`));
          } catch (e) {
            return reject(new Error(`Failed to parse response: ${data}`));
          }
        });
      });
      reqHttps.on('error', reject);
      reqHttps.write(postData);
      reqHttps.end();
    });

    const updatedTokens = {
      ...tokens,
      access_token: tokenResponse.access_token,
      expiry_date: tokenResponse.expires_in ? Date.now() + tokenResponse.expires_in * 1000 : tokens.expiry_date || null,
      token_type: tokenResponse.token_type || tokens.token_type || 'Bearer',
      scope: tokens.scope || OAUTH_SCOPE,
      refreshed_at: new Date().toISOString(),
    };

    await oauthStore.set(TOKEN_KEY, updatedTokens);
    const clientData = await oauthStore.get(CLIENT_KEY);
    await oauthStore.set(COMBINED_KEY, { ...clientData, ...updatedTokens });

    return res.json({ success: true, message: 'Token refreshed', expiresIn: tokenResponse.expires_in || null });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
};

// Disconnect: delete stored tokens (keeps client unless forgetClient=true)
exports.disconnect = async (req, res) => {
  try {
    const { forgetClient } = req.body || {};
    await oauthStore.delete(TOKEN_KEY);
    await oauthStore.delete(COMBINED_KEY);
    if (forgetClient) await oauthStore.delete(CLIENT_KEY);
    return res.json({ success: true, message: 'Disconnected' });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
};
