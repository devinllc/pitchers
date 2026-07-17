const express = require('express');
const router = express.Router();
const oauthController = require('../controllers/oauthController');
const gsheetsOauth = require('../controllers/googleSheetsOAuthController');

// Save OAuth client credentials (client_id, client_secret, optional redirect_uri)
router.post('/credentials', oauthController.saveCredentials);

// Begin OAuth: returns authUrl (JSON) or redirects if HTML is accepted
router.get('/authorize', oauthController.authorize);

// OAuth callback (Google redirects here with ?code=...)
router.get('/callback', oauthController.callback);

// Google Sheets: one-click setup (DB-backed, serverless friendly)
router.post('/sheets/setup', gsheetsOauth.setup); // body: { client_id, client_secret, redirect_uri? }
router.get('/sheets/authorize', gsheetsOauth.authorize);
router.get('/sheets/callback', gsheetsOauth.callback);
router.get('/sheets/status', gsheetsOauth.status);

// Provider-style aliases (similar to other providers)
router.get('/google-sheets/connect', gsheetsOauth.connect);
router.get('/google-sheets/callback', gsheetsOauth.callback);
router.get('/google-sheets/status', gsheetsOauth.status);
router.post('/google-sheets/refresh', gsheetsOauth.refresh);
router.post('/google-sheets/disconnect', gsheetsOauth.disconnect);

module.exports = router;
