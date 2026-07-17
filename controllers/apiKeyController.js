const ApiKey = require('../models/ApiKey');
const DatabaseService = require('../services/database');

class ApiKeyController {
    constructor() {
        this.dbService = new DatabaseService();
        this.apiKeyModel = new ApiKey(this.dbService);
    }

    // Initialize API key tables
    async initializeTables() {
        try {
            await this.apiKeyModel.createApiKeysTable();
            return { success: true, message: 'API key tables initialized successfully' };
        } catch (error) {
            console.error('Error initializing API key tables:', error);
            throw error;
        }
    }

    // Create new API key
    async createApiKey(req, res) {
        try {
            const { userEmail, planType = 'free' } = req.body;

            if (!userEmail) {
                return res.status(400).json({
                    error: 'Validation failed',
                    message: 'User email is required'
                });
            }

            // Validate email format
            const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
            if (!emailRegex.test(userEmail)) {
                return res.status(400).json({
                    error: 'Validation failed',
                    message: 'Invalid email format'
                });
            }

            // Validate plan type
            const validPlans = ['free', 'trial', 'basic', 'pro', 'enterprise'];
            if (!validPlans.includes(planType)) {
                return res.status(400).json({
                    error: 'Validation failed',
                    message: 'Invalid plan type. Must be one of: ' + validPlans.join(', ')
                });
            }

            const apiKeyData = await this.apiKeyModel.createApiKey(userEmail, planType);

            res.status(201).json({
                success: true,
                message: 'API key created successfully',
                data: {
                    apiKey: apiKeyData.api_key,
                    userEmail: apiKeyData.user_email,
                    planType: apiKeyData.plan_type,
                    usageLimit: apiKeyData.usage_limit,
                    rateLimit: apiKeyData.rate_limit_per_minute,
                    expiresAt: apiKeyData.expires_at,
                    createdAt: apiKeyData.created_at
                }
            });

        } catch (error) {
            console.error('Error creating API key:', error);
            res.status(500).json({
                error: 'Internal server error',
                message: 'Failed to create API key'
            });
        }
    }

    // Get API key usage statistics
    async getUsageStats(req, res) {
        try {
            const { apiKey } = req.params;

            if (!apiKey) {
                return res.status(400).json({
                    error: 'Validation failed',
                    message: 'API key is required'
                });
            }

            const stats = await this.apiKeyModel.getUsageStats(apiKey);

            if (!stats) {
                return res.status(404).json({
                    error: 'Not found',
                    message: 'API key not found'
                });
            }

            const usagePercentage = (stats.usage_count / stats.usage_limit) * 100;

            res.json({
                success: true,
                data: {
                    apiKey: stats.api_key,
                    userEmail: stats.user_email,
                    planType: stats.plan_type,
                    usage: {
                        current: stats.usage_count,
                        limit: stats.usage_limit,
                        percentage: Math.round(usagePercentage * 100) / 100,
                        remaining: stats.usage_limit - stats.usage_count
                    },
                    rateLimit: stats.rate_limit_per_minute,
                    automationLimit: stats.automation_limit,
                    autoReplyLimit: stats.auto_reply_limit,
                    whatsappCampaignLimit: stats.whatsapp_campaign_limit,
                    emailCampaignLimit: stats.email_campaign_limit,
                    whatsappSendLimit: stats.whatsapp_send_limit,
                    emailSendLimit: stats.email_send_limit,
                    isActive: stats.is_active,
                    expiresAt: stats.expires_at,
                    createdAt: stats.created_at,
                    lastUsedAt: stats.last_used_at
                }
            });

        } catch (error) {
            console.error('Error getting usage stats:', error);
            res.status(500).json({
                error: 'Internal server error',
                message: 'Failed to retrieve usage statistics'
            });
        }
    }

    // Update API key plan
    async updatePlan(req, res) {
        try {
            const { apiKey } = req.params;
            const { planType } = req.body;

            if (!apiKey || !planType) {
                return res.status(400).json({
                    error: 'Validation failed',
                    message: 'API key and plan type are required'
                });
            }

            const validPlans = ['free', 'trial', 'basic', 'pro', 'enterprise'];
            if (!validPlans.includes(planType)) {
                return res.status(400).json({
                    error: 'Validation failed',
                    message: 'Invalid plan type. Must be one of: ' + validPlans.join(', ')
                });
            }

            const updatedKey = await this.apiKeyModel.updatePlan(apiKey, planType);

            if (!updatedKey) {
                return res.status(404).json({
                    error: 'Not found',
                    message: 'API key not found'
                });
            }

            res.json({
                success: true,
                message: 'Plan updated successfully',
                data: {
                    apiKey: updatedKey.api_key,
                    planType: updatedKey.plan_type,
                    usageLimit: updatedKey.usage_limit,
                    rateLimit: updatedKey.rate_limit_per_minute,
                    expiresAt: updatedKey.expires_at,
                    updatedAt: updatedKey.updated_at
                }
            });

        } catch (error) {
            console.error('Error updating plan:', error);
            res.status(500).json({
                error: 'Internal server error',
                message: 'Failed to update plan'
            });
        }
    }

    // Deactivate API key
    async deactivateApiKey(req, res) {
        try {
            const { apiKey } = req.params;

            if (!apiKey) {
                return res.status(400).json({
                    error: 'Validation failed',
                    message: 'API key is required'
                });
            }

            const deactivatedKey = await this.apiKeyModel.deactivateApiKey(apiKey);

            if (!deactivatedKey) {
                return res.status(404).json({
                    error: 'Not found',
                    message: 'API key not found'
                });
            }

            res.json({
                success: true,
                message: 'API key deactivated successfully',
                data: {
                    apiKey: deactivatedKey.api_key,
                    isActive: deactivatedKey.is_active,
                    updatedAt: deactivatedKey.updated_at
                }
            });

        } catch (error) {
            console.error('Error deactivating API key:', error);
            res.status(500).json({
                error: 'Internal server error',
                message: 'Failed to deactivate API key'
            });
        }
    }

    // Get user's API keys
    async getUserApiKeys(req, res) {
        try {
            const { userEmail } = req.params;

            if (!userEmail) {
                return res.status(400).json({
                    error: 'Validation failed',
                    message: 'User email is required'
                });
            }

            const apiKeys = await this.apiKeyModel.getUserApiKeys(userEmail);

            const formattedKeys = apiKeys.map(key => ({
                apiKey: key.api_key,
                planType: key.plan_type,
                usage: {
                    current: key.usage_count,
                    limit: key.usage_limit,
                    percentage: Math.round((key.usage_count / key.usage_limit) * 10000) / 100,
                    remaining: key.usage_limit - key.usage_count
                },
                rateLimit: key.rate_limit_per_minute,
                automationLimit: key.automation_limit,
                autoReplyLimit: key.auto_reply_limit,
                whatsappCampaignLimit: key.whatsapp_campaign_limit,
                emailCampaignLimit: key.email_campaign_limit,
                whatsappSendLimit: key.whatsapp_send_limit,
                emailSendLimit: key.email_send_limit,
                isActive: key.is_active,
                expiresAt: key.expires_at,
                createdAt: key.created_at,
                lastUsedAt: key.last_used_at
            }));

            res.json({
                success: true,
                data: {
                    userEmail: userEmail,
                    apiKeys: formattedKeys,
                    totalKeys: formattedKeys.length,
                    activeKeys: formattedKeys.filter(key => key.isActive).length
                }
            });

        } catch (error) {
            console.error('Error getting user API keys:', error);
            res.status(500).json({
                error: 'Internal server error',
                message: 'Failed to retrieve user API keys'
            });
        }
    }

    // Reset usage count
    async resetUsage(req, res) {
        try {
            const { apiKey } = req.params;

            if (!apiKey) {
                return res.status(400).json({
                    error: 'Validation failed',
                    message: 'API key is required'
                });
            }

            const resetKey = await this.apiKeyModel.resetUsageCount(apiKey);

            if (!resetKey) {
                return res.status(404).json({
                    error: 'Not found',
                    message: 'API key not found'
                });
            }

            res.json({
                success: true,
                message: 'Usage count reset successfully',
                data: {
                    apiKey: resetKey.api_key,
                    usageCount: resetKey.usage_count,
                    usageLimit: resetKey.usage_limit,
                    updatedAt: resetKey.updated_at
                }
            });

        } catch (error) {
            console.error('Error resetting usage:', error);
            res.status(500).json({
                error: 'Internal server error',
                message: 'Failed to reset usage count'
            });
        }
    }

    // Get available plans
    async getPlans(req, res) {
        try {
            const plans = {
                free: {
                    name: 'Free',
                    usageLimit: 100,
                    rateLimit: 5,
                    price: 0,
                    duration: '30 days',
                    features: [
                        '100 API calls per month',
                        '5 requests per minute',
                        'Basic support',
                        'Community access'
                    ]
                },
                trial: {
                    name: 'Free Trial',
                    usageLimit: 50,
                    rateLimit: 10,
                    price: 1,
                    duration: '30 days',
                    features: [
                        '50 leads/month',
                        'AI-powered lead scraping',
                        'Basic AI auto replies',
                        'Smart lead management dashboard'
                    ]
                },
                basic: {
                    name: 'Starter',
                    usageLimit: 2000,
                    rateLimit: 20,
                    price: 2999,
                    duration: 'monthly',
                    features: [
                        '2,000 leads/month',
                        'AI-powered lead scraping',
                        'AI-generated outreach messages',
                        'WhatsApp bulk campaigns',
                        'Email bulk campaigns',
                        'Basic AI auto replies'
                    ]
                },
                pro: {
                    name: 'Growth',
                    usageLimit: 10000,
                    rateLimit: 50,
                    price: 7999,
                    duration: 'monthly',
                    features: [
                        'Everything in Starter',
                        '10,000 leads/month',
                        'Advanced AI personalization',
                        'AI-powered WhatsApp automation',
                        'Smart auto follow-ups',
                        'AI auto replies on WhatsApp',
                        'AI email sequences'
                    ]
                },
                enterprise: {
                    name: 'Pro',
                    usageLimit: 50000,
                    rateLimit: 100,
                    price: 19999,
                    duration: 'monthly',
                    features: [
                        'Everything in Growth',
                        '50,000 leads/month',
                        'Unlimited AI campaigns',
                        'Advanced AI conversation engine',
                        'Human-like AI replies',
                        'AI-powered lead nurturing',
                        'WhatsApp drip campaigns',
                        'Automation workflows'
                    ]
                }
            };

            res.json({
                success: true,
                data: { plans }
            });

        } catch (error) {
            console.error('Error getting plans:', error);
            res.status(500).json({
                error: 'Internal server error',
                message: 'Failed to retrieve plans'
            });
        }
    }

    // Admin: list all API keys
    async adminListAllKeys(req, res) {
        try {
            const rows = await this.apiKeyModel.getAllApiKeys();

            const keys = rows.map(r => ({
                id: r.id,
                apiKey: r.api_key,
                userEmail: r.user_email,
                planType: r.plan_type,
                usage: {
                    current: r.usage_count,
                    limit: r.usage_limit,
                    remaining: r.usage_limit - r.usage_count,
                    percentage: r.usage_limit > 0 ? Math.round((r.usage_count / r.usage_limit) * 10000) / 100 : 0
                },
                rateLimit: r.rate_limit_per_minute,
                automationLimit: r.automation_limit,
                autoReplyLimit: r.auto_reply_limit,
                whatsappCampaignLimit: r.whatsapp_campaign_limit,
                emailCampaignLimit: r.email_campaign_limit,
                whatsappSendLimit: r.whatsapp_send_limit,
                emailSendLimit: r.email_send_limit,
                isActive: r.is_active,
                expiresAt: r.expires_at,
                createdAt: r.created_at,
                updatedAt: r.updated_at,
                lastUsedAt: r.last_used_at
            }));

            res.json({
                success: true,
                data: {
                    count: keys.length,
                    keys
                }
            });
        } catch (error) {
            console.error('Error listing all API keys:', error);
            res.status(500).json({
                error: 'Internal server error',
                message: 'Failed to list API keys'
            });
        }
    }

    // Admin: summary by user
    async adminListUsersSummary(req, res) {
        try {
            const rows = await this.apiKeyModel.getUsersSummary();
            const users = rows.map(r => ({
                userEmail: r.user_email,
                totalKeys: Number(r.total_keys),
                activeKeys: Number(r.active_keys),
                totalUsage: Number(r.total_usage),
                totalLimit: Number(r.total_limit),
                maxRateLimit: Number(r.max_rate_limit),
                nearestExpiry: r.nearest_expiry,
                lastActivity: r.last_activity,
                firstKeyCreated: r.first_key_created,
                lastKeyCreated: r.last_key_created
            }));

            res.json({
                success: true,
                data: {
                    count: users.length,
                    users
                }
            });
        } catch (error) {
            console.error('Error listing users summary:', error);
            res.status(500).json({
                error: 'Internal server error',
                message: 'Failed to list users summary'
            });
        }
    }

    // Update API key limits
    async updateLimits(req, res) {
        try {
            const { apiKey } = req.params;
            const { 
                usageLimit, 
                rateLimit,
                automationLimit,
                autoReplyLimit,
                whatsappCampaignLimit,
                emailCampaignLimit,
                whatsappSendLimit,
                emailSendLimit,
                isActive
            } = req.body;

            if (!apiKey) {
                return res.status(400).json({
                    error: 'Validation failed',
                    message: 'API key is required'
                });
            }

            const updatedKey = await this.apiKeyModel.updateLimits(apiKey, {
                usageLimit,
                rateLimit,
                automationLimit,
                autoReplyLimit,
                whatsappCampaignLimit,
                emailCampaignLimit,
                whatsappSendLimit,
                emailSendLimit,
                isActive
            });

            if (!updatedKey) {
                return res.status(404).json({
                    error: 'Not found',
                    message: 'API key not found'
                });
            }

            res.json({
                success: true,
                message: 'API key limits updated successfully',
                data: {
                    apiKey: updatedKey.api_key,
                    planType: updatedKey.plan_type,
                    usageLimit: updatedKey.usage_limit,
                    rateLimit: updatedKey.rate_limit_per_minute,
                    automationLimit: updatedKey.automation_limit,
                    autoReplyLimit: updatedKey.auto_reply_limit,
                    whatsappCampaignLimit: updatedKey.whatsapp_campaign_limit,
                    emailCampaignLimit: updatedKey.email_campaign_limit,
                    whatsappSendLimit: updatedKey.whatsapp_send_limit,
                    emailSendLimit: updatedKey.email_send_limit,
                    isActive: updatedKey.is_active,
                    updatedAt: updatedKey.updated_at
                }
            });

        } catch (error) {
            console.error('Error updating API key limits:', error);
            res.status(500).json({
                error: 'Internal server error',
                message: 'Failed to update API key limits'
            });
        }
    }
}

module.exports = ApiKeyController;
