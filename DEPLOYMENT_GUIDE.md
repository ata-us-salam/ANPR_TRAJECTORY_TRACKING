# Complete Production Deployment Guide
## City-Wide ANPR Trajectory Tracking & GIS Surveillance System

This guide provides exhaustive, production-grade instructions for deploying the **City-Wide ANPR Trajectory Tracking** platform to staging, bare-metal servers, cloud virtual machines (AWS EC2, GCP Compute Engine, DigitalOcean, Hetzner), or municipal control room on-premise infrastructure.

---

## 1. System Architecture & Minimum Specifications

```
                       ┌───────────────────────────────┐
                       │     Browser / SOC Clients     │
                       └───────────────┬───────────────┘
                                       │ HTTPS / WSS
                                       ▼
                       ┌───────────────────────────────┐
                       │   Nginx Reverse Proxy & SSL   │
                       │   - Port 80 (Redirect to 443) │
                       │   - Port 443 (TLS Termination)│
                       │   - Gzip Compression / Caching │
                       └───────┬───────────────┬───────┘
                               │               │
                     HTTP API  │               │ WebSocket (/ws/)
                               ▼               ▼
                       ┌───────────────────────────────┐
                       │    Gunicorn + Uvicorn Workers │
                       │    (FastAPI Async Core)       │
                       │    - Multi-worker Process Pool│
                       │    - AI Inference Engine      │
                       └───────────────┬───────────────┘
                                       │
                                       ▼
                       ┌───────────────────────────────┐
                       │     PostgreSQL + PostGIS      │
                       │     (Spatial Data Store)      │
                       └───────────────────────────────┘
```

### Minimum Server Specifications

| Component | Minimum (Evaluation / Pilot) | Recommended (City-Scale Production) |
| :--- | :--- | :--- |
| **CPU** | 4 Cores (x86_64) | 8–16 Cores |
| **RAM** | 8 GB RAM | 16–32 GB RAM |
| **Storage** | 40 GB SSD (NVMe preferred) | 250+ GB NVMe SSD |
| **GPU** | Optional (CPU fallback included) | NVIDIA T4, RTX 3060/4090, or A10G (8GB+ VRAM) |
| **OS** | Ubuntu 22.04 / 24.04 LTS | Ubuntu 22.04 LTS / Debian 12 |

---

## 2. Deployment Method A: Docker & Docker Compose (Recommended)

Docker deployment is the fastest, most reliable, and isolated method for deploying the application.

### Step 1: Install Docker & Docker Compose on the Server

```bash
# Update system packages
sudo apt-get update && sudo apt-get upgrade -y

# Install Docker prerequisites
sudo apt-get install -y ca-certificates curl gnupg lsb-release

# Add Docker's official GPG key
sudo mkdir -p /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg | sudo gpg --dearmor -o /etc/apt/keyrings/docker.gpg

# Set up repository
echo \
  "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu \
  $(lsb_release -cs) stable" | sudo tee /etc/apt/sources.list.d/docker.list > /dev/null

# Install Docker Engine and Docker Compose plugin
sudo apt-get update
sudo apt-get install -y docker-ce docker-ce-cli containerd.io docker-compose-plugin

# Verify installation
docker --version
docker compose version
```

### Step 2: Clone the Repository & Configure Environment

```bash
# Clone the repository
git clone https://github.com/prathmeshnanda2007-sudo/ANPR_TRAJECTORY_TRACKING.git /opt/anpr
cd /opt/anpr

# Create your production environment file
cp .env.example .env
```

Edit `.env` using your favorite text editor (`nano .env` or `vim .env`):
```ini
# Production Secret Key
SECRET_KEY=9f82b7c4a1e34589d87e0a234f9a12c8b7654321

# Database Configuration
POSTGRES_DB=anpr_db
POSTGRES_USER=anpr_admin
POSTGRES_PASSWORD=UseAStrongGeneratedPasswordHere!123

# Application Database Connection URL
DATABASE_URL=postgresql://anpr_admin:UseAStrongGeneratedPasswordHere!123@db:5432/anpr_db

# Allowed Web Domains
CORS_ORIGINS=https://surveillance.yourcity.gov.in,https://yourdomain.com

# Upload limits
MAX_VIDEO_UPLOAD_MB=100
MAX_IMAGE_UPLOAD_MB=15
```

### Step 3: Launch with Docker Compose

```bash
# Build images and start all containers in background
docker compose up -d --build

# Verify container statuses
docker compose ps
```

Expected output:
```
NAME           IMAGE                      COMMAND                  SERVICE   STATUS              PORTS
anpr_backend   anpr_trajectory-web        "gunicorn backend.ma…"   web       running (healthy)   8000/tcp
anpr_db        postgis/postgis:15-3.3     "docker-entrypoint.s…"   db        running (healthy)   5432/tcp
anpr_proxy     nginx:alpine               "/docker-entrypoint.…"   nginx     running             0.0.0.0:80->80/tcp, 0.0.0.0:443->443/tcp
```

### Step 4: Verify Backend Health

```bash
curl -i http://localhost/api/health
```

Output:
```json
HTTP/1.1 200 OK
Content-Type: application/json

{"status":"healthy","service":"ANPR Trajectory Tracking API","version":"2.0.0"}
```

---

## 3. Deployment Method B: Bare-Metal / Ubuntu Linux VPS (Without Docker)

If you prefer running directly on bare-metal hardware or an existing Linux server using systemd:

### Step 1: Install System Dependencies & Python 3.11

```bash
sudo apt-get update
sudo apt-get install -y \
    python3.11 \
    python3.11-venv \
    python3.11-dev \
    python3-pip \
    build-essential \
    ffmpeg \
    libgl1 \
    libglib2.0-0 \
    libgomp1 \
    libpq-dev \
    git \
    nginx \
    curl
```

### Step 2: Install and Configure PostgreSQL with PostGIS

```bash
# Install PostgreSQL and PostGIS extension
sudo apt-get install -y postgresql postgresql-contrib postgis postgresql-15-postgis-3

# Switch to postgres user and set up database
sudo -u postgres psql
```

Inside the PostgreSQL shell:
```sql
CREATE USER anpr_user WITH PASSWORD 'StrongSecurePasswordHere!123';
CREATE DATABASE anpr_db OWNER anpr_user;
\c anpr_db
CREATE EXTENSION IF NOT EXISTS postgis;
GRANT ALL PRIVILEGES ON DATABASE anpr_db TO anpr_user;
\q
```

### Step 3: Clone Codebase & Setup Virtual Environment

```bash
# Clone to /opt/anpr
sudo git clone https://github.com/prathmeshnanda2007-sudo/ANPR_TRAJECTORY_TRACKING.git /opt/anpr
sudo chown -R $USER:$USER /opt/anpr
cd /opt/anpr

# Create and activate virtual environment
python3.11 -m venv venv
source venv/bin/activate

# Install Python packages
pip install --upgrade pip
pip install -r requirements.txt
```

### Step 4: Configure Production Environment Variables

```bash
cp .env.example .env
nano .env
```
Ensure `DATABASE_URL` is set to:
```ini
DATABASE_URL=postgresql://anpr_user:StrongSecurePasswordHere!123@localhost:5432/anpr_db
```

### Step 5: Create a Systemd Service

Create `/etc/systemd/system/anpr.service`:
```bash
sudo nano /etc/systemd/system/anpr.service
```

Paste the following service definition:
```ini
[Unit]
Description=City-Wide ANPR Trajectory Tracking & GIS Surveillance Service
After=network.target postgresql.service

[Service]
User=www-data
Group=www-data
WorkingDirectory=/opt/anpr
EnvironmentFile=/opt/anpr/.env
ExecStart=/opt/anpr/venv/bin/gunicorn backend.main:app \
    --workers 4 \
    --worker-class uvicorn.workers.UvicornWorker \
    --bind 127.0.0.1:8000 \
    --timeout 120 \
    --keep-alive 5 \
    --access-logfile /var/log/anpr_access.log \
    --error-logfile /var/log/anpr_error.log
Restart=always
RestartSec=5s

[Install]
WantedBy=multi-user.target
```

Enable and start the service:
```bash
# Fix directory permissions for www-data user
sudo chown -R www-data:www-data /opt/anpr

# Reload systemd and start service
sudo systemctl daemon-reload
sudo systemctl enable anpr.service
sudo systemctl start anpr.service

# Check service status
sudo systemctl status anpr.service
```

### Step 6: Configure Nginx Reverse Proxy

Create `/etc/nginx/sites-available/anpr`:
```bash
sudo nano /etc/nginx/sites-available/anpr
```

Paste the configuration:
```nginx
server {
    listen 80;
    server_name yourdomain.com www.yourdomain.com;

    client_max_body_size 100M;

    # Static Assets Caching
    location /static/ {
        alias /opt/anpr/frontend/;
        expires 7d;
        add_header Cache-Control "public, no-transform";
    }

    # WebSocket Proxy for Real-Time Telemetry
    location /ws/ {
        proxy_pass http://127.0.0.1:8000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_read_timeout 86400s;
        proxy_send_timeout 86400s;
    }

    # API & Frontend Application
    location / {
        proxy_pass http://127.0.0.1:8000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

Enable the site:
```bash
sudo ln -s /etc/nginx/sites-available/anpr /etc/nginx/sites-enabled/
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t
sudo systemctl reload nginx
```

---

## 4. Setting Up Free SSL/TLS (HTTPS) with Let's Encrypt (Certbot)

To secure the surveillance stream with valid HTTPS and WSS (secure WebSockets):

```bash
# Install Certbot and the Nginx plugin
sudo apt-get install -y certbot python3-certbot-nginx

# Obtain and automatically configure SSL certificates
sudo certbot --nginx -d yourdomain.com -d www.yourdomain.com

# Verify automatic renewal timer
sudo systemctl status certbot.timer
```

Certbot will automatically configure HTTPS redirect and renew your SSL certificates every 90 days.

---

## 5. Enabling GPU Acceleration (NVIDIA CUDA)

For high-throughput video inference across multiple video streams (e.g. 10+ concurrent 1080p feeds):

### Step 1: Install NVIDIA Driver & Container Toolkit

```bash
# Install NVIDIA drivers
sudo apt-get install -y nvidia-driver-535

# Install NVIDIA Container Toolkit for Docker
curl -fsSL https://nvidia.github.io/libnvidia-container/gpgkey | sudo gpg --dearmor -o /usr/share/keyrings/nvidia-container-toolkit-keyring.gpg
curl -s -L https://nvidia.github.io/libnvidia-container/stable/deb/nvidia-container-toolkit.list | \
  sed 's#deb https://#deb [signed-by=/usr/share/keyrings/nvidia-container-toolkit-keyring.gpg] https://#g' | \
  sudo tee /etc/apt/sources.list.d/nvidia-container-toolkit.list
sudo apt-get update
sudo apt-get install -y nvidia-container-toolkit
sudo nvidia-ctk runtime configure --runtime=docker
sudo systemctl restart docker
```

### Step 2: Enable GPU in `docker-compose.yml`

Under the `web` service in `docker-compose.yml`, add the `deploy` stanza:
```yaml
  web:
    build: .
    deploy:
      resources:
        reservations:
          devices:
            - driver: nvidia
              count: all
              capabilities: [gpu]
```

---

## 6. Connecting Physical IP Cameras (RTSP Streams)

To link live hardware surveillance cameras (Hikvision, Dahua, CP Plus, Axis, Hanwha):

1. **Standard RTSP URL formats**:
   - **Hikvision**: `rtsp://admin:password@192.168.1.100:554/Streaming/Channels/101`
   - **Dahua / CP Plus**: `rtsp://admin:password@192.168.1.100:554/cam/realmonitor?channel=1&subtype=0`
   - **Axis**: `rtsp://admin:password@192.168.1.100/axis-media/media.amp`
2. **Camera Ingestion Worker**:
   Run the background inference worker pointing to the RTSP feed:
   ```bash
   python pipeline/inference.py --source "rtsp://admin:pass@192.168.1.100:554/live" --camera-id 1
   ```
   Detections are automatically timestamped, cross-checked with Indian vehicle registration databases, and broadcast via WebSockets to control room monitors.

---

## 7. Automated Maintenance & Nightly Database Backups

Create a backup script `/usr/local/bin/backup_anpr.sh`:
```bash
#!/bin/bash
BACKUP_DIR="/var/backups/anpr"
DATE=$(date +%Y%m%d_%H%M%S)
mkdir -p "$BACKUP_DIR"

# Dump PostgreSQL database
docker exec anpr_db pg_dump -U anpr_user anpr_db | gzip > "$BACKUP_DIR/anpr_db_$DATE.sql.gz"

# Retain backups for 14 days and prune older
find "$BACKUP_DIR" -type f -name "anpr_db_*.sql.gz" -mtime +14 -delete
```

Make it executable and add to crontab:
```bash
sudo chmod +x /usr/local/bin/backup_anpr.sh
# Run nightly at 02:00 AM
echo "0 2 * * * root /usr/local/bin/backup_anpr.sh" | sudo tee -a /etc/crontab
```

---

## 8. Summary of Essential Commands

| Action | Command |
| :--- | :--- |
| **Start Services** | `docker compose up -d` |
| **Stop Services** | `docker compose down` |
| **Restart Backend** | `docker compose restart web` |
| **View Live Logs** | `docker compose logs -f web` |
| **Check System Health** | `curl http://localhost/api/health` |
| **Check Database Status** | `docker exec -it anpr_db pg_isready -U anpr_user` |
| **PostgreSQL Shell Access** | `docker exec -it anpr_db psql -U anpr_user -d anpr_db` |
