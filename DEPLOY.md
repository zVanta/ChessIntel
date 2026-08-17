# Deploying to a Debian server (Docker)

Target: the app is served at `https://chess.njxai.com` (HTTPS via Caddy +
Let's Encrypt). The stack has the Next.js web app, the Python analysis/OCR
service, and a Caddy reverse proxy, plus a persisted SQLite volume.

## 1. Install Docker + the Compose plugin (on the Debian server)

```bash
sudo apt-get update
sudo apt-get install -y ca-certificates curl

sudo install -m 0755 -d /etc/apt/keyrings
sudo curl -fsSL https://download.docker.com/linux/debian/gpg -o /etc/apt/keyrings/docker.asc
sudo chmod a+r /etc/apt/keyrings/docker.asc

echo \
  "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/debian \
  $(. /etc/os-release && echo "$VERSION_CODENAME") stable" | \
  sudo tee /etc/apt/sources.list.d/docker.list > /dev/null

sudo apt-get update
sudo apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
```

Verify:

```bash
sudo docker version
sudo docker compose version
```

## 2. Get the code onto the server

Either clone the repo (recommended) or copy it with `scp`/`rsync`:

```bash
git clone <your-repo-url> /opt/checkmate-coach
cd /opt/checkmate-coach
```

## 3. Configure secrets

```bash
cd /opt/checkmate-coach
nano .env
```

Fill in only the secrets (the rest have defaults in `docker-compose.yml`):

```
NEXT_PUBLIC_SITE_NAME=Checkmate Coach
OPENAI_API_KEY=
LLM_MODEL=gpt-4o-mini
STRIPE_SECRET_KEY=sk_test_...
STRIPE_WEBHOOK_SECRET=whsec_...
STRIPE_PRICE_ID=price_...
```

> `docker-compose.yml` uses `${VAR:-default}`, so an empty `.env` is fine to
> start with — the app will run with the deterministic (non-LLM) report
> generator and Stripe disabled.

## 4. Build and start

```bash
sudo docker compose up -d --build
```

Check status and logs:

```bash
sudo docker compose ps
sudo docker compose logs -f web
sudo docker compose logs -f service
```

The app is now live at `https://chess.njxai.com`.

## 5. Where data lives

The SQLite database is in the named volume `chess-data`, mounted at `/data`
inside the `web` container. It survives container rebuilds/restarts.

Back up:

```bash
sudo docker run --rm -v checkmate-coach_chess-data:/data -v "$PWD":/backup alpine \
  cp /data/chess.db /backup/chess.db.bak
```

## 6. DNS + HTTPS (already wired into docker-compose)

The Android app (Trusted Web Activity) requires HTTPS, so the stack includes
Caddy as a reverse proxy with automatic Let's Encrypt certificates.

1. **Create a DNS record** at your registrar: an `A` record for `chess` pointing
   at the VPS IP. Wait for it to propagate.
2. **Open ports 80 and 443** on the VPS firewall:
   ```bash
   sudo ufw allow 80/tcp
   sudo ufw allow 443/tcp
   ```
3. On `docker compose up`, Caddy obtains the certificate automatically — no
   extra config. The `Caddyfile` is simply:
   ```
   chess.njxai.com {
       reverse_proxy web:3000
       encode gzip
   }
   ```
4. **Digital Asset Links** (Android app verification) are served from
   `public/.well-known/assetlinks.json`. It contains the **debug** signing-key
   fingerprint (matches `android/checkmate-coach-debug.apk`). The debug key is
   per-machine, so rebuild the APK on the same machine for testing, or replace
   the fingerprint with your release key's SHA-256 for the Play Store.

## 7. Stripe webhooks

Point your Stripe webhook at `https://chess.njxai.com/api/webhooks`. Use the
same `STRIPE_WEBHOOK_SECRET` you set in `.env`.
