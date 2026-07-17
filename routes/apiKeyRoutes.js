const express = require('express');
const ApiKeyController = require('../controllers/apiKeyController');

const router = express.Router();
const apiKeyController = new ApiKeyController();

// Initialize API key tables on startup
apiKeyController.initializeTables().catch(error => {
    console.error('Failed to initialize API key tables:', error);
});

// Initialize API key tables (admin endpoint)
router.post('/init', async (req, res) => {
    try {
        const result = await apiKeyController.initializeTables();
        res.json(result);
    } catch (error) {
        res.status(500).json({
            error: 'Internal server error',
            message: 'Failed to initialize API key tables'
        });
    }
});

// Admin: list all API keys
router.get('/admin/keys', (req, res) => {
    apiKeyController.adminListAllKeys(req, res);
});

// Admin: summary grouped by user
router.get('/admin/users', (req, res) => {
    apiKeyController.adminListUsersSummary(req, res);
});

// Create new API key
router.post('/create', (req, res) => {
    apiKeyController.createApiKey(req, res);
});

// Get available plans
router.get('/plans', (req, res) => {
    apiKeyController.getPlans(req, res);
});

// Get API key usage statistics
router.get('/:apiKey/stats', (req, res) => {
    apiKeyController.getUsageStats(req, res);
});

// Update API key plan
router.put('/:apiKey/plan', (req, res) => {
    apiKeyController.updatePlan(req, res);
});

// Deactivate API key
router.delete('/:apiKey', (req, res) => {
    apiKeyController.deactivateApiKey(req, res);
});

// Update API key limits
router.put('/:apiKey/limits', (req, res) => {
    apiKeyController.updateLimits(req, res);
});

// Activate API key via PUT
router.put('/:apiKey/activate', async (req, res) => {
    try {
        const { apiKey } = req.params;
        const result = await apiKeyController.apiKeyModel.updateLimits(apiKey, { isActive: true });
        res.json({ success: true, message: 'API Key activated successfully', data: result });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Deactivate API key via PUT
router.put('/:apiKey/deactivate', async (req, res) => {
    try {
        const { apiKey } = req.params;
        const result = await apiKeyController.apiKeyModel.updateLimits(apiKey, { isActive: false });
        res.json({ success: true, message: 'API Key deactivated successfully', data: result });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Reset usage count
router.post('/:apiKey/reset-usage', (req, res) => {
    apiKeyController.resetUsage(req, res);
});
router.put('/:apiKey/reset-usage', (req, res) => {
    apiKeyController.resetUsage(req, res);
});

// Get user's API keys
router.get('/user/:userEmail', (req, res) => {
    apiKeyController.getUserApiKeys(req, res);
});

module.exports = router;
