const express = require('express');
const router = express.Router();
const JWTAuthMiddleware = require('../middleware/jwtAuth');
const SubscriptionCheckMiddleware = require('../middleware/subscriptionCheck');
const PaymentController = require('../controllers/paymentController');

// Initialize middleware
const jwtAuth = new JWTAuthMiddleware();
const subscriptionCheck = new SubscriptionCheckMiddleware();
const paymentController = new PaymentController();

// Initialize tables
subscriptionCheck.initialize().catch(console.error);

// Get all available plans
router.get('/plans', async (req, res) => {
    try {
        const plans = await subscriptionCheck.getAllPlans();
        
        return res.json({
            success: true,
            plans
        });
    } catch (error) {
        console.error('Error getting plans:', error);
        return res.status(500).json({
            success: false,
            error: 'Failed to get plans',
            message: error.message
        });
    }
});

// Get user's current subscription (requires authentication)
router.get('/status', jwtAuth.authenticate(), async (req, res) => {
    try {
        const userEmail = req.user.email;
        const subscription = await subscriptionCheck.getUserSubscription(userEmail);
        
        if (!subscription) {
            return res.json({
                success: true,
                hasSubscription: false,
                message: 'No active subscription found'
            });
        }
        
        return res.json({
            success: true,
            hasSubscription: true,
            subscription: {
                plan: subscription.plan_name,
                status: subscription.status,
                expiresAt: subscription.expires_at,
                features: subscription.features
            }
        });
    } catch (error) {
        console.error('Error getting subscription status:', error);
        return res.status(500).json({
            success: false,
            error: 'Failed to get subscription status',
            message: error.message
        });
    }
});

// Create a new subscription (requires authentication)
router.post('/create', jwtAuth.authenticate(), async (req, res) => {
    try {
        const { planId } = req.body;
        const userEmail = req.user.email;
        
        if (!planId) {
            return res.status(400).json({
                success: false,
                error: 'Plan ID is required',
                message: 'Please select a plan'
            });
        }
        
        // Create Razorpay order
        const order = await paymentController.createRazorpayOrder(planId, userEmail);
        
        return res.json({
            success: true,
            order: {
                id: order.id,
                amount: order.amount,
                currency: order.currency
            },
            paymentDetails: {
                key: process.env.RAZORPAY_KEY_ID,
                name: 'Pitchers',
                description: 'Subscription Payment',
                prefill: {
                    email: userEmail
                }
            }
        });
    } catch (error) {
        console.error('Error creating subscription:', error);
        return res.status(500).json({
            success: false,
            error: 'Failed to create subscription',
            message: error.message
        });
    }
});

// Verify payment and activate subscription
router.post('/verify-payment', jwtAuth.authenticate(), async (req, res) => {
    try {
        const { razorpay_payment_id, razorpay_order_id, razorpay_signature } = req.body;
        const userEmail = req.user.email;
        
        if (!razorpay_payment_id || !razorpay_order_id || !razorpay_signature) {
            return res.status(400).json({
                success: false,
                error: 'Payment verification failed',
                message: 'Missing payment details'
            });
        }
        
        // Verify payment
        const isValid = await paymentController.verifyRazorpayPayment({
            payment_id: razorpay_payment_id,
            order_id: razorpay_order_id,
            signature: razorpay_signature
        });
        
        if (!isValid) {
            return res.status(400).json({
                success: false,
                error: 'Payment verification failed',
                message: 'Invalid payment signature'
            });
        }
        
        // Activate subscription
        const subscription = await paymentController.activateSubscription(
            razorpay_payment_id,
            razorpay_order_id,
            userEmail
        );
        
        return res.json({
            success: true,
            message: 'Payment verified and subscription activated',
            subscription: {
                plan: subscription.plan_name,
                status: subscription.status,
                expiresAt: subscription.expires_at
            }
        });
    } catch (error) {
        console.error('Error verifying payment:', error);
        return res.status(500).json({
            success: false,
            error: 'Failed to verify payment',
            message: error.message
        });
    }
});

// Razorpay webhook handler
router.post('/webhook', async (req, res) => {
    try {
        // Verify webhook signature
        const signature = req.headers['x-razorpay-signature'];
        
        if (!signature) {
            return res.status(400).json({
                success: false,
                error: 'Missing webhook signature'
            });
        }
        
        // Process webhook event
        const event = req.body;
        await paymentController.processRazorpayWebhook(event, signature);
        
        // Always return 200 OK for webhooks
        return res.json({
            success: true,
            message: 'Webhook processed successfully'
        });
    } catch (error) {
        console.error('Error processing webhook:', error);
        // Still return 200 OK to prevent retries
        return res.json({
            success: false,
            error: 'Failed to process webhook',
            message: error.message
        });
    }
});

// Cancel subscription (requires authentication)
router.post('/cancel', jwtAuth.authenticate(), async (req, res) => {
    try {
        const userEmail = req.user.email;
        
        // Cancel subscription
        const result = await paymentController.cancelSubscription(userEmail);
        
        if (!result) {
            return res.status(404).json({
                success: false,
                error: 'No active subscription found',
                message: 'You do not have an active subscription to cancel'
            });
        }
        
        return res.json({
            success: true,
            message: 'Subscription cancelled successfully'
        });
    } catch (error) {
        console.error('Error cancelling subscription:', error);
        return res.status(500).json({
            success: false,
            error: 'Failed to cancel subscription',
            message: error.message
        });
    }
});

module.exports = router;
