# Translan Data — Deployment Guide (V1)

**App Server:** `173.212.220.11`  
**GitHub:** `https://github.com/MoctarSidibe/translan_data`  
**Coolify UI:** `http://173.212.220.11:8000` (after install)

---

## Why Coolify?

Coolify replaces the entire manual stack in one tool:

| What you did manually | What Coolify does instead |
|-----------------------|--------------------------|
| Install + configure Nginx | **Traefik** (built-in, automatic) |
| SSL certificate (certbot) | **Auto SSL via Let's Encrypt** |
| Write systemd service | **Docker container** (auto-restart) |
| Jenkins pipeline for deploy | **GitHub webhook → auto-deploy** |
| Manual `git pull` + restart | **Zero-downtime redeploy on push** |
| Manage multiple servers | **One Coolify UI for all servers** |

> **Traefik is built into Coolify** — you do not install it separately.  
> **Docker is Coolify's native runtime** — your app runs as a container, no systemd needed.  
> **APK builds** still use EAS (Coolify is backend/web only).

---

## Architecture (with Coolify)

```
173.212.220.11
│
├── Coolify  :8000 (management UI)
│   └── Traefik :80/:443  (built-in reverse proxy + auto SSL)
│       └── translan_data  → Docker container :8000 (FastAPI)
│
└── PostgreSQL  (managed by Coolify or standalone)
```

---

## Current Status

```
✅ 1.  Server provisioned                 (Ubuntu 24.04, 173.212.220.11)
✅ 2.  GitHub repo live                   (github.com/MoctarSidibe/translan_data)
✅ 3.  Dockerfile added                   (backend/Dockerfile)

⏳ 4.  Install Coolify                    ← START HERE (fresh server)
⏳ 5.  Add PostgreSQL via Coolify
⏳ 6.  Deploy backend via Coolify
⏳ 7.  Connect GitHub webhook
⏳ 8.  APK build (EAS)
```

> **Already deployed manually?** Jump to §9 — Migration from manual setup.

---

## ⏳ 4. Install Coolify  ← START HERE

SSH into the server:
```bash
ssh root@173.212.220.11
```

Run the official one-line installer:
```bash
curl -fsSL https://cdn.coollabs.io/coolify/install.sh | bash
```

This installs Docker, Traefik, and Coolify (~5 min). When done:

```bash
# Check everything is running
docker ps
# You should see: coolify, coolify-proxy (Traefik), coolify-db, coolify-redis
```

Open **`http://173.212.220.11:8000`** in your browser → complete the setup wizard (create admin account).

---

## ⏳ 5. Add PostgreSQL via Coolify

In the Coolify UI:

1. **Resources → New Resource → Database → PostgreSQL**
2. Fill in:
   - Name: `translan-db`
   - Version: **16** (latest stable with pgvector support)
   - Database: `translan_db`
   - Username: `translan_user`
   - Password: (generate a strong one)
3. Click **Deploy**

> After deploy, Coolify shows you the **internal connection string** — use it as `DATABASE_URL` in the next step.

### Enable pgvector extension

Once the DB is running, open a terminal on the server:
```bash
docker exec -it <postgres-container-name> psql -U translan_user -d translan_db \
  -c "CREATE EXTENSION IF NOT EXISTS vector;"
```

Get the container name from `docker ps`.

---

## ⏳ 6. Deploy Backend via Coolify

### 6.1 Connect GitHub

Coolify UI → **Settings → Source → GitHub → Connect** → authorize the `MoctarSidibe/translan_data` repo.

### 6.2 Create new Application

**Resources → New Resource → Application → Docker**

Fill in:
- **Repository:** `MoctarSidibe/translan_data`
- **Branch:** `main`
- **Dockerfile location:** `backend/Dockerfile`
- **Port:** `8000`
- **Domain:** `173.212.220.11` (or your domain if you have one)
- **Path prefix:** `/translan_data`

### 6.3 Set environment variables

In the app settings → **Environment Variables**:

```env
DATABASE_URL=postgresql+asyncpg://translan_user:YOUR_PASSWORD@<coolify-db-host>:5432/translan_db
SECRET_KEY=YOUR_GENERATED_KEY
GROQ_API_KEY=your_groq_api_key_here
ANTHROPIC_API_KEY=
BACKEND_CORS_ORIGINS=["http://173.212.220.11","https://your-domain.com","*"]
UPLOAD_DIR=/app/uploads
MAX_FILE_SIZE_MB=50
```

Generate secret key:
```bash
python3 -c "import secrets; print(secrets.token_hex(32))"
```

### 6.4 Deploy

Click **Deploy** — Coolify will:
1. Pull code from GitHub
2. Build the Docker image using `backend/Dockerfile`
3. Start the container
4. Configure Traefik to route traffic to it

Verify:
```bash
curl http://173.212.220.11/translan_data/health
# → {"status":"ok"}
```

---

## ⏳ 7. GitHub Webhook (auto-deploy on push)

Coolify generates a webhook URL automatically.

In Coolify app settings → **Webhooks** → copy the URL.

Then in GitHub:
- Repo → **Settings → Webhooks → Add webhook**
- Payload URL: paste Coolify's webhook URL
- Content type: `application/json`
- Event: **Just the push event**

From now on: every `git push origin main` → Coolify rebuilds and redeploys automatically.

---

## ⏳ 8. APK Build (EAS)

Coolify does not build mobile APKs. Use EAS cloud build:

**One-time setup (local machine):**
```bash
cd mobile
npm install -g eas-cli
eas login          # logs in via browser — no token needed locally
eas build --platform android --profile preview
```

EAS gives you a download link when done (~5–10 min). Install the `.apk` directly on your Android device.

**For automated builds on every push**, EAS needs a token (for CI):
1. `https://expo.dev` → Settings → Access Tokens → Create token
2. Set `EXPO_TOKEN` in your CI environment

---

## 9. Migration from Manual Setup

If you already deployed manually (systemd + Nginx) and want to switch to Coolify:

```bash
# Stop the manual service
systemctl stop translan_data
systemctl disable translan_data

# Remove manual Nginx config (Coolify/Traefik takes over)
rm /etc/nginx/sites-enabled/translan_data
systemctl stop nginx
systemctl disable nginx

# Install Coolify (it brings its own Traefik)
curl -fsSL https://cdn.coollabs.io/coolify/install.sh | bash
```

Then follow steps 4–7 above. Your `.env` values stay the same.

---

## 10. Day-to-Day

```bash
# View app logs
docker logs <container-name> -f

# View all running containers
docker ps

# Restart app manually
docker restart <container-name>

# Coolify UI
http://173.212.220.11:8000

# DB connection (from server)
docker exec -it <postgres-container> psql -U translan_user -d translan_db
```

---

## 11. Directory Layout

```
/var/www/translan_data/     ← source (git clone, used by Coolify)
└── backend/
    ├── Dockerfile          ← Coolify builds from this
    ├── .env                ← set via Coolify UI (not committed)
    └── uploads/            ← mounted as Docker volume

/data/coolify/              ← Coolify data (configs, DB volumes)
```

---

## 12. Security Checklist

- [ ] Strong PostgreSQL password
- [ ] `SECRET_KEY` set to strong random value
- [ ] Remove `"*"` from `BACKEND_CORS_ORIGINS` before going public
- [ ] Enable SSL in Coolify (add domain → Coolify handles Let's Encrypt automatically)
- [ ] Firewall: `ufw allow 22 && ufw allow 80 && ufw allow 443 && ufw allow 8000 && ufw enable`
- [ ] Add GROQ_API_KEY via Coolify environment variables

---

## 13. Multi-Server & Future Apps

Coolify's biggest advantage: manage all your servers and apps from **one UI**.

**Add your second server (`37.60.240.199`):**
- Coolify UI → **Servers → Add Server**
- Enter IP + SSH key → Coolify installs its agent on the remote server
- Now deploy any new app to either server from the same dashboard

**Deploy a new app:**
- Resources → New → Application → pick repo, branch, Dockerfile → Deploy
- Traefik routing and SSL handled automatically — no Nginx config to write

| Tool | Role | Installed by |
|------|------|-------------|
| Coolify | Management UI + orchestration | You (one-liner) |
| Traefik | Reverse proxy + SSL | Coolify (automatic) |
| Docker | Container runtime | Coolify (automatic) |
| PostgreSQL | Database | Coolify UI |
