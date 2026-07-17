-- Create automation_campaigns table
CREATE TABLE IF NOT EXISTS automation_campaigns (
  id SERIAL PRIMARY KEY,
  campaign_id VARCHAR(255) UNIQUE NOT NULL,
  user_id INTEGER NOT NULL,
  user_email VARCHAR(255) NOT NULL,
  campaign_type VARCHAR(50) NOT NULL, -- 'followups', 'pitches', 'coldDms', 'responses', 'promotionDemo'
  status VARCHAR(20) DEFAULT 'draft', -- 'draft', 'scheduled', 'running', 'completed', 'paused', 'failed'
  total_leads INTEGER DEFAULT 0,
  leads_sent INTEGER DEFAULT 0,
  leads_failed INTEGER DEFAULT 0,
  leads_pending INTEGER DEFAULT 0,
  created_at TIMESTAMP DEFAULT NOW(),
  started_at TIMESTAMP,
  completed_at TIMESTAMP,
  scheduled_for TIMESTAMP,
  config JSONB DEFAULT '{}'::jsonb, -- stores automation settings
  metadata JSONB DEFAULT '{}'::jsonb -- additional data
);

-- Create automation_executions table (logs of individual send attempts)
CREATE TABLE IF NOT EXISTS automation_executions (
  id SERIAL PRIMARY KEY,
  execution_id VARCHAR(255) UNIQUE NOT NULL,
  campaign_id VARCHAR(255) NOT NULL,
  lead_id INTEGER NOT NULL,
  user_email VARCHAR(255) NOT NULL,
  campaign_type VARCHAR(50) NOT NULL,
  contact_channel VARCHAR(50), -- 'email', 'whatsapp', 'sms', 'website', 'manual'
  lead_email VARCHAR(255),
  lead_phone VARCHAR(20),
  lead_name VARCHAR(255),
  business_name VARCHAR(255),
  message_template TEXT,
  message_sent TEXT,
  status VARCHAR(20) DEFAULT 'pending', -- 'pending', 'sent', 'failed', 'bounced', 'opened', 'clicked'
  sent_at TIMESTAMP,
  failed_at TIMESTAMP,
  error_message TEXT,
  provider_response JSONB, -- response from SendGrid, Twilio, etc.
  retries_count INTEGER DEFAULT 0,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  FOREIGN KEY (campaign_id) REFERENCES automation_campaigns(campaign_id) ON DELETE CASCADE
);

-- Create automation_schedules table (for recurring automation)
CREATE TABLE IF NOT EXISTS automation_schedules (
  id SERIAL PRIMARY KEY,
  schedule_id VARCHAR(255) UNIQUE NOT NULL,
  user_email VARCHAR(255) NOT NULL,
  campaign_type VARCHAR(50) NOT NULL,
  recurrence VARCHAR(50), -- 'once', 'daily', 'weekly', 'monthly'
  recurrence_day VARCHAR(20), -- day of week or date
  time_of_day VARCHAR(10), -- HH:MM format
  enabled BOOLEAN DEFAULT TRUE,
  leads_per_batch INTEGER DEFAULT 100,
  daily_limit INTEGER DEFAULT 500,
  last_run TIMESTAMP,
  next_run TIMESTAMP,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Create automation_templates table (custom message templates)
CREATE TABLE IF NOT EXISTS automation_templates (
  id SERIAL PRIMARY KEY,
  template_id VARCHAR(255) UNIQUE NOT NULL,
  user_email VARCHAR(255) NOT NULL,
  campaign_type VARCHAR(50) NOT NULL,
  name VARCHAR(255),
  subject TEXT, -- for emails
  message TEXT NOT NULL,
  placeholders JSONB, -- {{businessName}}, {{city}}, etc.
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Create indexes for better query performance
CREATE INDEX idx_automation_campaigns_user_email ON automation_campaigns(user_email);
CREATE INDEX idx_automation_campaigns_status ON automation_campaigns(status);
CREATE INDEX idx_automation_campaigns_created_at ON automation_campaigns(created_at DESC);

CREATE INDEX idx_automation_executions_campaign_id ON automation_executions(campaign_id);
CREATE INDEX idx_automation_executions_user_email ON automation_executions(user_email);
CREATE INDEX idx_automation_executions_status ON automation_executions(status);
CREATE INDEX idx_automation_executions_lead_id ON automation_executions(lead_id);
CREATE INDEX idx_automation_executions_created_at ON automation_executions(created_at DESC);

CREATE INDEX idx_automation_schedules_user_email ON automation_schedules(user_email);
CREATE INDEX idx_automation_schedules_next_run ON automation_schedules(next_run);

CREATE INDEX idx_automation_templates_user_email ON automation_templates(user_email);
