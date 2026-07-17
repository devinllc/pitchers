const https = require('https');
const querystring = require('querystring');
const fs = require('fs').promises;
require('dotenv').config();

const OAUTH_SCOPE = 'https://www.googleapis.com/auth/spreadsheets';
const DEFAULT_REDIRECT_URI = 'http://localhost:3000/oauth/callback';

function buildRedirectUri() {
  // Allow overriding via env var for deployed environments
  return process.env.GOOGLE_OAUTH_REDIRECT_URI || DEFAULT_REDIRECT_URI;
}

async function readCredentials() {
  const credentialsPath = process.env.GOOGLE_SHEETS_CREDENTIALS_PATH;
  const content = await fs.readFile(credentialsPath, 'utf8');
  return JSON.parse(content);
}

async function writeCredentials(updated) {
  const credentialsPath = process.env.GOOGLE_SHEETS_CREDENTIALS_PATH;
  await fs.writeFile(credentialsPath, JSON.stringify(updated, null, 2));
}

exports.saveCredentials = async (req, res) => {
  try {
    const { client_id, client_secret, redirect_uri } = req.body || {};

    if (!client_id || !client_secret) {
      return res.status(400).json({ success: false, message: 'client_id and client_secret are required' });
    }

    const creds = {
      client_id,
      client_secret,
      redirect_uri: redirect_uri || buildRedirectUri(),
    };

    await writeCredentials(creds);
    return res.json({ success: true, message: 'Credentials saved' });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
};

exports.authorize = async (req, res) => {
  try {
    const credentials = await readCredentials();
    if (!credentials.client_id) {
      return res.status(400).json({ success: false, message: 'Missing client_id in credentials. Save credentials first.' });
    }

    const authParams = {
      client_id: credentials.client_id,
      redirect_uri: credentials.redirect_uri || buildRedirectUri(),
      scope: OAUTH_SCOPE,
      response_type: 'code',
      access_type: 'offline',
      prompt: 'consent',
    };

    const authUrl = 'https://accounts.google.com/o/oauth2/v2/auth?' + querystring.stringify(authParams);

    // Always return JSON response with the auth URL
    return res.json({ success: true, authUrl });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
};

exports.callback = async (req, res) => {
  const code = req.query.code;
  if (!code) {
    return res.status(400).json({ success: false, message: 'Missing code' });
  }

  try {
    const credentials = await readCredentials();

    const tokenData = querystring.stringify({
      client_id: credentials.client_id,
      client_secret: credentials.client_secret,
      code,
      grant_type: 'authorization_code',
      redirect_uri: credentials.redirect_uri || buildRedirectUri(),
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

    const updated = {
      ...credentials,
      refresh_token: tokenResponse.refresh_token,
      access_token: tokenResponse.access_token,
      expiry_date: tokenResponse.expires_in ? Date.now() + tokenResponse.expires_in * 1000 : null,
      scope: OAUTH_SCOPE,
      token_type: 'Bearer',
    };

    await writeCredentials(updated);

    // Always return JSON response
    const redirectTo = req.query.redirect || '/?oauth=success';
    return res.json({ success: true, message: 'OAuth completed', redirectTo });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
};
