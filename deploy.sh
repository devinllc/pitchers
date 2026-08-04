#!/bin/bash
# =============================================================
# deploy.sh — Smart deploy for pitchers-app
# 
# For CODE changes only (no new npm packages):
#   bash deploy.sh
#   → git pull + docker restart (3 seconds!)
#
# For DEPENDENCY changes (new npm packages added):
#   bash deploy.sh --rebuild
#   → git pull + docker build + docker restart (~4 min)
# =============================================================

set -e
cd /var/www/pitchers

echo "📥 Pulling latest code..."
git pull origin main

if [[ "$1" == "--rebuild" ]]; then
  echo "🏗️  Rebuilding Docker image (npm packages changed)..."
  docker build --no-cache -t pitchers-app .
  docker stop pitchers-app 2>/dev/null || true
  docker rm pitchers-app 2>/dev/null || true
  mkdir -p /var/www/pitchers/.whatsapp_sessions /var/www/pitchers/.social_sessions
  echo "▶️  Starting container..."
  docker run -d -p 3001:3000 \
    -v /var/www/pitchers:/app \
    -v /app/node_modules \
    -v /var/www/pitchers/.whatsapp_sessions:/app/.whatsapp_sessions \
    -v /var/www/pitchers/.social_sessions:/app/.social_sessions \
    --name pitchers-app pitchers-app
  echo "✅ Full rebuild complete!"
else
  echo "♻️  Restarting container (code-only change)..."
  docker restart pitchers-app
  echo "✅ Restarted in seconds!"
fi

sleep 3
docker logs --tail 20 pitchers-app
