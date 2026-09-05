# AFDrive

Your Personal Cloud. Your Device. Your Files.

AFDrive turns a device you already own — an old phone running Termux, a
spare laptop, a home server — into your own personal cloud, and now
optionally lets you (and people you authorize) reach it from anywhere,
without ever moving your files off that device.

## Two modes, one codebase

- **Local mode** (the original AFDrive): run the Agent, open
  `http://<device-LAN-IP>:5000` from any device on the same Wi-Fi. No
  internet dependency, nothing to register, works exactly as it always
  has.
- **Online mode** (new): the same Agent also opens a secure outbound
  connection to **AFDrive Online**, a small separate web app that
  handles discovery, login, and routing so authorized people can reach
  your Agent from the public internet — still without your files ever
  leaving your device, and without forwarding a single port on your
  router.

## Architecture

```
AFDrive/
├── agent/     — the Flask app that runs on YOUR device (unchanged core + tunnel)
├── web/       — the public web app + relay (Node/Express + Socket.IO + Supabase)
├── shared/    — the protocol contract between agent/ and web/
└── docs/      — architecture, security, deployment, and the Supabase schema
```

See `docs/architecture.md` for why it's split this way and why Supabase
was chosen for metadata, `docs/security.md` for the full threat model,
and `docs/deployment.md` for exact setup steps.

## Quick start — local mode only

```
cd agent
pip install -r requirements.txt
cp .env.example .env      # set AFDRIVE_USERNAME / AFDRIVE_PASSWORD
python app.py
```

Open `http://localhost:5000` (or your device's LAN IP from another
device on the same network).

## Quick start — adding online access

1. Deploy `web/` somewhere (see `docs/deployment.md`) and run
   `docs/supabase_schema.sql` against a Supabase project once.
2. Create an account and click **Register a new storage** on your
   AFDrive Online dashboard to get a pairing code.
3. On your device: `cd agent && python setup_cli.py pair <CODE>`
4. Set `AFDRIVE_ONLINE_ENABLED=true` in `agent/.env`, restart the Agent.
5. Toggle public/private and manage who else has access from the
   dashboard.

**Only mark a storage public if you intend for anyone to be able to
attempt to log into it.** Read `docs/security.md` before you do.

## What's preserved from the original project

Every original AFDrive feature works identically, whether reached over
LAN or through the tunnel: login/logout, password hashing, protected
routes, path-traversal and symlink-escape protection, folder browsing,
breadcrumbs, folder create/rename/delete, recursive search, sorting,
multi-file upload with progress, duplicate-safe filenames, streaming
downloads, image/text/PDF previews, storage usage stats, recent files,
light/dark mode, a responsive mobile-first UI, and the same security
headers on every response.

## What's new

- An Agent identity system (`agent/identity.py`) and pairing flow
  (`agent/setup_cli.py`) for connecting a device to AFDrive Online.
- A generic, streaming HTTP-over-WebSocket tunnel
  (`agent/tunnel_client.py`) so every existing route works remotely
  without duplicating any business logic.
- A public storage directory with search, a per-server access-grant
  model (owner / read-only / read-write / temporary / revocable), and
  an owner dashboard — all in `web/`.
- A Supabase (Postgres) schema for accounts, servers, access grants,
  pairing codes, and an audit log — metadata only, never file contents
  or listings (`docs/supabase_schema.sql`).

## Testing

```
cd agent && pytest tests/       # path safety, auth, route protection
cd web && npm test               # relay registry / request correlation logic
```

## Troubleshooting

- **Agent won't reconnect to Online** — check `AFDRIVE_RELAY_URL` and
  that outbound WebSocket connections aren't blocked by a firewall;
  `agent/tunnel_client.py` retries with exponential backoff on its own.
- **"This storage is currently offline"** in the browser — the Agent's
  tunnel isn't connected right now; `python setup_cli.py status` on the
  device shows its current state.
- **Lost access to a device** — revoke it from the dashboard and
  re-pair with `setup_cli.py pair <new code>`; the old device_secret
  stops working immediately.
