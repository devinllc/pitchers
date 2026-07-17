-- Migration: Add social media support to automation system
-- Adds columns for social media handles and improves communication tracking

-- Add social media handles to automation_executions
ALTER TABLE automation_executions 
ADD COLUMN IF NOT EXISTS platform VARCHAR(50), -- 'email', 'sms', 'whatsapp', 'facebook', 'instagram', 'linkedin', 'twitter'
ADD COLUMN IF NOT EXISTS social_handle VARCHAR(255), -- username, ID, or handle on platform
ADD COLUMN IF NOT EXISTS provider_message_id VARCHAR(255), -- external message ID from platform
ADD COLUMN IF NOT EXISTS delivery_confirmed BOOLEAN DEFAULT FALSE,
ADD COLUMN IF NOT EXISTS opened_at TIMESTAMP,
ADD COLUMN IF NOT EXISTS clicked_at TIMESTAMP,
ADD COLUMN IF NOT EXISTS replied_at TIMESTAMP,
ADD COLUMN IF NOT EXISTS engagement_metrics JSONB DEFAULT '{}'::jsonb; -- stores platform-specific metrics

-- Add platform-specific tracking table
CREATE TABLE IF NOT EXISTS social_media_communications (
  id SERIAL PRIMARY KEY,
  communication_id VARCHAR(255) UNIQUE NOT NULL,
  user_email VARCHAR(255) NOT NULL,
  platform VARCHAR(50) NOT NULL, -- facebook, instagram, linkedin, twitter
  recipient_handle VARCHAR(255) NOT NULL,
  recipient_id VARCHAR(255), -- Platform-specific ID
  message TEXT NOT NULL,
  status VARCHAR(20) DEFAULT 'pending', -- pending, sent, delivered, failed, opened, replied
  campaign_type VARCHAR(50),
  campaign_id VARCHAR(255),
  sent_at TIMESTAMP,
  delivered_at TIMESTAMP,
  opened_at TIMESTAMP,
  replied_at TIMESTAMP,
  failed_at TIMESTAMP,
  error_message TEXT,
  provider_response JSONB DEFAULT '{}'::jsonb,
  rate_limit_hit BOOLEAN DEFAULT FALSE,
  retries_count INTEGER DEFAULT 0,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  FOREIGN KEY (user_email) REFERENCES users(email) ON DELETE CASCADE
);

-- Create view for aggregated communication metrics
CREATE OR REPLACE VIEW communication_metrics AS
SELECT 
  user_email,
  campaign_type,
  COUNT(*) as total_messages,
  SUM(CASE WHEN status = 'sent' THEN 1 ELSE 0 END) as messages_sent,
  SUM(CASE WHEN status = 'delivered' THEN 1 ELSE 0 END) as messages_delivered,
  SUM(CASE WHEN status = 'opened' THEN 1 ELSE 0 END) as messages_opened,
  SUM(CASE WHEN status = 'replied' THEN 1 ELSE 0 END) as messages_replied,
  SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) as messages_failed,
  ROUND(
    (SUM(CASE WHEN status IN ('delivered', 'opened', 'replied') THEN 1 ELSE 0 END)::numeric / 
     NULLIF(COUNT(*), 0) * 100), 2
  ) as success_rate,
  MAX(updated_at) as last_updated
FROM social_media_communications
GROUP BY user_email, campaign_type;

-- Create indexes for better query performance
CREATE INDEX IF NOT EXISTS idx_social_communications_user_email ON social_media_communications(user_email);
CREATE INDEX IF NOT EXISTS idx_social_communications_platform ON social_media_communications(platform);
CREATE INDEX IF NOT EXISTS idx_social_communications_status ON social_media_communications(status);
CREATE INDEX IF NOT EXISTS idx_social_communications_created_at ON social_media_communications(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_social_communications_campaign_id ON social_media_communications(campaign_id);
CREATE INDEX IF NOT EXISTS idx_automation_executions_platform ON automation_executions(platform);
CREATE INDEX IF NOT EXISTS idx_automation_executions_social_handle ON automation_executions(social_handle);

-- Add view for communication summary by platform
CREATE OR REPLACE VIEW platform_communication_summary AS
SELECT 
  platform,
  COUNT(*) as total_messages,
  SUM(CASE WHEN status IN ('sent', 'delivered', 'opened') THEN 1 ELSE 0 END) as successful_sends,
  SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) as failed_sends,
  SUM(CASE WHEN status = 'replied' THEN 1 ELSE 0 END) as replies,
  ROUND(
    (SUM(CASE WHEN status IN ('sent', 'delivered', 'opened') THEN 1 ELSE 0 END)::numeric / 
     NULLIF(COUNT(*), 0) * 100), 2
  ) as platform_success_rate
FROM social_media_communications
GROUP BY platform;
