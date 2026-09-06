# AFDrive Online — Deployment

AFDrive Online is split into three independently configured parts:

- `site/` — static frontend deployed to GitHub Pages.
- `relay/` — persistent Node.js/Socket.IO relay.
- `agent/` — Python Agent running on the user's storage device.

Supabase is the single central backend used for authentication and online metadata.

## 1. Supabase

Create one Supabase project for the AFDrive Online service.

Run:

```text
Supabase Dashboard → SQL Editor → docs/supabase_schema.sql
```

Configure authentication according to the desired registration experience.

Keep the service-role key server-side only. It must never be placed in `site/` or committed to Git.

## 2. Relay

Deploy `relay/` to infrastructure that supports a long-running Node.js process and WebSocket connections.

```bash
cd relay
npm install
cp .env.example .env
npm start
```

Required environment variables include:

```env
PORT=8080
NODE_ENV=production
ALLOWED_ORIGINS=https://YOUR-USERNAME.github.io
SUPABASE_URL=https://YOUR-PROJECT.supabase.co
SUPABASE_ANON_KEY=YOUR-ANON-KEY
SUPABASE_SERVICE_ROLE_KEY=YOUR-SERVICE-ROLE-KEY
REGISTER_RATE_LIMIT_PER_15MIN=10
```

`ALLOWED_ORIGINS` must contain the exact GitHub Pages origin used by the site.

The relay must be exposed through HTTPS. WebSocket upgrades must be supported by the hosting platform or reverse proxy.

## 3. GitHub Pages site

The static frontend lives in `site/`.

Configure:

```text
site/assets/js/config.js
```

with:

```javascript
export const CONFIG = {
  SUPABASE_URL: "https://YOUR-PROJECT.supabase.co",
  SUPABASE_ANON_KEY: "YOUR-ANON-KEY",
  RELAY_URL: "https://YOUR-RELAY.example.com",
};
```

These are public browser values. Never put the service-role key here.

Enable GitHub Pages using **GitHub Actions** in repository Settings → Pages.
The workflow at `.github/workflows/deploy-pages.yml` publishes `site/` on pushes to `main`.

## 4. Agent

Install the Agent on the device that owns the files.

Linux/macOS:

```bash
cd agent
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt
cp .env.example .env
```

Windows:

```powershell
cd agent
python -m venv venv
.\venv\Scripts\Activate.ps1
pip install -r requirements.txt
Copy-Item .env.example .env
```

Android/Termux:

```bash
pkg install python
pip install -r requirements.txt
```

Configure `agent/.env`:

```env
AFDRIVE_STORAGE_PATH=./storage/user_files
AFDRIVE_ONLINE_ENABLED=true
AFDRIVE_RELAY_URL=https://YOUR-RELAY.example.com
AFDRIVE_SERVER_NAME=My AFDrive
AFDRIVE_PUBLIC=false
```

The existing local Agent credentials remain separate from AFDrive Online account authentication.

## 5. Pair the Agent

Create/register a storage from the Online web application and obtain its one-time pairing code.

On the Agent device:

```bash
cd agent
python setup_cli.py pair <PAIRING_CODE>
```

Check the local identity/status:

```bash
python setup_cli.py status
```

Then start the Agent:

```bash
python app.py
```

## 6. Local mode

Online Mode is additive. With `AFDRIVE_ONLINE_ENABLED=false`, the Agent continues to serve the local AFDrive interface:

```text
http://<device-LAN-IP>:<AFDRIVE_PORT>
```

## 7. Production checklist

Before inviting real users:

- Supabase schema applied.
- Supabase authentication configured.
- Relay deployed over HTTPS/WSS.
- `ALLOWED_ORIGINS` restricted to the real site origin.
- Relay service-role key configured only on the relay.
- Relay secret configured and validated.
- GitHub Pages site deployed.
- Site `config.js` points to production Supabase and relay.
- Agent paired successfully.
- Online/offline presence tested.
- Private/public access tested.
- Read-only/read-write permissions tested.
- File upload/download tested.
- Path traversal and filesystem boundary protections tested.
- Different-network remote access tested.

## 8. Current limitation

The relay's live Agent registry is in memory and is currently designed for a single relay process. Horizontal scaling needs sticky routing or shared coordination.
