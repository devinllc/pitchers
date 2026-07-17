const express = require('express');
const router = express.Router();
const PaymentController = require('../controllers/paymentController');

// Initialize payment controller
const paymentController = new PaymentController();

// Initialize payment tables on startup
paymentController.initialize().catch(console.error);

// Test endpoint to check database connection (must come first)
router.get('/payments/test', async (req, res) => {
    try {
        const client = await paymentController.databaseService.pool.connect();
        client.release();
        res.json({
            success: true,
            message: 'Database connection successful',
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            error: 'Database connection failed',
            message: error.message
        });
    }
});

// POST /payments - Create a new payment
router.post('/payments', async (req, res) => {
    await paymentController.createPayment(req, res);
});

// GET /payments/statistics - Get payment statistics (must come before /:paymentId)
router.get('/payments/statistics', async (req, res) => {
    await paymentController.getPaymentStatistics(req, res);
});

// GET /payments/user/:userEmail - Get user's payment history
router.get('/payments/user/:userEmail', async (req, res) => {
    await paymentController.getUserPayments(req, res);
});

// GET /subscriptions/user/:userEmail - Get user's active subscription
router.get('/subscriptions/user/:userEmail', async (req, res) => {
    await paymentController.getUserSubscription(req, res);
});

// POST /payments/:paymentId/verify - Verify payment and create subscription
router.post('/payments/:paymentId/verify', async (req, res) => {
    await paymentController.verifyPayment(req, res);
});

// GET /payments/:paymentId - Get payment by ID (must come after specific routes)
router.get('/payments/:paymentId', async (req, res) => {
    await paymentController.getPayment(req, res);
});

// POST /payments/webhook - Razorpay webhook handler
router.post('/payments/webhook', async (req, res) => {
    await paymentController.handleWebhook(req, res);
});

// GET /payments/callback - Payment callback handler
router.get('/payments/callback', async (req, res) => {
    await paymentController.handlePaymentCallback(req, res);
});

// GET /payments/cancel - Payment cancel handler
router.get('/payments/cancel', async (req, res) => {
    await paymentController.handlePaymentCancel(req, res);
});

// POST /payments/mock-webhook - Mock payment webhook (for testing)
router.post('/payments/mock-webhook', async (req, res) => {
    await paymentController.mockPaymentWebhook(req, res);
});

module.exports = router;
