# Translan Data — Deployment Guide (V1)

**Server:** `173.212.220.11`  
**Jenkins:** `http://37.60.240.199:8081/jenkins`  
**GitHub:** `https://github.com/MoctarSidibe/translan_data`  
**Project root on server:** `/var/www/translan_data/`

---

## Current Status

```
✅ 1.  Server dependencies installed      (python3.12, postgresql, nginx, git)
✅ 2.  PostgreSQL setup                   (translan_db, translan_user, vector extension)
✅ 3.  Repo cloned                        (/var/www/translan_data/)
✅ 4.  Python venv + dependencies         (venv/bin/python3.12)
✅ 5.  .env file created                  (DATABASE_URL, SECRET_KEY set)
✅ 6.  Database tables initialized        (create_tables ran clean)
✅ 7.  Systemd service running            (translan_data.service active)
✅ 8.  Nginx configured                   (/translan_data/ proxied to :8100)
✅ 9.  API live and healthy               (curl /translan_data/health → {"status":"ok"})
✅ 10. Production URL set in mobile app   (mobile/services/api.ts pushed to GitHub)
✅ 11. GitHub webhook created             (pushes to main trigger Jenkins)

⏳ 12. SSH key: Jenkins (37.60.240.199) → App server (173.212.220.11)  ← YOU ARE HERE
⏳ 13. Add SSH credential in Jenkins UI
⏳ 14. Create Pipeline job in Jenkins
⏳ 15. APK build
```

> **Jenkins role:** Full CI/CD — on every push to `main`: deploy backend to `173.212.220.11` via SSH + build APK via EAS.

---

## Architecture Overview

```
Internet
   │
   ▼
Nginx :80
   │
   └── /translan_data/ → uvicorn @ 127.0.0.1:8100  (FastAPI — LIVE ✅)

Jenkins :8081 ──► git pull + restart service (on push to main)

Mobile APK ──► http://173.212.220.11/translan_data/
```

Each app on the server gets its own folder and internal port — no conflicts:

| App           | Internal port | Nginx path prefix   | Status |
|---------------|--------------|---------------------|--------|
| translan_data | 8100         | `/translan_data/`   | ✅ Live |
| (next app)    | 8101         | `/…/`               |        |

---

## ✅ 1. Server Setup (done)

### 1.1 Connect
```bash
ssh root@173.212.220.11
```

### 1.2 System dependencies
```bash
apt update && apt upgrade -y
apt install -y python3 python3-venv python3-pip \
               postgresql postgresql-contrib \
               nginx git curl build-essential \
               libpq-dev
```

> Server has Python **3.12** — no deadsnakes PPA needed.

### 1.3 pgvector extension
```bash
PG_VER=$(psql --version | grep -oP '\d+' | head -1)
apt install -y postgresql-server-dev-${PG_VER}
git clone https://github.com/pgvector/pgvector.git /tmp/pgvector
cd /tmp/pgvector && make && make install
```

### 1.4 Create project directory
```bash
mkdir -p /var/www/translan_data
```

---

## ✅ 2. PostgreSQL Setup (done)

Switch to the postgres user (from root), then run psql directly:
```bash
su - postgres
```

```bash
psql -c "CREATE USER translan_user WITH PASSWORD 'YOUR_PASSWORD';" \
     -c "CREATE DATABASE translan_db OWNER translan_user;" \
     -c "GRANT ALL PRIVILEGES ON DATABASE translan_db TO translan_user;"

psql -d translan_db -c "CREATE EXTENSION IF NOT EXISTS vector;"
exit
```

> Already logged in as postgres? Skip `su - postgres` and run psql directly.

---

## ✅ 3. Backend Deployment (done)

### 3.1 Clone the repo
```bash
cd /var/www/translan_data
git clone https://github.com/MoctarSidibe/translan_data.git .
```

### 3.2 Python virtual environment
```bash
cd /var/www/translan_data/backend
python3 -m venv venv
source venv/bin/activate
pip install --upgrade pip
pip install -r requirements.txt
```

### 3.3 Environment variables

> **Must be done before initializing the database.**

Generate a secret key:
```bash
python3 -c "import secrets; print(secrets.token_hex(32))"
```

Create the `.env` file:
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

### 3.4 Initialize the database
```bash
cd /var/www/translan_data/backend
source venv/bin/activate
python -c "import asyncio; from app.database import create_tables; asyncio.run(create_tables())"
```

No output = success. SQLAlchemy skips tables that already exist.

### 3.5 Systemd service
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
systemctl status translan_data
```

---

## ✅ 4. Nginx Configuration (done)

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
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_connect_timeout 60s;
        proxy_read_timeout 120s;
        client_max_body_size 55M;
    }
}
EOF

ln -s /etc/nginx/sites-available/translan_data /etc/nginx/sites-enabled/
nginx -t
systemctl reload nginx
```

Verify:
```bash
curl http://173.212.220.11/translan_data/
curl http://173.212.220.11/translan_data/health
```

---

## ✅ 5. Mobile — Production URL (done)

`mobile/services/api.ts` already set and pushed:
```ts
export const API_BASE = __DEV__
  ? 'http://192.168.1.67:8000'
  : 'http://173.212.220.11/translan_data';
```

---

## ⏳ 6. Jenkins CI/CD Pipeline  ← NEXT STEP

Jenkins (`37.60.240.199:8081`) builds the APK **and** deploys the backend to `173.212.220.11` on every push to `main`.  
The `Jenkinsfile` is already in the repo root. GitHub webhook is already configured ✅.

### 6.1 Set up SSH key from Jenkins → App server

Jenkins needs passwordless SSH access to `173.212.220.11` to run `git pull` and `systemctl restart`.

**On the Jenkins server (`37.60.240.199`):**
```bash
ssh-keygen -t ed25519 -f ~/.ssh/translan_deploy -N ""
cat ~/.ssh/translan_deploy.pub   # copy this output
```

**On the app server (`173.212.220.11`):**
```bash
mkdir -p ~/.ssh && chmod 700 ~/.ssh
echo "PASTE_PUBLIC_KEY_HERE" >> ~/.ssh/authorized_keys
chmod 600 ~/.ssh/authorized_keys
```

**Test the connection from Jenkins server:**
```bash
ssh -i ~/.ssh/translan_deploy root@173.212.220.11
# must connect without asking for a password
```

### 6.2 Add SSH credential to Jenkins

**Manage Jenkins → Credentials → System → Global → Add Credentials:**
- Kind: **SSH Username with private key**
- ID: `translan-deploy-key`
- Username: `root`
- Private key → Enter directly → paste contents of `~/.ssh/translan_deploy`

### 6.3 Create the Pipeline job

1. **New Item** → `translan_data` → **Pipeline** → OK
2. Under **Pipeline**:
   - Definition: **Pipeline script from SCM**
   - SCM: **Git**
   - Repository URL: `https://github.com/MoctarSidibe/translan_data.git`
   - Branch: `*/main`
   - Script Path: `Jenkinsfile`
3. **Save** → **Build Now**

**What the pipeline does on every push:**
1. Checkout repo from GitHub
2. SSH into `173.212.220.11` → `git pull` + `pip install` + `systemctl restart translan_data`
3. Hit `/translan_data/health` → confirm HTTP 200
4. `npm ci` + `eas build --platform android` → APK ready on expo.dev

### 6.4 GitHub webhook (already done ✅)

Every push to `main` automatically triggers the full pipeline.

---

## ⏳ 7. APK Download & Install

After Jenkins triggers the EAS build:

1. Go to **https://expo.dev** → your project → **Builds**
2. Wait for the build to finish (~5–10 min)
3. Download the `.apk` file
4. Install directly on your Android device

> `preview` profile = installable APK (no Play Store needed).  
> `production` profile = AAB for Play Store submission later.

---

## 8. Useful Commands (Day-to-Day)

```bash
# Check backend logs live
journalctl -u translan_data -f

# Restart backend
systemctl restart translan_data

# Pull latest code manually (Jenkins does this automatically)
cd /var/www/translan_data && git pull origin main

# Reload Nginx
systemctl reload nginx

# Check Nginx errors
tail -f /var/log/nginx/error.log

# Connect to database
psql -U translan_user -d translan_db -h localhost
```

---

## 9. Directory Layout on Server

```
/var/www/
├── translan_data/              ← this app
│   ├── backend/
│   │   ├── venv/               ← Python virtualenv (not in git)
│   │   ├── uploads/            ← user uploads (not in git)
│   │   ├── .env                ← secrets (not in git)
│   │   ├── main.py
│   │   └── ...
│   └── mobile/                 ← source reference; APK built locally via EAS
│
├── <next_app>/                 ← port 8101, no conflict with translan_data
```

---

## 10. Security Checklist (before going public)

- [x] `SECRET_KEY` set to strong random value
- [ ] Set a strong PostgreSQL password (currently using placeholder)
- [ ] Remove `"*"` from `BACKEND_CORS_ORIGINS`
- [ ] Install SSL: `certbot --nginx -d your-domain.com`
- [ ] Firewall: `ufw allow 22 && ufw allow 80 && ufw allow 443 && ufw allow 8081 && ufw enable`
- [ ] Add GROQ API key to `.env` on server
