-- Migration: Add social media AI PR Agent and Auto-Posting Tables
-- Creates tables to persist AI Agent settings, niche targets, and posting history.

-- Create social_media_agents table
CREATE TABLE IF NOT EXISTS social_media_agents (
  id SERIAL PRIMARY KEY,
  user_email VARCHAR(255) NOT NULL,
  platform VARCHAR(50) NOT NULL, -- 'instagram' | 'linkedin'
  niche TEXT NOT NULL,
  tone VARCHAR(100) DEFAULT 'professional',
  schedule_time VARCHAR(10) DEFAULT '09:00',
  enabled BOOLEAN DEFAULT FALSE,
  marketing_enabled BOOLEAN DEFAULT FALSE,
  last_posted_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(user_email, platform),
  FOREIGN KEY (user_email) REFERENCES users(email) ON DELETE CASCADE
);

-- Create social_media_posts table
CREATE TABLE IF NOT EXISTS social_media_posts (
  id SERIAL PRIMARY KEY,
  user_email VARCHAR(255) NOT NULL,
  platform VARCHAR(50) NOT NULL,
  post_text TEXT NOT NULL,
  image_url TEXT,
  status VARCHAR(50) DEFAULT 'scheduled', -- 'scheduled', 'publishing', 'published', 'failed'
  error_message TEXT,
  published_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  FOREIGN KEY (user_email) REFERENCES users(email) ON DELETE CASCADE
);

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_social_media_agents_user_email ON social_media_agents(user_email);
CREATE INDEX IF NOT EXISTS idx_social_media_agents_enabled ON social_media_agents(enabled);
CREATE INDEX IF NOT EXISTS idx_social_media_posts_user_email ON social_media_posts(user_email);
CREATE INDEX IF NOT EXISTS idx_social_media_posts_status ON social_media_posts(status);
CREATE INDEX IF NOT EXISTS idx_social_media_posts_published_at ON social_media_posts(published_at DESC);
