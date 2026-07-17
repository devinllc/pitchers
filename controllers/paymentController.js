const Payment = require('../models/Payment');
const ApiKey = require('../models/ApiKey');
const DatabaseService = require('../services/database');
const RazorpayService = require('../services/razorpayService');

class PaymentController {
    constructor() {
        this.databaseService = new DatabaseService();
        this.paymentModel = new Payment(this.databaseService);
        this.apiKeyModel = new ApiKey(this.databaseService);
        this.razorpayService = new RazorpayService();
    }

    // Initialize payment tables
    async initialize() {
        try {
            await this.paymentModel.createPaymentsTable();
            console.log('Payment tables initialized successfully');
        } catch (error) {
            console.error('Error initializing payment tables:', error);
            throw error;
        }
    }

    // Create a new payment order
    async createPayment(req, res) {
        try {
            const { userEmail, planType, amount, currency = 'INR', prefill = {} } = req.body;

            if (!userEmail || !planType || !amount) {
                return res.status(400).json({
                    success: false,
                    error: 'Missing required fields',
                    message: 'User email, plan type, and amount are required'
                });
            }

            console.log('Creating payment with data:', { userEmail, planType, amount, currency });

            // Create mock Razorpay order for development
            const mockOrderId = `order_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
            const paymentId = `pay_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
            
            // Save payment record to database
            const paymentData = {
                userEmail,
                paymentId,
                razorpayOrderId: mockOrderId,
                planType,
                amount: parseFloat(amount),
                currency: currency,
                metadata: {
                    created_via: 'api',
                    user_agent: req.headers['user-agent'],
                    mock_order: true
                }
            };

            console.log('Payment data to save:', paymentData);

            const payment = await this.paymentModel.createPayment(paymentData);
            console.log('Payment saved:', payment);

            // Generate mock payment link for frontend
            const paymentLinkData = {
                key: 'rzp_test_mock',
                amount: parseFloat(amount) * 100, // Convert to paise
                currency: currency,
                name: 'Business Scraper',
                description: 'Lead Generation Service',
                order_id: mockOrderId,
                prefill: {
                    name: prefill.name || '',
                    email: userEmail,
                    contact: prefill.contact || ''
                },
                theme: {
                    color: '#3399cc'
                },
                callback_url: `${process.env.BASE_URL || 'https://pitchers.ufdevs.me'}/api/payments/callback`,
                cancel_url: `${process.env.BASE_URL || 'https://pitchers.ufdevs.me'}/api/payments/cancel`
            };

            res.status(201).json({
                success: true,
                message: 'Payment order created successfully',
                data: {
                    payment: {
                        id: payment.id,
                        paymentId: payment.payment_id,
                        orderId: mockOrderId,
                        status: payment.status,
                        amount: payment.amount,
                        currency: payment.currency,
                        planType: payment.plan_type,
                        createdAt: payment.created_at
                    },
                    paymentLink: paymentLinkData,
                    orderId: mockOrderId
                }
            });
        } catch (error) {
            console.error('Error creating payment:', error);
            res.status(500).json({
                success: false,
                error: 'Internal server error',
                message: 'Failed to create payment',
                details: error.message
            });
        }
    }

    // Verify payment and create subscription
    async verifyPayment(req, res) {
        try {
            const { paymentId } = req.params;
            const { userEmail } = req.body;

            if (!paymentId) {
                return res.status(400).json({
                    success: false,
                    error: 'Payment ID required',
                    message: 'Payment ID is required for verification'
                });
            }

            // Verify payment
            const verificationResult = await this.paymentModel.verifyPayment(paymentId);
            
            if (!verificationResult.success) {
                return res.status(400).json({
                    success: false,
                    error: 'Payment verification failed',
                    message: verificationResult.error
                });
            }

            const payment = verificationResult.payment;

            // Create subscription
            const subscription = await this.paymentModel.createSubscription(
                payment.user_email,
                payment.plan_type,
                payment.payment_id
            );

            // Generate API key for the user after successful payment verification.
            const apiKey = await this.apiKeyModel.createApiKey(payment.user_email, payment.plan_type);
            console.log('API key created from verifyPayment:', {
                userEmail: payment.user_email,
                planType: payment.plan_type,
                apiKeyPreview: apiKey?.api_key ? `${apiKey.api_key.substring(0, 10)}...` : null
            });

            res.json({
                success: true,
                message: 'Payment verified and subscription created successfully',
                data: {
                    payment: {
                        id: payment.payment_id,
                        status: payment.status,
                        amount: payment.amount,
                        planType: payment.plan_type
                    },
                    subscription: {
                        id: subscription.subscription_id,
                        status: subscription.subscription_status,
                        expiresAt: subscription.subscription_expires_at
                    },
                    apiKey: {
                        key: apiKey.api_key,
                        createdAt: apiKey.created_at
                    }
                }
            });
        } catch (error) {
            console.error('Error verifying payment:', error);
            res.status(500).json({
                success: false,
                error: 'Internal server error',
                message: 'Failed to verify payment'
            });
        }
    }

    // Get payment by ID
    async getPayment(req, res) {
        try {
            const { paymentId } = req.params;

            const payment = await this.paymentModel.getPayment(paymentId);
            
            if (!payment) {
                return res.status(404).json({
                    success: false,
                    error: 'Payment not found',
                    message: 'Payment with the specified ID does not exist'
                });
            }

            res.json({
                success: true,
                payment: {
                    id: payment.payment_id,
                    userEmail: payment.user_email,
                    planType: payment.plan_type,
                    amount: payment.amount,
                    status: payment.status,
                    subscriptionId: payment.subscription_id,
                    subscriptionStatus: payment.subscription_status,
                    subscriptionExpiresAt: payment.subscription_expires_at,
                    createdAt: payment.created_at,
                    updatedAt: payment.updated_at
                }
            });
        } catch (error) {
            console.error('Error getting payment:', error);
            res.status(500).json({
                success: false,
                error: 'Internal server error',
                message: 'Failed to get payment'
            });
        }
    }

    // Get user's payment history
    async getUserPayments(req, res) {
        try {
            const { userEmail } = req.params;
            const { limit = 20, offset = 0 } = req.query;

            const payments = await this.paymentModel.getUserPayments(
                userEmail,
                parseInt(limit),
                parseInt(offset)
            );

            res.json({
                success: true,
                payments: payments.map(payment => ({
                    id: payment.payment_id,
                    planType: payment.plan_type,
                    amount: payment.amount,
                    status: payment.status,
                    subscriptionId: payment.subscription_id,
                    subscriptionStatus: payment.subscription_status,
                    subscriptionExpiresAt: payment.subscription_expires_at,
                    createdAt: payment.created_at
                })),
                pagination: {
                    limit: parseInt(limit),
                    offset: parseInt(offset),
                    total: payments.length
                }
            });
        } catch (error) {
            console.error('Error getting user payments:', error);
            res.status(500).json({
                success: false,
                error: 'Internal server error',
                message: 'Failed to get user payments'
            });
        }
    }

    // Get user's active subscription
    async getUserSubscription(req, res) {
        try {
            const { userEmail } = req.params;

            const subscription = await this.paymentModel.getUserActiveSubscription(userEmail);
            
            if (!subscription) {
                return res.status(404).json({
                    success: false,
                    error: 'No active subscription',
                    message: 'User does not have an active subscription'
                });
            }

            res.json({
                success: true,
                subscription: {
                    id: subscription.subscription_id,
                    planType: subscription.plan_type,
                    status: subscription.subscription_status,
                    expiresAt: subscription.subscription_expires_at,
                    paymentId: subscription.payment_id,
                    amount: subscription.amount,
                    createdAt: subscription.created_at
                }
            });
        } catch (error) {
            console.error('Error getting user subscription:', error);
            res.status(500).json({
                success: false,
                error: 'Internal server error',
                message: 'Failed to get user subscription'
            });
        }
    }

    // Get payment statistics
    async getPaymentStatistics(req, res) {
        try {
            const { userEmail } = req.query;

            const stats = await this.paymentModel.getPaymentStatistics(userEmail);

            res.json({
                success: true,
                statistics: {
                    totalPayments: parseInt(stats.total_payments) || 0,
                    successfulPayments: parseInt(stats.successful_payments) || 0,
                    failedPayments: parseInt(stats.failed_payments) || 0,
                    totalRevenue: parseFloat(stats.total_revenue) || 0,
                    activeSubscriptions: parseInt(stats.active_subscriptions) || 0
                }
            });
        } catch (error) {
            console.error('Error getting payment statistics:', error);
            res.status(500).json({
                success: false,
                error: 'Internal server error',
                message: 'Failed to get payment statistics'
            });
        }
    }

    // Razorpay webhook handler
    async handleWebhook(req, res) {
        try {
            const signature = req.headers['x-razorpay-signature'];
            const eventData = req.body;

            if (!signature || !eventData) {
                return res.status(400).json({
                    success: false,
                    error: 'Missing webhook signature or data',
                    message: 'Invalid webhook request'
                });
            }

            // Process webhook event
            const webhookResult = await this.razorpayService.processWebhookEvent(eventData, signature);

            if (!webhookResult.success) {
                return res.status(400).json({
                    success: false,
                    error: 'Webhook processing failed',
                    message: webhookResult.error
                });
            }

            const { event, payment, order_id, payment_id, status, method } = webhookResult;

            // Update payment in database
            const webhookData = {
                status: status,
                method: method,
                signature_verified: true,
                order_id: order_id,
                payment_id: payment_id
            };

            const updatedPayment = await this.paymentModel.updatePaymentViaWebhook(payment_id, webhookData);

            if (!updatedPayment) {
                console.error('Payment not found for webhook:', payment_id);
                return res.status(404).json({
                    success: false,
                    error: 'Payment not found',
                    message: 'Payment record not found in database'
                });
            }

            // Handle successful payment
            if (event === 'payment.captured' && status === 'captured') {
                // Create subscription
                const subscription = await this.paymentModel.createSubscription(
                    updatedPayment.user_email,
                    updatedPayment.plan_type,
                    payment_id
                );

                // Generate API key
                const apiKeyData = {
                    userEmail: updatedPayment.user_email,
                    planType: updatedPayment.plan_type,
                    subscriptionId: subscription.subscription_id,
                    metadata: {
                        payment_id: payment_id,
                        created_after_payment: true,
                        webhook_event: event
                    }
                };

                const apiKey = await this.apiKeyModel.createApiKey(apiKeyData);

                console.log(`✅ Payment captured and subscription created for ${updatedPayment.user_email}`);
                console.log(`🔑 API key generated: ${apiKey.api_key}`);
            }

            res.json({
                success: true,
                message: 'Webhook processed successfully',
                event: event,
                paymentId: payment_id,
                status: status
            });

        } catch (error) {
            console.error('Error processing webhook:', error);
            res.status(500).json({
                success: false,
                error: 'Internal server error',
                message: 'Failed to process webhook'
            });
        }
    }

    // Payment callback handler (for frontend redirects)
    async handlePaymentCallback(req, res) {
        try {
            const { razorpay_payment_id, razorpay_order_id, razorpay_signature } = req.query;

            if (!razorpay_payment_id || !razorpay_order_id || !razorpay_signature) {
                return res.status(400).json({
                    success: false,
                    error: 'Missing payment parameters',
                    message: 'Invalid payment callback'
                });
            }

            // Verify payment signature
            const isSignatureValid = this.razorpayService.verifyPaymentSignature(
                razorpay_payment_id,
                razorpay_order_id,
                razorpay_signature
            );

            if (!isSignatureValid) {
                return res.status(400).json({
                    success: false,
                    error: 'Invalid payment signature',
                    message: 'Payment verification failed'
                });
            }

            // Get payment details
            const paymentResult = await this.razorpayService.fetchPayment(razorpay_payment_id);

            if (!paymentResult.success) {
                return res.status(400).json({
                    success: false,
                    error: 'Payment fetch failed',
                    message: paymentResult.error
                });
            }

            const payment = paymentResult.payment;

            // Update payment in database
            const webhookData = {
                status: payment.status,
                method: payment.method,
                signature_verified: true,
                order_id: payment.order_id,
                payment_id: payment.id
            };

            const updatedPayment = await this.paymentModel.updatePaymentViaWebhook(payment.id, webhookData);

            if (payment.status === 'captured') {
                // Create subscription and API key
                const subscription = await this.paymentModel.createSubscription(
                    updatedPayment.user_email,
                    updatedPayment.plan_type,
                    payment.id
                );

                const apiKeyData = {
                    userEmail: updatedPayment.user_email,
                    planType: updatedPayment.plan_type,
                    subscriptionId: subscription.subscription_id,
                    metadata: {
                        payment_id: payment.id,
                        created_after_payment: true,
                        callback_verified: true
                    }
                };

                const apiKey = await this.apiKeyModel.createApiKey(apiKeyData);

                // Redirect to success page
                const successUrl = `${process.env.FRONTEND_URL || 'https://pitchers.ufdevs.me'}/dashboard?payment=success&apiKey=${apiKey.api_key}`;
                return res.redirect(successUrl);
            } else {
                // Redirect to failure page
                const failureUrl = `${process.env.FRONTEND_URL || 'https://pitchers.ufdevs.me'}/dashboard?payment=failed&error=${encodeURIComponent('Payment not captured')}`;
                return res.redirect(failureUrl);
            }

        } catch (error) {
            console.error('Error handling payment callback:', error);
            const errorUrl = `${process.env.FRONTEND_URL || 'https://pitchers.ufdevs.me'}/dashboard?payment=error&error=${encodeURIComponent(error.message)}`;
            return res.redirect(errorUrl);
        }
    }

    // Payment cancel handler
    async handlePaymentCancel(req, res) {
        try {
            const { razorpay_order_id } = req.query;

            if (razorpay_order_id) {
                // Update payment status to cancelled
                const payment = await this.paymentModel.getPaymentByOrderId(razorpay_order_id);
                if (payment) {
                    await this.paymentModel.updatePaymentStatus(payment.payment_id, 'cancelled', {
                        cancelled_at: new Date().toISOString(),
                        cancelled_reason: 'User cancelled payment'
                    });
                }
            }

            // Redirect to cancel page
            const cancelUrl = `${process.env.FRONTEND_URL || 'https://pitchers.ufdevs.me'}/dashboard?payment=cancelled`;
            return res.redirect(cancelUrl);

        } catch (error) {
            console.error('Error handling payment cancel:', error);
            const errorUrl = `${process.env.FRONTEND_URL || 'https://pitchers.ufdevs.me'}/dashboard?payment=error&error=${encodeURIComponent(error.message)}`;
            return res.redirect(errorUrl);
        }
    }

    // Mock payment webhook (for testing)
    async mockPaymentWebhook(req, res) {
        try {
            const { paymentId, status, metadata } = req.body;

            if (!paymentId || !status) {
                return res.status(400).json({
                    success: false,
                    error: 'Missing required fields',
                    message: 'Payment ID and status are required'
                });
            }

            const updatedPayment = await this.paymentModel.updatePaymentStatus(
                paymentId,
                status,
                metadata || {}
            );

            res.json({
                success: true,
                message: 'Payment status updated successfully',
                payment: {
                    id: updatedPayment.id,
                    paymentId: updatedPayment.payment_id,
                    status: updatedPayment.status,
                    updatedAt: updatedPayment.updated_at
                }
            });
        } catch (error) {
            console.error('Error updating payment status:', error);
            res.status(500).json({
                success: false,
                error: 'Internal server error',
                message: 'Failed to update payment status'
            });
        }
    }
}

module.exports = PaymentController;
