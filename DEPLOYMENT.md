# Translan Data — Deployment Guide (V1)

**App Server:** `173.212.220.11`  
**GitHub:** `https://github.com/MoctarSidibe/translan_data`  
**Project root:** `/var/www/translan_data/`  
**Jenkins (local):** `http://173.212.220.11:8080`

---

## Current Status

```
✅ 1.  Server dependencies installed      (python3.12, postgresql, nginx, git)
✅ 2.  PostgreSQL setup                   (translan_db, translan_user, vector extension)
✅ 3.  Repo cloned                        (/var/www/translan_data/)
✅ 4.  Python venv + dependencies         (venv/bin/python3.12)
✅ 5.  .env file created                  (DATABASE_URL, SECRET_KEY set)
✅ 6.  Database tables initialized        (create_tables ran clean)
✅ 7.  Systemd service running            (translan_data.service — port 8100)
✅ 8.  Nginx configured                   (/translan_data/ → :8100)
✅ 9.  API live and healthy               (http://173.212.220.11/translan_data/health → 200)
✅ 10. Production URL set in mobile app   (mobile/services/api.ts)

⏳ 11. Install Jenkins on 173.212.220.11  ← YOU ARE HERE
⏳ 12. Configure Jenkins pipeline
⏳ 13. APK build
```

---

## Architecture

```
173.212.220.11
├── Nginx :80
│   ├── /translan_data/  → uvicorn :8100  (FastAPI — LIVE ✅)
│   └── /jenkins/        → Jenkins  :8080  (CI/CD — to install)
│
├── translan_data.service  (systemd, auto-restart)
├── PostgreSQL             (translan_db)
└── Jenkins                (builds APK + auto-deploys on git push)
```

Multi-app port map — no conflicts:

| App           | Service port | Nginx prefix      |
|---------------|-------------|-------------------|
| translan_data | 8100        | `/translan_data/` |
| Jenkins       | 8080        | `/jenkins/`       |
| (next app)    | 8101        | `/…/`             |

---

## ✅ 1. Server Setup (done)

```bash
ssh root@173.212.220.11
apt update && apt upgrade -y
apt install -y python3 python3-venv python3-pip \
               postgresql postgresql-contrib \
               nginx git curl build-essential libpq-dev
```

> Server has **Python 3.12** — no extra PPA needed.

---

## ✅ 2. PostgreSQL (done)

```bash
su - postgres   # switch to postgres user
psql -c "CREATE USER translan_user WITH PASSWORD 'YOUR_PASSWORD';" \
     -c "CREATE DATABASE translan_db OWNER translan_user;" \
     -c "GRANT ALL PRIVILEGES ON DATABASE translan_db TO translan_user;"
psql -d translan_db -c "CREATE EXTENSION IF NOT EXISTS vector;"
exit
```

---

## ✅ 3. Backend Deployment (done)

```bash
cd /var/www/translan_data
git clone https://github.com/MoctarSidibe/translan_data.git .

cd backend
python3 -m venv venv
source venv/bin/activate
pip install --upgrade pip
pip install -r requirements.txt
```

### .env file
```bash
cat > /var/www/translan_data/backend/.env << 'EOF'
DATABASE_URL=postgresql+asyncpg://translan_user:YOUR_PASSWORD@localhost:5432/translan_db
SECRET_KEY=YOUR_GENERATED_KEY
GROQ_API_KEY=your_groq_api_key_here
ANTHROPIC_API_KEY=
BACKEND_CORS_ORIGINS=["http://173.212.220.11","http://173.212.220.11:8100","*"]
UPLOAD_DIR=/var/www/translan_data/backend/uploads
MAX_FILE_SIZE_MB=50
EOF
```

Generate secret key: `python3 -c "import secrets; print(secrets.token_hex(32))"`

### Initialize DB
```bash
source venv/bin/activate
python -c "import asyncio; from app.database import create_tables; asyncio.run(create_tables())"
```

### Systemd service
```bash
cat > /etc/systemd/system/translan_data.service << 'EOF'
[Unit]
Description=Translan Data — FastAPI Backend
After=network.target postgresql.service

[Service]
Type=simple
User=root
WorkingDirectory=/var/www/translan_data/backend
Environment="PATH=/var/www/translan_data/backend/venv/bin"
EnvironmentFile=/var/www/translan_data/backend/.env
ExecStart=/var/www/translan_data/backend/venv/bin/uvicorn main:app --host 127.0.0.1 --port 8100 --workers 2
Restart=always
RestartSec=5
[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable translan_data
systemctl start translan_data
```

---

## ✅ 4. Nginx (done)

```bash
cat > /etc/nginx/sites-available/translan_data << 'EOF'
server {
    listen 80;
    server_name 173.212.220.11;

    location /translan_data/ {
        rewrite ^/translan_data(/.*)$ $1 break;
        proxy_pass http://127.0.0.1:8100;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_connect_timeout 60s;
        proxy_read_timeout 120s;
        client_max_body_size 55M;
    }

    location /jenkins/ {
        proxy_pass http://127.0.0.1:8080/jenkins/;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 90s;
    }
}
EOF

ln -s /etc/nginx/sites-available/translan_data /etc/nginx/sites-enabled/
nginx -t && systemctl reload nginx
```

Verify API:
```bash
curl http://173.212.220.11/translan_data/health   # → {"status":"ok"}
```

---

## ⏳ 5. Install Jenkins on 173.212.220.11  ← NEXT STEP

Jenkins will run on the same server — no SSH needed for deploys.

### 5.1 Install Java (Jenkins requires Java 17+)
```bash
apt install -y fontconfig openjdk-17-jre
java -version   # should show openjdk 17
```

### 5.2 Install Jenkins
```bash
wget -O /usr/share/keyrings/jenkins-keyring.asc \
  https://pkg.jenkins.io/debian-stable/jenkins.io-2023.key

echo "deb [signed-by=/usr/share/keyrings/jenkins-keyring.asc] \
  https://pkg.jenkins.io/debian-stable binary/" \
  | tee /etc/apt/sources.list.d/jenkins.list > /dev/null

apt update
apt install -y jenkins
systemctl enable jenkins
systemctl start jenkins
systemctl status jenkins
```

### 5.3 Configure Jenkins prefix (for Nginx /jenkins/ path)
```bash
echo 'JENKINS_ARGS="--prefix=/jenkins"' >> /etc/default/jenkins
systemctl restart jenkins
```

### 5.4 Get initial admin password
```bash
cat /var/lib/jenkins/secrets/initialAdminPassword
```

Open `http://173.212.220.11/jenkins` in your browser and complete the setup wizard.

### 5.5 Install Node.js (for APK build)
```bash
curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
apt install -y nodejs
node --version   # v20.x
```

---

## ⏳ 6. Jenkins Pipeline Setup

The `Jenkinsfile` is already in the repo. Since Jenkins runs on the same server as the app, deploys are local — no SSH required.

### 6.1 Add Expo token credential

For EAS cloud APK builds, Jenkins needs your Expo account token:
1. Create free account at `https://expo.dev`
2. Settings → Access Tokens → Create token → copy it
3. Jenkins → **Manage Jenkins → Credentials → Global → Add Credentials**
   - Kind: **Secret text**
   - ID: `expo-token`
   - Secret: paste token

### 6.2 Create Pipeline job

1. **New Item** → `translan_data` → **Pipeline** → OK
2. Pipeline:
   - Definition: **Pipeline script from SCM**
   - SCM: **Git**
   - URL: `https://github.com/MoctarSidibe/translan_data.git`
   - Branch: `*/main`
   - Script Path: `Jenkinsfile`
3. **Save** → **Build Now**

### 6.3 GitHub webhook

GitHub repo → Settings → Webhooks → Add webhook:
- URL: `http://173.212.220.11/jenkins/github-webhook/`
- Content type: `application/json`
- Event: push

---

## ⏳ 7. APK Build & Install

After the Jenkins Build APK stage completes:
1. Go to `https://expo.dev` → your project → **Builds**
2. Download the `.apk`
3. Install on Android device directly

---

## 8. Day-to-Day Commands

```bash
# Backend logs
journalctl -u translan_data -f

# Restart backend
systemctl restart translan_data

# Pull latest manually (Jenkins does this automatically)
cd /var/www/translan_data && git pull origin main

# Nginx reload
systemctl reload nginx

# Jenkins logs
journalctl -u jenkins -f
```

---

## 9. Directory Layout

```
/var/www/translan_data/
├── backend/
│   ├── venv/        ← Python virtualenv (not in git)
│   ├── uploads/     ← user uploads (not in git)
│   ├── .env         ← secrets (not in git)
│   └── main.py
└── mobile/          ← source only; APK built via EAS

/var/lib/jenkins/    ← Jenkins home
```

---

## 10. Security Checklist

- [x] SECRET_KEY set to strong random value
- [x] SSH key auth for server access
- [ ] Strong PostgreSQL password (replace placeholder)
- [ ] Remove `"*"` from BACKEND_CORS_ORIGINS
- [ ] SSL: `certbot --nginx -d your-domain.com`
- [ ] Firewall: `ufw allow 22 && ufw allow 80 && ufw allow 443 && ufw enable`
- [ ] Add GROQ_API_KEY to .env on server

---

## 11. DevOps Recommendation — Future Scale

For managing multiple apps across multiple servers, consider:

| Tool | Purpose | Cost |
|------|---------|------|
| **Coolify** | Self-hosted PaaS — manages apps, DBs, SSL, reverse proxy across servers from one UI. Replaces manual Nginx + Jenkins setup | Free |
| **Traefik** | Automatic reverse proxy + SSL for Docker-based apps | Free |
| **Portainer** | Docker container management UI | Free (CE) |
| **Cloudflare Tunnel** | Expose apps without opening ports, DDoS protection | Free tier |
| **Ansible** | Automate deployments to multiple servers via playbooks | Free |

**Best starting point:** Install **Coolify** on one server → connect both servers to it → deploy all future apps from the Coolify dashboard. Handles everything DEPLOYMENT.md does manually, in a few clicks.
