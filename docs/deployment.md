# AFDrive — Deployment

## AFDrive Online (the `web/` relay + public app)

Deploy `web/` as a standard long-running Node.js process — it needs a
persistent process (not a serverless function) because it holds live
Socket.IO connections from Agents in memory.

1. `cd web && npm install`
2. Copy `.env.example` to `.env` and fill in:
   - `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`
     from your Supabase project settings.
   - `SESSION_SECRET` — a long random string.
   - `PUBLIC_BASE_URL` — the public HTTPS URL you'll deploy this to.
3. Run `docs/supabase_schema.sql` once in the Supabase SQL editor.
4. Put a TLS-terminating reverse proxy or platform load balancer in
   front of it (Render, Fly.io, Railway, a VPS with Caddy/nginx, etc.)
   — `app.set("trust proxy", 1)` is already set in `server.js` so
   `req.ip`/`req.secure` are correct behind one.
5. `npm start` (or a process manager: `pm2 start server.js`,
   systemd, a Docker container — any of these are fine since it's a
   normal Node HTTP server).

Socket.IO needs WebSocket upgrade support at every layer in front of
it — if you're behind a load balancer, confirm it passes through
`Upgrade`/`Connection` headers (most modern platforms do by default;
older nginx configs sometimes need `proxy_set_header Upgrade $http_upgrade;`
added explicitly).

## AFDrive Agent

Runs anywhere Python 3.9+ and Flask can run — the LAN-only mode is
identical to the original project.

**Linux / macOS / Windows**
```
cd agent
python -m venv venv && source venv/bin/activate   # Windows: venv\Scripts\activate
pip install -r requirements.txt
cp .env.example .env   # edit as needed
python app.py
```

**Android / Termux** (unchanged from the original AFDrive workflow)
```
pkg install python
pip install -r requirements.txt
python app.py
```

### Going online

1. From your AFDrive Online dashboard, click **Register a new
   storage** to get a pairing code (valid 10 minutes, single use).
2. On the device: `python setup_cli.py pair <CODE>`
3. Set `AFDRIVE_ONLINE_ENABLED=true` and `AFDRIVE_RELAY_URL` in `.env`.
4. Restart the Agent: `python app.py`. Check `python setup_cli.py status`
   to confirm the device identity was saved.
5. Toggle public/private and manage access from the dashboard at any
   time — no Agent restart needed for that part (see
   `agent_settings_changed` in `shared/protocol.md`).

If the internet connection drops, or `AFDRIVE_ONLINE_ENABLED` is left
`false`, the Agent still serves the LAN exactly as before at
`http://<device-LAN-IP>:<AFDRIVE_PORT>` — online mode is strictly
additive.

## Environment variable reference

| Variable | Component | Purpose |
|---|---|---|
| `AFDRIVE_USERNAME` / `AFDRIVE_PASSWORD` | Agent | Local AFDrive login |
| `AFDRIVE_STORAGE_PATH` | Agent | Directory exposed as storage |
| `AFDRIVE_SECRET_KEY` | Agent | Flask session signing key |
| `AFDRIVE_ONLINE_ENABLED` | Agent | Master switch for the tunnel |
| `AFDRIVE_RELAY_URL` | Agent | Where to connect the tunnel |
| `AFDRIVE_PUBLIC` | Agent | Initial public/private state |
| `AFDRIVE_PAIRING_CODE` | Agent | First-run pairing (optional; can use `setup_cli.py` instead) |
| `SUPABASE_URL` / `SUPABASE_ANON_KEY` / `SUPABASE_SERVICE_ROLE_KEY` | Web | Backend metadata store |
| `SESSION_SECRET` | Web | Cookie/session signing |
| `PUBLIC_BASE_URL` | Web | Used for building absolute links |

## Testing before you deploy

```
# Agent
cd agent && pip install -r requirements.txt && pytest tests/

# Web
cd web && npm install && npm test
```

See `docs/security.md` before making any storage public.
