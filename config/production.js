module.exports = {
    // Database Configuration
    database: {
        url: process.env.DATABASE_URL,
        ssl: process.env.NODE_ENV === 'production',
        pool: {
            max: 20,
            idleTimeoutMillis: 30000,
            connectionTimeoutMillis: 10000
        }
    },

    // Razorpay Configuration
    razorpay: {
        keyId: process.env.RAZORPAY_KEY_ID,
        keySecret: process.env.RAZORPAY_KEY_SECRET,
        webhookSecret: process.env.RAZORPAY_WEBHOOK_SECRET,
        currency: 'INR',
        baseUrl: 'https://api.razorpay.com/v1'
    },

    // Application Configuration
    app: {
        port: process.env.PORT || 3000,
        environment: process.env.NODE_ENV || 'development',
        baseUrl: process.env.BASE_URL || 'https://pitchers.ufdevs.me',
        frontendUrl: process.env.FRONTEND_URL || 'https://pitchers.ufdevs.me',
        cors: {
            origin: process.env.CORS_ORIGIN || 'https://pitchers.ufdevs.me',
            credentials: true
        }
    },

    // Payment Plans Configuration
    plans: {
        basic: {
            name: 'Basic Plan',
            price: 999,
            currency: 'INR',
            duration: 30, // days
            features: [
                '1000 API calls per month',
                'Basic support',
                'Email support'
            ],
            limits: {
                maxApiCalls: 1000,
                maxJobs: 10,
                maxResultsPerJob: 100
            }
        },
        pro: {
            name: 'Pro Plan',
            price: 2999,
            currency: 'INR',
            duration: 30, // days
            features: [
                '5000 API calls per month',
                'Priority support',
                'Phone support',
                'Advanced analytics'
            ],
            limits: {
                maxApiCalls: 5000,
                maxJobs: 50,
                maxResultsPerJob: 500
            }
        },
        enterprise: {
            name: 'Enterprise Plan',
            price: 9999,
            currency: 'INR',
            duration: 30, // days
            features: [
                'Unlimited API calls',
                'Dedicated support',
                'Custom integrations',
                'White-label solution'
            ],
            limits: {
                maxApiCalls: -1, // unlimited
                maxJobs: -1, // unlimited
                maxResultsPerJob: 1000
            }
        }
    },

    // Security Configuration
    security: {
        jwtSecret: process.env.JWT_SECRET,
        apiKeyLength: 32,
        rateLimit: {
            windowMs: 15 * 60 * 1000, // 15 minutes
            max: 100 // limit each IP to 100 requests per windowMs
        }
    },

    // Logging Configuration
    logging: {
        level: process.env.LOG_LEVEL || 'info',
        format: process.env.NODE_ENV === 'production' ? 'json' : 'simple',
        transports: ['console', 'file'],
        file: {
            filename: 'logs/app.log',
            maxsize: 10485760, // 10MB
            maxFiles: 5
        }
    },

    // Email Configuration (for notifications)
    email: {
        provider: 'sendgrid',
        apiKey: process.env.SENDGRID_API_KEY,
        fromEmail: process.env.FROM_EMAIL || 'noreply@pitchers.ufdevs.me',
        templates: {
            paymentSuccess: 'd-xxxxxxxxxxxxxxxxxxxxxxxx',
            paymentFailed: 'd-xxxxxxxxxxxxxxxxxxxxxxxx',
            subscriptionExpiring: 'd-xxxxxxxxxxxxxxxxxxxxxxxx'
        }
    },

    // Monitoring Configuration
    monitoring: {
        enabled: process.env.NODE_ENV === 'production',
        metrics: {
            enabled: true,
            port: process.env.METRICS_PORT || 9090
        },
        healthCheck: {
            enabled: true,
            interval: 30000 // 30 seconds
        }
    },

    // Webhook Configuration
    webhooks: {
        razorpay: {
            url: '/api/payments/webhook',
            events: ['payment.captured', 'payment.failed', 'order.paid'],
            retryAttempts: 3,
            timeout: 10000 // 10 seconds
        }
    },

    // Cache Configuration
    cache: {
        redis: {
            enabled: process.env.REDIS_URL ? true : false,
            url: process.env.REDIS_URL,
            ttl: 3600 // 1 hour
        },
        memory: {
            enabled: true,
            maxSize: 1000,
            ttl: 1800 // 30 minutes
        }
    },

    // Job Processing Configuration
    jobs: {
        maxConcurrent: 5,
        timeout: 300000, // 5 minutes
        retryAttempts: 3,
        retryDelay: 5000 // 5 seconds
    },

    // API Configuration
    api: {
        version: 'v1',
        prefix: '/api',
        rateLimit: {
            windowMs: 15 * 60 * 1000, // 15 minutes
            max: 1000 // limit each IP to 1000 requests per windowMs
        },
        cors: {
            origin: true,
            credentials: true
        }
    }
};
