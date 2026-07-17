## AWS EC2 Deployment Guide (Node.js + Puppeteer + PM2 + Nginx)

This guide shows how to deploy this app on AWS EC2 (Ubuntu 22.04), including Puppeteer dependencies, PM2 process manager, Nginx reverse proxy, and HTTPS via Certbot.

### 1) Launch an EC2 instance
- **AMI**: Ubuntu Server 22.04 LTS (Jammy)
- **Instance type**: t3.small or t3.medium (2 vCPU, 2–4 GB RAM)
- **Storage**: 20–40 GB gp3
- **Security Group**:
  - 22/tcp (SSH) from your IP
  - 80/tcp (HTTP) from 0.0.0.0/0
  - 443/tcp (HTTPS) from 0.0.0.0/0

### 2) Connect and update base packages
```bash
ssh -i YOUR_KEY.pem ubuntu@EC2_PUBLIC_IP
sudo apt update && sudo apt upgrade -y
sudo apt install -y nginx git curl build-essential unzip apt-transport-https ca-certificates
```

### 3) Install Node.js (LTS) and PM2
```bash
curl -fsSL https://deb.nodesource.com/setup_lts.x | sudo -E bash -
sudo apt install -y nodejs
sudo npm i -g pm2
```

### 4) Install Puppeteer/Chrome runtime dependencies
Puppeteer requires system libraries even when it downloads Chromium. Install common dependencies:
```bash
sudo apt install -y \
  libatk-bridge2.0-0t64 libatk1.0-0t64 libatspi2.0-0t64 libgtk-3-0t64 libnss3 \
  libx11-xcb1 libxcomposite1 libxdamage1 libxfixes3 libxrandr2 libxshmfence1 \
  libxkbcommon0 libxkbfile1 libxcb1 libasound2t64 libgbm1 libpango-1.0-0 libcups2t64 \
  fonts-liberation libu2f-udev
```

Optional: set a cache dir for Chromium downloads to persist across deployments:
```bash
sudo mkdir -p /opt/puppeteer-cache
sudo chown ubuntu:ubuntu /opt/puppeteer-cache
echo 'export PUPPETEER_CACHE_DIR=/opt/puppeteer-cache' | tee -a ~/.profile
source ~/.profile
```

### 5) Clone the app and install dependencies
```bash
sudo mkdir -p /opt/pitchers
sudo chown ubuntu:ubuntu /opt/pitchers
cd /opt/pitchers
git clone YOUR_REPO_URL .
npm install
```

If Puppeteer needs to download Chromium, ensure outbound internet is allowed and wait for install to finish.

### 6) Configure environment variables
Create an `.env` from the included example and fill production secrets:
```bash
cp production.env.example .env
nano .env
```

Common values:
- NODE_ENV=production
- PORT=3000
- Database connection (PostgreSQL)
- Google credentials / Sheets config

### 7) Start with PM2 and enable startup
```bash
pm2 start server.js --name pitchers --time
pm2 save
pm2 startup systemd -u ubuntu --hp /home/ubuntu
# Run the command PM2 prints to finalize startup integration
```

To view logs:
```bash
pm2 logs pitchers
```

### 8) Configure Nginx reverse proxy
```bash
sudo tee /etc/nginx/sites-available/pitchers > /dev/null <<'CONF'
server {
  listen 80;
  server_name YOUR_DOMAIN_OR_IP;

  location / {
    proxy_pass http://127.0.0.1:3000;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_set_header Host $host;
    proxy_cache_bypass $http_upgrade;
  }
}
CONF

sudo ln -s /etc/nginx/sites-available/pitchers /etc/nginx/sites-enabled/pitchers
sudo nginx -t && sudo systemctl reload nginx
```

### 9) HTTPS with Certbot (Let’s Encrypt)
```bash
sudo snap install core; sudo snap refresh core
sudo snap install --classic certbot
sudo ln -s /snap/bin/certbot /usr/bin/certbot
sudo certbot --nginx -d YOUR_DOMAIN
```

Auto-renew is handled by snapd timers. Test with:
```bash
sudo certbot renew --dry-run
```

### 10) Optional: Swap (for small instances)
```bash
sudo fallocate -l 2G /swapfile
sudo chmod 600 /swapfile
sudo mkswap /swapfile
sudo swapon /swapfile
echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
```

### 11) Deploy updates
```bash
cd /opt/pitchers
git pull
npm install
pm2 restart pitchers
```

### 12) Troubleshooting
- Puppeteer missing libs: ensure section (4) packages are installed.
- Chromium not found: allow Puppeteer to download; or set `PUPPETEER_CACHE_DIR`. The app also tries to discover Chrome from cache paths.
- 403 from target sites: some hosts block cloud IPs; retries or proxies may be needed.
- High memory or slow maps UI: use instances with 2 vCPU/2–4 GB RAM; consider adding swap.
- Logs:
  - `pm2 logs pitchers`
  - `sudo tail -f /var/log/nginx/error.log`

### 13) Hardening checklist
- Restrict SSH to your IP; disable password auth (key-only).
- Keep `NODE_ENV=production`.
- Regularly update: `sudo apt update && sudo apt upgrade -y`.
- Rotate keys/secrets, avoid committing secrets to Git.

---

That’s it. You should now have the application running behind Nginx with HTTPS, managed by PM2, and Puppeteer dependencies ready for production usage on EC2.

### 14) Logs and monitoring (quick reference)
```bash
# App (PM2)
pm2 status
pm2 logs pitchers
pm2 logs pitchers --lines 200

# Nginx
sudo tail -f /var/log/nginx/access.log /var/log/nginx/error.log

# PM2 systemd service and Nginx services
journalctl -u pm2-ubuntu -f
journalctl -u nginx -f

# Certbot (SSL)
sudo tail -n 200 /var/log/letsencrypt/letsencrypt.log
```

### 15) Custom domain and SSL (summary)
1. Point DNS A record to your EC2 public IP:
   - Name: `your.domain.com`
   - Type: `A`
   - Value: `<EC2_PUBLIC_IP>`
   - TTL: `300`

2. Update Nginx `server_name` and reload:
```bash
sudo sed -i 's/YOUR_DOMAIN_OR_IP/your.domain.com/' /etc/nginx/sites-available/pitchers
sudo nginx -t && sudo systemctl reload nginx
```

3. Ensure Security Group allows ports 80/443 from the internet.

4. Issue SSL certificate and auto-configure Nginx:
```bash
sudo certbot --nginx -d your.domain.com
sudo certbot renew --dry-run
```

5. Quick health checks:
```bash
curl -I http://127.0.0.1:3000    # app listening locally
curl -I http://your.domain.com   # HTTP via Nginx
curl -I https://your.domain.com  # HTTPS via Nginx+Certbot
```


