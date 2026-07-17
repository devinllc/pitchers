const crypto = require('crypto');
const axios = require('axios');

class RazorpayService {
    constructor() {
        this.keyId = process.env.RAZORPAY_KEY_ID;
        this.keySecret = process.env.RAZORPAY_KEY_SECRET;
        this.webhookSecret = process.env.RAZORPAY_WEBHOOK_SECRET;
        
        if (!this.keyId || !this.keySecret) {
            console.warn('Razorpay credentials not configured. Payment processing will be mocked.');
        }
        
        this.baseUrl = 'https://api.razorpay.com/v1';
    }

    // Create a Razorpay order
    async createOrder(orderData) {
        const { amount, currency = 'INR', receipt, notes = {} } = orderData;
        
        if (!this.keyId || !this.keySecret) {
            // Mock order creation for development
            return this.createMockOrder(orderData);
        }

        try {
            const response = await axios.post(`${this.baseUrl}/orders`, {
                amount: amount * 100, // Convert to paise
                currency: currency,
                receipt: receipt,
                notes: notes
            }, {
                auth: {
                    username: this.keyId,
                    password: this.keySecret
                },
                headers: {
                    'Content-Type': 'application/json'
                }
            });

            return {
                success: true,
                order: response.data,
                orderId: response.data.id
            };
        } catch (error) {
            console.error('Error creating Razorpay order:', error.response?.data || error.message);
            return {
                success: false,
                error: error.response?.data?.error?.description || error.message
            };
        }
    }

    // Create mock order for development
    createMockOrder(orderData) {
        const mockOrderId = `order_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
        return {
            success: true,
            order: {
                id: mockOrderId,
                amount: orderData.amount * 100,
                currency: orderData.currency || 'INR',
                receipt: orderData.receipt,
                status: 'created',
                created_at: Math.floor(Date.now() / 1000)
            },
            orderId: mockOrderId
        };
    }

    // Verify payment signature
    verifyPaymentSignature(paymentId, orderId, signature) {
        if (!this.keySecret) {
            console.warn('Razorpay secret not configured. Signature verification skipped.');
            return true;
        }

        try {
            const expectedSignature = crypto
                .createHmac('sha256', this.keySecret)
                .update(`${orderId}|${paymentId}`)
                .digest('hex');

            return crypto.timingSafeEqual(
                Buffer.from(expectedSignature, 'hex'),
                Buffer.from(signature, 'hex')
            );
        } catch (error) {
            console.error('Error verifying payment signature:', error);
            return false;
        }
    }

    // Verify webhook signature
    verifyWebhookSignature(payload, signature) {
        if (!this.webhookSecret) {
            console.warn('Razorpay webhook secret not configured. Webhook verification skipped.');
            return true;
        }

        try {
            const expectedSignature = crypto
                .createHmac('sha256', this.webhookSecret)
                .update(payload)
                .digest('hex');

            return crypto.timingSafeEqual(
                Buffer.from(expectedSignature, 'hex'),
                Buffer.from(signature, 'hex')
            );
        } catch (error) {
            console.error('Error verifying webhook signature:', error);
            return false;
        }
    }

    // Fetch payment details from Razorpay
    async fetchPayment(paymentId) {
        if (!this.keyId || !this.keySecret) {
            // Mock payment fetch for development
            return this.createMockPayment(paymentId);
        }

        try {
            const response = await axios.get(`${this.baseUrl}/payments/${paymentId}`, {
                auth: {
                    username: this.keyId,
                    password: this.keySecret
                }
            });

            return {
                success: true,
                payment: response.data
            };
        } catch (error) {
            console.error('Error fetching payment from Razorpay:', error.response?.data || error.message);
            return {
                success: false,
                error: error.response?.data?.error?.description || error.message
            };
        }
    }

    // Create mock payment for development
    createMockPayment(paymentId) {
        return {
            success: true,
            payment: {
                id: paymentId,
                order_id: `order_${Date.now()}`,
                amount: 299900, // 2999.00 in paise
                currency: 'INR',
                status: 'captured',
                method: 'card',
                captured: true,
                description: 'Mock payment for testing',
                email: 'test@example.com',
                contact: '+919999999999',
                created_at: Math.floor(Date.now() / 1000)
            }
        };
    }

    // Process webhook event
    async processWebhookEvent(eventData, signature) {
        try {
            // Verify webhook signature
            const payload = JSON.stringify(eventData);
            const isSignatureValid = this.verifyWebhookSignature(payload, signature);

            if (!isSignatureValid) {
                console.error('Invalid webhook signature');
                return {
                    success: false,
                    error: 'Invalid webhook signature'
                };
            }

            const event = eventData.event;
            const payment = eventData.payload.payment.entity;

            return {
                success: true,
                event: event,
                payment: payment,
                signature_verified: true,
                order_id: payment.order_id,
                payment_id: payment.id,
                status: payment.status,
                method: payment.method
            };
        } catch (error) {
            console.error('Error processing webhook event:', error);
            return {
                success: false,
                error: error.message
            };
        }
    }

    // Generate payment link for frontend
    generatePaymentLink(orderId, options = {}) {
        const {
            prefill = {},
            theme = {},
            modal = {},
            callback_url,
            cancel_url
        } = options;

        if (!this.keyId) {
            console.warn('Razorpay key not configured. Using mock payment link.');
            return {
                success: true,
                paymentLink: `https://mock-razorpay.com/pay/${orderId}`,
                orderId: orderId
            };
        }

        const paymentData = {
            key: this.keyId,
            amount: prefill.amount || 0,
            currency: prefill.currency || 'INR',
            name: prefill.name || 'Business Scraper',
            description: prefill.description || 'Lead Generation Service',
            order_id: orderId,
            prefill: {
                name: prefill.name || '',
                email: prefill.email || '',
                contact: prefill.contact || ''
            },
            theme: {
                color: theme.color || '#3399cc'
            },
            modal: {
                ondismiss: modal.ondismiss || null
            },
            callback_url: callback_url,
            cancel_url: cancel_url
        };

        return {
            success: true,
            paymentData: paymentData,
            orderId: orderId
        };
    }

    // Refund payment
    async refundPayment(paymentId, amount, reason = '') {
        if (!this.keyId || !this.keySecret) {
            // Mock refund for development
            return this.createMockRefund(paymentId, amount);
        }

        try {
            const response = await axios.post(`${this.baseUrl}/payments/${paymentId}/refund`, {
                amount: amount * 100, // Convert to paise
                speed: 'normal',
                notes: {
                    reason: reason
                }
            }, {
                auth: {
                    username: this.keyId,
                    password: this.keySecret
                },
                headers: {
                    'Content-Type': 'application/json'
                }
            });

            return {
                success: true,
                refund: response.data
            };
        } catch (error) {
            console.error('Error refunding payment:', error.response?.data || error.message);
            return {
                success: false,
                error: error.response?.data?.error?.description || error.message
            };
        }
    }

    // Create mock refund for development
    createMockRefund(paymentId, amount) {
        const refundId = `rfnd_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
        return {
            success: true,
            refund: {
                id: refundId,
                payment_id: paymentId,
                amount: amount * 100,
                currency: 'INR',
                status: 'processed',
                created_at: Math.floor(Date.now() / 1000)
            }
        };
    }

    // Get payment analytics
    async getPaymentAnalytics(startDate, endDate) {
        if (!this.keyId || !this.keySecret) {
            // Mock analytics for development
            return this.createMockAnalytics();
        }

        try {
            const response = await axios.get(`${this.baseUrl}/payments`, {
                auth: {
                    username: this.keyId,
                    password: this.keySecret
                },
                params: {
                    from: Math.floor(new Date(startDate).getTime() / 1000),
                    to: Math.floor(new Date(endDate).getTime() / 1000),
                    count: 100
                }
            });

            return {
                success: true,
                analytics: response.data
            };
        } catch (error) {
            console.error('Error fetching payment analytics:', error.response?.data || error.message);
            return {
                success: false,
                error: error.response?.data?.error?.description || error.message
            };
        }
    }

    // Create mock analytics for development
    createMockAnalytics() {
        return {
            success: true,
            analytics: {
                total_payments: 150,
                successful_payments: 142,
                failed_payments: 8,
                total_amount: 4500000, // 45,000 INR in paise
                average_amount: 30000, // 300 INR in paise
                currency: 'INR'
            }
        };
    }
}

module.exports = RazorpayService;
