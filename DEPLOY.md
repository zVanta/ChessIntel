# Deploying to a Debian server (Docker)

Target: the app is served at `https://chess.njxai.com` (HTTPS via Cloudflare
Tunnel). The Docker stack has the Next.js web app and the Python analysis/OCR
service, plus a persisted SQLite volume. The Cloudflare Tunnel itself runs
natively on the host (systemd `cloudflared`), not in Docker.

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
DEEPSEEK_API_KEY=sk-...
DEEPSEEK_MODEL=deepseek-reasoner
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

## 6. Routing + HTTPS via Cloudflare Tunnel

Ports 80/443 on this server are used by LibreChat's nginx, so this stack uses a
Cloudflare Tunnel instead of a reverse proxy. No inbound ports are needed —
Cloudflare handles DNS and TLS for `chess.njxai.com`.

1. **Cloudflare Zero Trust** -> Networks -> Tunnels -> Create a tunnel
   (Cloudflared). Install and run `cloudflared` on the host, e.g.:
   ```bash
   sudo cloudflared service install <TOKEN>
   ```
2. In the tunnel's **Public Hostnames**, add:
   - Subdomain: `chess`, Domain: `njxai.com`
   - Service type: `HTTP`, URL: `http://localhost:3000`
   (the web container publishes `127.0.0.1:3000` on the host)
3. Start the Docker stack (no tunnel token is needed in `.env`):
   ```bash
   sudo docker compose up -d
   ```
5. **Digital Asset Links** (Android app verification) are served from
   `public/.well-known/assetlinks.json` (Cloudflare passes it through). It
   contains the **debug** signing-key fingerprint (matches
   `android/checkmate-coach-debug.apk`). The debug key is per-machine, so rebuild
   the APK on the same machine for testing, or replace the fingerprint with your
   release key's SHA-256 for the Play Store.

> Prefer a reverse proxy instead of a tunnel? The `Caddyfile` is kept in the
> repo — but it needs ports 80/443 free (they're not, while LibreChat runs).

## 7. Stripe webhooks

Point your Stripe webhook at `https://chess.njxai.com/api/webhooks`. Use the
same `STRIPE_WEBHOOK_SECRET` you set in `.env`.
