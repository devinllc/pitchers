# Production Deployment Guide

## Overview
This guide covers deploying the Business Scraper SaaS application with Razorpay integration in a production environment.

## Prerequisites

### 1. Environment Variables
Create a `.env` file with the following variables:

```bash
# Database
DATABASE_URL=postgresql://username:password@host:port/database

# Razorpay Configuration
RAZORPAY_KEY_ID=rzp_test_xxxxxxxxxxxxx
RAZORPAY_KEY_SECRET=xxxxxxxxxxxxxxxxxxxxxxxx
RAZORPAY_WEBHOOK_SECRET=webhook_secret_xxxxxxxx

# Application
NODE_ENV=production
PORT=3000
BASE_URL=https://your-domain.com
FRONTEND_URL=https://your-frontend-domain.com

# API Keys
GEMINI_API_KEY=your_gemini_api_key
GOOGLE_MAPS_API_KEY=your_google_maps_api_key
GOOGLE_SHEETS_SPREADSHEET_ID=your_sheets_id

# Security
JWT_SECRET=your_jwt_secret_key

# Email (Optional)
SENDGRID_API_KEY=your_sendgrid_api_key
FROM_EMAIL=noreply@your-domain.com

# Monitoring (Optional)
METRICS_PORT=9090
LOG_LEVEL=info
```

### 2. Razorpay Setup

1. **Create Razorpay Account**
   - Sign up at [razorpay.com](https://razorpay.com)
   - Complete KYC verification

2. **Get API Keys**
   - Go to Settings → API Keys
   - Generate new key pair
   - Copy Key ID and Key Secret

3. **Configure Webhooks**
   - Go to Settings → Webhooks
   - Add webhook URL: `https://your-domain.com/api/payments/webhook`
   - Select events: `payment.captured`, `payment.failed`, `order.paid`
   - Copy webhook secret

## Deployment Options

### Option 1: Docker Deployment

#### Dockerfile
```dockerfile
FROM node:18-alpine

WORKDIR /app

COPY package*.json ./
RUN npm ci --only=production

COPY . .

EXPOSE 3000

CMD ["npm", "start"]
```

#### Docker Compose
```yaml
version: '3.8'

services:
  app:
    build: .
    ports:
      - "3000:3000"
    environment:
      - NODE_ENV=production
      - DATABASE_URL=${DATABASE_URL}
      - RAZORPAY_KEY_ID=${RAZORPAY_KEY_ID}
      - RAZORPAY_KEY_SECRET=${RAZORPAY_KEY_SECRET}
      - RAZORPAY_WEBHOOK_SECRET=${RAZORPAY_WEBHOOK_SECRET}
    depends_on:
      - postgres
    restart: unless-stopped

  postgres:
    image: postgres:15
    environment:
      - POSTGRES_DB=business_scraper
      - POSTGRES_USER=postgres
      - POSTGRES_PASSWORD=password
    volumes:
      - postgres_data:/var/lib/postgresql/data
    ports:
      - "5432:5432"

  redis:
    image: redis:7-alpine
    ports:
      - "6379:6379"
    volumes:
      - redis_data:/data

volumes:
  postgres_data:
  redis_data:
```

#### Deployment Commands
```bash
# Build and start
docker-compose up -d

# View logs
docker-compose logs -f app

# Stop
docker-compose down
```

### Option 2: Cloud Deployment

#### AWS EC2 Deployment

1. **Launch EC2 Instance**
   ```bash
   # Connect to instance
   ssh -i your-key.pem ubuntu@your-instance-ip
   
   # Update system
   sudo apt update && sudo apt upgrade -y
   
   # Install Node.js
   curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
   sudo apt-get install -y nodejs
   
   # Install PostgreSQL
   sudo apt install postgresql postgresql-contrib -y
   
   # Install PM2
   sudo npm install -g pm2
   ```

2. **Setup Application**
   ```bash
   # Clone repository
   git clone https://github.com/your-repo/business-scraper.git
   cd business-scraper
   
   # Install dependencies
   npm install
   
   # Setup environment
   cp .env.example .env
   # Edit .env with your values
   
   # Start with PM2
   pm2 start server.js --name "business-scraper"
   pm2 startup
   pm2 save
   ```

#### Heroku Deployment

1. **Install Heroku CLI**
   ```bash
   # Install Heroku CLI
   curl https://cli-assets.heroku.com/install.sh | sh
   
   # Login
   heroku login
   ```

2. **Deploy Application**
   ```bash
   # Create Heroku app
   heroku create your-app-name
   
   # Add PostgreSQL
   heroku addons:create heroku-postgresql:hobby-dev
   
   # Set environment variables
   heroku config:set NODE_ENV=production
   heroku config:set RAZORPAY_KEY_ID=your_key_id
   heroku config:set RAZORPAY_KEY_SECRET=your_key_secret
   heroku config:set RAZORPAY_WEBHOOK_SECRET=your_webhook_secret
   
   # Deploy
   git push heroku main
   ```

#### DigitalOcean App Platform

1. **Create App**
   - Go to DigitalOcean App Platform
   - Connect your GitHub repository
   - Select Node.js environment

2. **Configure Environment**
   - Add environment variables
   - Set build command: `npm install`
   - Set run command: `npm start`

3. **Add Database**
   - Add PostgreSQL database
   - Link to your app

## Database Setup

### PostgreSQL Setup

1. **Create Database**
   ```sql
   CREATE DATABASE business_scraper;
   CREATE USER scraper_user WITH PASSWORD 'your_password';
   GRANT ALL PRIVILEGES ON DATABASE business_scraper TO scraper_user;
   ```

2. **Run Migrations**
   ```bash
   # The application will automatically create tables on startup
   npm start
   ```

### Database Backup

```bash
# Create backup
pg_dump -h localhost -U username -d business_scraper > backup.sql

# Restore backup
psql -h localhost -U username -d business_scraper < backup.sql
```

## SSL Configuration

### Using Let's Encrypt

```bash
# Install Certbot
sudo apt install certbot python3-certbot-nginx

# Get certificate
sudo certbot --nginx -d your-domain.com

# Auto-renewal
sudo crontab -e
# Add: 0 12 * * * /usr/bin/certbot renew --quiet
```

### Using Cloudflare

1. **Setup Cloudflare**
   - Add your domain to Cloudflare
   - Update nameservers
   - Enable SSL/TLS encryption mode: Full

2. **Configure DNS**
   - Add A record pointing to your server IP
   - Enable proxy (orange cloud)

## Monitoring & Logging

### PM2 Monitoring

```bash
# Monitor application
pm2 monit

# View logs
pm2 logs business-scraper

# Restart application
pm2 restart business-scraper
```

### Health Checks

```bash
# Health check endpoint
curl https://your-domain.com/health

# Expected response
{
  "status": "OK",
  "message": "Local Business Scraper API is running",
  "timestamp": "2025-08-30T13:23:46.375Z"
}
```

## Security Checklist

- [ ] Environment variables are set
- [ ] Database is secured with strong password
- [ ] SSL certificate is installed
- [ ] Firewall is configured
- [ ] Rate limiting is enabled
- [ ] CORS is properly configured
- [ ] API keys are rotated regularly
- [ ] Logs are monitored
- [ ] Backups are automated

## Testing Production Setup

### 1. Test Payment Flow

```bash
# Create payment order
curl -X POST https://your-domain.com/payments \
  -H "Content-Type: application/json" \
  -d '{
    "userEmail": "test@example.com",
    "planType": "basic",
    "amount": 999,
    "currency": "INR"
  }'

# Expected response
{
  "success": true,
  "message": "Payment order created successfully",
  "data": {
    "payment": {
      "id": "pay_1234567890",
      "orderId": "order_1234567890",
      "status": "pending"
    },
    "paymentLink": {
      "key": "rzp_test_xxxxxxxx",
      "amount": 99900,
      "currency": "INR",
      "order_id": "order_1234567890"
    }
  }
}
```

### 2. Test Webhook

```bash
# Simulate webhook (for testing)
curl -X POST https://your-domain.com/payments/mock-webhook \
  -H "Content-Type: application/json" \
  -d '{
    "paymentId": "pay_1234567890",
    "status": "captured",
    "metadata": {
      "razorpay_payment_id": "pay_xxxxxxxxxxxxx"
    }
  }'
```

### 3. Test API Endpoints

```bash
# Health check
curl https://your-domain.com/health

# Get payment statistics
curl https://your-domain.com/payments/statistics

# Get user payments
curl https://your-domain.com/payments/user/test@example.com
```

## Troubleshooting

### Common Issues

1. **Database Connection Failed**
   ```bash
   # Check database status
   sudo systemctl status postgresql
   
   # Check connection
   psql -h localhost -U username -d business_scraper
   ```

2. **Razorpay Webhook Not Working**
   ```bash
   # Check webhook logs
   tail -f logs/app.log | grep webhook
   
   # Verify webhook URL is accessible
   curl -X POST https://your-domain.com/api/payments/webhook
   ```

3. **Application Not Starting**
   ```bash
   # Check PM2 status
   pm2 status
   
   # View error logs
   pm2 logs business-scraper --err
   
   # Restart application
   pm2 restart business-scraper
   ```

### Performance Optimization

1. **Database Optimization**
   ```sql
   -- Create indexes for better performance
   CREATE INDEX idx_payments_user_email ON payments(user_email);
   CREATE INDEX idx_payments_status ON payments(status);
   CREATE INDEX idx_jobs_user_email ON jobs(user_email);
   ```

2. **Caching**
   ```bash
   # Install Redis
   sudo apt install redis-server
   
   # Start Redis
   sudo systemctl start redis
   ```

3. **Load Balancing**
   ```bash
   # Install Nginx
   sudo apt install nginx
   
   # Configure Nginx for load balancing
   # See nginx.conf example below
   ```

## Nginx Configuration

```nginx
upstream app_servers {
    server 127.0.0.1:3000;
    server 127.0.0.1:3001;
    server 127.0.0.1:3002;
}

server {
    listen 80;
    server_name your-domain.com;
    return 301 https://$server_name$request_uri;
}

server {
    listen 443 ssl http2;
    server_name your-domain.com;

    ssl_certificate /etc/letsencrypt/live/your-domain.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/your-domain.com/privkey.pem;

    location / {
        proxy_pass http://app_servers;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
    }

    location /api/payments/webhook {
        proxy_pass http://app_servers;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

## Maintenance

### Regular Tasks

1. **Database Maintenance**
   ```bash
   # Weekly database cleanup
   psql -d business_scraper -c "DELETE FROM payments WHERE created_at < NOW() - INTERVAL '1 year';"
   psql -d business_scraper -c "DELETE FROM jobs WHERE created_at < NOW() - INTERVAL '6 months';"
   ```

2. **Log Rotation**
   ```bash
   # Configure logrotate
   sudo nano /etc/logrotate.d/business-scraper
   
   /var/log/business-scraper/*.log {
       daily
       missingok
       rotate 52
       compress
       delaycompress
       notifempty
       create 644 www-data www-data
   }
   ```

3. **Security Updates**
   ```bash
   # Update system packages
   sudo apt update && sudo apt upgrade -y
   
   # Update Node.js dependencies
   npm audit fix
   ```

## Support

For production support:
- Email: support@your-domain.com
- Documentation: https://docs.your-domain.com
- Status page: https://status.your-domain.com
