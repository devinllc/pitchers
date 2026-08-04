#!/bin/bash
# deploy.sh — Full deploy script for pitchers-app
# Run: bash /var/www/pitchers/deploy.sh on server
set -e
cd /var/www/pitchers
echo "📥 Pulling latest code..."
git pull origin main
echo "🏗️  Building Docker image..."
docker build --no-cache -t pitchers-app .
echo "🛑 Stopping old container..."
docker stop pitchers-app 2>/dev/null || true
docker rm pitchers-app 2>/dev/null || true
mkdir -p /var/www/pitchers/.whatsapp_sessions /var/www/pitchers/.social_sessions
echo "▶️  Starting container with persistent volumes..."
docker run -d -p 3001:3000 \
  -v /var/www/pitchers/.whatsapp_sessions:/app/.whatsapp_sessions \
  -v /var/www/pitchers/.social_sessions:/app/.social_sessions \
  --name pitchers-app pitchers-app
echo "✅ Done!"
docker logs --tail 20 pitchers-app
