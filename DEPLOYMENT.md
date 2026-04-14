# Translan Data — Deployment Guide (V1)

**GitHub:** `https://github.com/MoctarSidibe/translan_data`  
**App server:** `173.212.220.11` — Coolify + Backend  
**CI server:** `37.60.240.199` — Jenkins (APK builds)

---

## Architecture

```
GitHub (push to main)
        │
        ├──── Webhook 1 ──► Coolify on 173.212.220.11
        │                         └── rebuilds Docker image
        │                         └── redeploys FastAPI container
        │                         └── Traefik routes /translan_data/ → container
        │
        └──── Webhook 2 ──► Jenkins on 37.60.240.199:8081
                                  └── npm install
                                  └── eas build → APK on expo.dev

Mobile APK  ──► http://173.212.220.11/translan_data/  (production API)
```

### Server roles

| Server | IP | Role | Tools |
|--------|----|------|-------|
| App server | `173.212.220.11` | Backend + DB + Reverse proxy | Coolify, Docker, Traefik, PostgreSQL |
| CI server | `37.60.240.199` | APK builds | Jenkins, Node.js, EAS CLI |

### What each tool does

| Tool | Replaces | Installed by |
|------|---------|-------------|
| **Coolify** | Manual deploy scripts, systemd | One-liner on 173.212.220.11 |
| **Traefik** | Nginx reverse proxy | Coolify (automatic, built-in) |
| **Docker** | Python venv + systemd service | Coolify (automatic) |
| **Let's Encrypt SSL** | certbot manual setup | Coolify (automatic, when domain added) |
| **Jenkins** | — | Already running on 37.60.240.199 |
| **EAS Build** | Local APK builds | Cloud service (expo.dev) |

---

## Current Status

```
✅  GitHub repo live               github.com/MoctarSidibe/translan_data
✅  Dockerfile added               backend/Dockerfile
✅  Production API URL set         mobile/services/api.ts → /translan_data
✅  Jenkins running                37.60.240.199:8081
✅  GitHub webhook to Jenkins      pushes trigger APK build

⏳  Install Coolify                173.212.220.11          ← START HERE
⏳  Provision PostgreSQL           via Coolify UI
⏳  Deploy backend                 via Coolify UI
⏳  GitHub webhook to Coolify      auto-deploy on push
⏳  Add Expo token to Jenkins      for APK builds
⏳  Full pipeline test
```

---

## Step 1 — Install Coolify on 173.212.220.11

> If you have a manually deployed backend running (systemd + Nginx),
> stop it first — Coolify's Traefik takes over port 80/443.
> ```bash
> systemctl stop translan_data nginx
> systemctl disable translan_data nginx
> ```

SSH in and run the one-line installer:
```bash
ssh root@173.212.220.11
curl -fsSL https://cdn.coollabs.io/coolify/install.sh | bash
```

This installs Docker, Traefik, and Coolify (~5 min). Verify:
```bash
docker ps
# Should show: coolify, coolify-proxy, coolify-db, coolify-redis
```

Open **`http://173.212.220.11:8000`** → complete setup wizard → create admin account.

---

## Step 2 — Provision PostgreSQL via Coolify

In the Coolify UI:

1. **Resources → New Resource → Database → PostgreSQL 16**
2. Settings:
   - Name: `translan-db`
   - Database name: `translan_db`
   - Username: `translan_user`
   - Password: *(generate strong — save this)*
3. Click **Deploy**

Once running, enable pgvector:
```bash
# Get the postgres container name
docker ps | grep postgres

docker exec -it <postgres-container-name> psql -U translan_user -d translan_db \
  -c "CREATE EXTENSION IF NOT EXISTS vector;"
```

Coolify shows you the **internal connection string** in the DB resource settings —
copy it for the next step.

---

## Step 3 — Deploy Backend via Coolify

### 3.1 Connect GitHub

Coolify UI → **Settings → Source → GitHub → Connect** → authorize `MoctarSidibe/translan_data`.

### 3.2 Create Application

**Resources → New Resource → Application**

| Field | Value |
|-------|-------|
| Repository | `MoctarSidibe/translan_data` |
| Branch | `main` |
| Dockerfile | `backend/Dockerfile` |
| Port | `8000` |
| Base directory | `backend` |
| Domain/Path | `173.212.220.11/translan_data` |

### 3.3 Set Environment Variables

In the app → **Environment Variables** tab:

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

### 3.4 Deploy

Click **Deploy** — Coolify builds the Docker image and starts the container.

Verify:
```bash
curl http://173.212.220.11/translan_data/health
# → {"status":"ok"}
```

---

## Step 4 — GitHub Webhook to Coolify (auto-deploy)

Every push to `main` will trigger a Coolify redeploy automatically.

1. Coolify UI → your app → **Webhooks** → copy the webhook URL
2. GitHub repo → **Settings → Webhooks → Add webhook**
   - Payload URL: *(paste Coolify webhook URL)*
   - Content type: `application/json`
   - Event: **Just the push event**
   - Click **Add webhook**

Test: push any small change to `main` — watch Coolify redeploy automatically.

---

## Step 5 — Jenkins APK Build (37.60.240.199)

Jenkins on `37.60.240.199:8081` handles APK builds only.
The `Jenkinsfile` in the repo root is already configured for this.

### 5.1 Add Expo token to Jenkins

EAS Build requires authentication in CI:

1. Go to `https://expo.dev` → Settings → **Access Tokens** → Create token → copy it
2. Jenkins → **Manage Jenkins → Credentials → Global → Add Credentials**
   - Kind: **Secret text**
   - ID: `expo-token`
   - Secret: paste the token

### 5.2 Create Pipeline job (if not already done)

1. **New Item** → `translan_data` → **Pipeline** → OK
2. Pipeline:
   - Definition: **Pipeline script from SCM**
   - SCM: **Git**
   - URL: `https://github.com/MoctarSidibe/translan_data.git`
   - Branch: `*/main`
   - Script Path: `Jenkinsfile`
3. **Save**

### 5.3 GitHub webhook to Jenkins (already done ✅)

`http://37.60.240.199:8081/jenkins/github-webhook/` is already set in GitHub.

### 5.4 What the Jenkins pipeline does

```
Checkout → npm install --legacy-peer-deps → eas build (cloud) → APK on expo.dev
```

After the build (~5–10 min), go to `https://expo.dev` → your project → **Builds**
→ download the `.apk` → install directly on Android.

---

## Step 6 — Full Flow Test

Push a small change to `main`:
```bash
git commit --allow-empty -m "test: trigger full pipeline"
git push origin main
```

**Expected:**
1. Coolify detects push → rebuilds Docker image → redeploys backend (~1–2 min)
2. Jenkins detects push → runs APK build stage (~5–10 min on EAS cloud)
3. `curl http://173.212.220.11/translan_data/health` → `{"status":"ok"}`

---

## Day-to-Day Operations

```bash
# View backend logs (via Docker on 173.212.220.11)
docker logs <container-name> -f

# List running containers
docker ps

# Restart backend manually
docker restart <container-name>

# Connect to DB
docker exec -it <postgres-container> psql -U translan_user -d translan_db

# Coolify UI
http://173.212.220.11:8000

# Jenkins UI
http://37.60.240.199:8081/jenkins
```

---

## Adding Future Apps

Both servers are now managed from Coolify on `173.212.220.11`.

**Add the second server to Coolify:**
- Coolify UI → **Servers → Add Server**
- IP: `37.60.240.199` + SSH key → Coolify installs its agent remotely

**Deploy any new app:**
- Resources → New → Application → pick GitHub repo + branch + Dockerfile
- Traefik routing + SSL handled automatically — zero Nginx config

No port conflicts — Coolify assigns and manages ports internally.

---

## Security Checklist

- [x] Secret key set to strong random value
- [x] SSH key auth configured
- [ ] Strong PostgreSQL password (set in Coolify, not committed to git)
- [ ] Remove `"*"` from `BACKEND_CORS_ORIGINS` before going public
- [ ] Add domain → Coolify enables Let's Encrypt SSL automatically
- [ ] Firewall:
  ```bash
  ufw allow 22
  ufw allow 80
  ufw allow 443
  ufw allow 8000   # Coolify UI — restrict to your IP in production
  ufw enable
  ```
- [ ] Add GROQ_API_KEY via Coolify environment variables (not in git)
