# Translan Data — Deployment Guide (V1)

**Server:** `173.212.220.11`  
**Jenkins:** `http://37.60.240.199:8081/jenkins`  
**GitHub:** `https://github.com/MoctarSidibe/translan_data`  
**Project root on server:** `/var/www/translan_data/`

---

## Architecture Overview

```
Internet
   │
   ▼
Nginx (port 80 / 443)
   │
   └── /api/ → uvicorn @ 127.0.0.1:8100  (FastAPI backend)

Mobile app (Expo APK) ──► http://173.212.220.11/api/
```

Each app on the server gets its own folder (`/var/www/<app_name>/`) and its own internal port so there are no conflicts.

| App           | Internal port | Nginx path prefix |
|---------------|--------------|-------------------|
| translan_data | 8100         | `/translan_data/` |
| (next app)    | 8101         | `/…/`             |

---

## 1. First-time Server Setup

### 1.1 Connect to the server
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

> **Check your Python version** — FastAPI requires 3.10+:
> ```bash
> python3 --version
> ```
> If it shows **< 3.10**, install a newer version via the deadsnakes PPA:
> ```bash
> apt install -y software-properties-common
> add-apt-repository ppa:deadsnakes/ppa
> apt update
> apt install -y python3.11 python3.11-venv python3.11-distutils
> # Then use python3.11 instead of python3 in all commands below
> ```

### 1.3 Install pgvector extension

First, find your PostgreSQL version:
```bash
psql --version
# Example output: psql (PostgreSQL) 15.x
```

Install the matching dev headers and build pgvector:
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

## 2. PostgreSQL Setup

First, switch to the postgres system user (from root):
```bash
su - postgres
# prompt becomes: postgres@yourserver:~$
```

You are now the postgres user. Run the setup directly with `psql` (no `su` needed — you already are postgres):

```bash
psql -c "CREATE USER translan_user WITH PASSWORD 'CHANGE_THIS_PASSWORD';" \
     -c "CREATE DATABASE translan_db OWNER translan_user;" \
     -c "GRANT ALL PRIVILEGES ON DATABASE translan_db TO translan_user;"

psql -d translan_db -c "CREATE EXTENSION IF NOT EXISTS vector;"
```

Then go back to root:
```bash
exit
```

> **Or interactively** — type `psql` to enter the psql prompt (`postgres=#`), then:
> ```sql
> CREATE USER translan_user WITH PASSWORD 'CHANGE_THIS_PASSWORD';
> CREATE DATABASE translan_db OWNER translan_user;
> GRANT ALL PRIVILEGES ON DATABASE translan_db TO translan_user;
> \c translan_db
> CREATE EXTENSION IF NOT EXISTS vector;
> \q
> ```

---

## 3. Backend Deployment

### 3.1 Clone the repo
```bash
cd /var/www/translan_data
git clone https://github.com/MoctarSidibe/translan_data.git .
```

### 3.2 Python virtual environment
```bash
cd /var/www/translan_data/backend
python3 -m venv venv          # use python3.11 here if you installed it via deadsnakes
source venv/bin/activate
pip install --upgrade pip
pip install -r requirements.txt
```

### 3.3 Environment variables

> **This step must be done before initializing the database.** The app will crash without it.

**Step 1** — Generate a secret key:
```bash
python3 -c "import secrets; print(secrets.token_hex(32))"
# copy the output — you'll paste it as SECRET_KEY below
```

**Step 2** — Create the `.env` file (replace the password and paste your secret key):
```bash
cat > /var/www/translan_data/backend/.env << 'EOF'
DATABASE_URL=postgresql+asyncpg://translan_user:CHANGE_THIS_PASSWORD@localhost:5432/translan_db
SECRET_KEY=PASTE_YOUR_GENERATED_KEY_HERE
GROQ_API_KEY=your_groq_api_key_here
ANTHROPIC_API_KEY=
BACKEND_CORS_ORIGINS=["http://173.212.220.11","http://173.212.220.11:8100","*"]
UPLOAD_DIR=/var/www/translan_data/backend/uploads
MAX_FILE_SIZE_MB=50
EOF
```

Verify it was created:
```bash
cat /var/www/translan_data/backend/.env
```

### 3.4 Initialize the database

> **The venv must be active and `.env` must exist before running this.**

```bash
cd /var/www/translan_data/backend
source venv/bin/activate
python -c "import asyncio; from app.database import create_tables; asyncio.run(create_tables())"
```

You should see no errors. If tables already exist, it's safe — SQLAlchemy skips them.

### 3.5 Systemd service
Create `/etc/systemd/system/translan_data.service`:
```ini
[Unit]
Description=Translan Data — FastAPI Backend
After=network.target postgresql.service

[Service]
Type=simple
User=www-data
Group=www-data
WorkingDirectory=/var/www/translan_data/backend
Environment="PATH=/var/www/translan_data/backend/venv/bin"
EnvironmentFile=/var/www/translan_data/backend/.env
ExecStart=/var/www/translan_data/backend/venv/bin/uvicorn main:app \
          --host 127.0.0.1 \
          --port 8100 \
          --workers 2 \
          --log-level info
Restart=always
RestartSec=5
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
```

```bash
chown -R www-data:www-data /var/www/translan_data
systemctl daemon-reload
systemctl enable translan_data
systemctl start translan_data
systemctl status translan_data
```

---

## 4. Nginx Configuration

Create `/etc/nginx/sites-available/translan_data`:
```nginx
upstream translan_data_backend {
    server 127.0.0.1:8100;
}

server {
    listen 80;
    server_name 173.212.220.11;

    # ── Translan Data API ──────────────────────────────────────────────────────
    location /translan_data/ {
        rewrite ^/translan_data(/.*)$ $1 break;
        proxy_pass http://translan_data_backend;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_connect_timeout 60s;
        proxy_read_timeout 120s;
        client_max_body_size 55M;
    }

    # ── Health check ───────────────────────────────────────────────────────────
    location /translan_data/health {
        proxy_pass http://translan_data_backend/health;
    }

    # ── Uploads (served directly by nginx) ────────────────────────────────────
    location /translan_data/uploads/ {
        alias /var/www/translan_data/backend/uploads/;
        expires 7d;
        access_log off;
    }
}
```

```bash
ln -s /etc/nginx/sites-available/translan_data /etc/nginx/sites-enabled/
nginx -t
systemctl reload nginx
```

### Verify the API is reachable:
```bash
curl http://173.212.220.11/translan_data/
curl http://173.212.220.11/translan_data/health
```

---

## 5. Mobile App — Point to Production API

Edit `mobile/services/api.ts` — update the production URL:
```ts
export const API_BASE = __DEV__
  ? 'http://192.168.1.67:8000'          // local dev
  : 'http://173.212.220.11/translan_data'; // production
```

Then build the APK via Expo EAS:
```bash
cd mobile
npm install -g eas-cli
eas login
eas build --platform android --profile production
```

Or for a local APK (requires Android SDK / Java):
```bash
npx expo prebuild --platform android
cd android && ./gradlew assembleRelease
# APK output: android/app/build/outputs/apk/release/app-release.apk
```

---

## 6. Jenkins CI/CD Pipeline

Jenkins is at `http://37.60.240.199:8081/jenkins`.

### 6.1 Prerequisites in Jenkins
1. **SSH Credential** — Add a credential of type "SSH Username with private key":
   - ID: `translan-server-ssh`
   - Username: `root`
   - Private key: paste your SSH private key for `173.212.220.11`
translan_data


2. **GitHub credential** (if private repo):
   - ID: `github-translan`
   - Username + token

3. **Plugins required:** Git, SSH Agent, Pipeline, AnsiColor

### 6.2 Create Pipeline job
- New Item → Pipeline → name it `translan_data`
- Pipeline → Definition: **Pipeline script from SCM**
- SCM: Git → `https://github.com/MoctarSidibe/translan_data.git`
- Script Path: `Jenkinsfile`

The `Jenkinsfile` at the repo root handles all stages automatically (see file).

### 6.3 Trigger builds
- Manual: click **Build Now** in Jenkins
- On push: add a GitHub webhook → `http://37.60.240.199:8081/jenkins/github-webhook/`

---

## 7. Useful Commands (Day-to-Day)

```bash
# Check backend logs
journalctl -u translan_data -f

# Restart backend
systemctl restart translan_data

# Pull latest code manually
cd /var/www/translan_data && git pull origin main

# Reload Nginx
systemctl reload nginx

# Check Nginx error log
tail -f /var/log/nginx/error.log

# PostgreSQL — connect to DB
psql -U translan_user -d translan_db -h localhost
```

---

## 8. Directory Layout on Server

```
/var/www/
├── translan_data/          ← this app
│   ├── backend/
│   │   ├── venv/           ← Python virtualenv (not in git)
│   │   ├── uploads/        ← user-uploaded files (not in git)
│   │   ├── .env            ← secrets (not in git)
│   │   ├── main.py
│   │   └── ...
│   └── mobile/             ← source only; APK built via EAS
│
├── <next_app>/             ← future app, port 8101, no conflict
│   └── ...
```

---

## 9. Security Checklist (before going public)

- [ ] Change `SECRET_KEY` to a strong random value
- [ ] Set a strong PostgreSQL password
- [ ] Remove `"*"` from `BACKEND_CORS_ORIGINS`, list only trusted origins
- [ ] Install SSL certificate: `certbot --nginx -d your-domain.com`
- [ ] Set up UFW: allow only 22, 80, 443, 8081 (Jenkins)
- [ ] Rotate GROQ API key if accidentally committed
