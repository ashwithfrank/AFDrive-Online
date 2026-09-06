# AFDrive Online

**Your Personal Cloud. Your Device. Your Files.**

AFDrive Online is the online extension of [AFDrive](https://github.com/ashwithfrank/AFDrive).
It lets an AFDrive Agent running on your PC, laptop, server, or Android/Termux device make selected local storage available to authorized remote users.

> **AFDrive Online is not traditional cloud storage.**
> Your files stay on the device running the Agent.

## Architecture

AFDrive Online is split into three parts:

```text
Remote Browser
     │ HTTPS
     ▼
GitHub Pages (/site)
     │
     ├──────────► Supabase
     │             Auth + metadata + permissions
     │
     ▼
Relay (/relay)
     │ WebSocket tunnel
     ▼
AFDrive Agent (/agent)
     │
     ▼
Your local files
```

### Components

- **`site/`** — static public web app deployed to GitHub Pages. It handles login, storage discovery/listing, management, access grants, and opening remote storages.
- **`relay/`** — long-running Node.js service that maintains Agent connections and proxies remote file-manager traffic. GitHub Pages cannot run this process.
- **`agent/`** — Python/Flask AFDrive Agent. It runs on the device that owns the files and can continue to work in local/LAN mode without Online Mode.
- **`shared/`** — protocol documentation shared by the Agent and relay.
- **`docs/`** — architecture, deployment, security, and Supabase schema documentation.

## How It Works

The Agent makes an outbound connection to the relay. This avoids requiring users to expose the Agent directly to the internet or configure router port forwarding in the normal setup.

Supabase is the **single central backend** for the AFDrive Online service. Users do not create their own Supabase projects.

Supabase stores service metadata such as:

- User accounts
- Storage registrations
- Storage ownership
- Access permissions
- Pairing information
- Agent identity and related metadata

**Actual files are not stored in Supabase.**

## Local Mode

AFDrive can still be used as a normal local-network file server.

```text
http://DEVICE-IP:5000
```

Local Mode does not require an AFDrive Online account or internet connection.

## Online Mode

Online Mode connects the Agent to the AFDrive Online relay:

```text
Your Device
    ↓
AFDrive Agent
    ↓ outbound WebSocket
AFDrive Online Relay
    ↓ HTTPS
Remote Browser
```

The relay is required for the current remote transport architecture. The relay does not permanently store your files, but it is a trusted transit point and can observe file bytes while they are being transported.

## Features

### Original AFDrive functionality

The Agent retains the original AFDrive functionality, including:

- File and folder browsing
- Breadcrumb navigation
- Folder creation
- Rename and delete
- Recursive search
- Sorting
- Multi-file upload
- Streaming downloads
- Image, text, and PDF previews
- Storage statistics
- Recent files
- Responsive UI
- Light/dark mode
- Path traversal protection
- Symlink escape protection

### Online functionality

- Supabase authentication
- Multiple storages per account
- Storage pairing
- Online/offline Agent presence
- Public/private storage visibility
- Access grants
- Read/read-write access roles
- Remote file-manager proxying
- GitHub Pages deployment for the static web app

## Project Structure

```text
AFDrive-Online/
│
├── agent/
│   ├── app.py
│   ├── config.py
│   ├── database.py
│   ├── fs_utils.py
│   ├── identity.py
│   ├── setup_cli.py
│   ├── tunnel_client.py
│   ├── requirements.txt
│   ├── .env.example
│   ├── storage/
│   ├── templates/
│   ├── static/
│   └── tests/
│
├── relay/
│   ├── server.js
│   ├── package.json
│   ├── .env.example
│   ├── lib/
│   ├── routes/
│   └── tests/
│
├── site/
│   ├── index.html
│   ├── login.html
│   ├── register.html
│   ├── storages.html
│   ├── directory.html
│   ├── filemanager.html
│   ├── access.html
│   ├── settings.html
│   ├── 404.html
│   └── assets/
│
├── shared/
│   └── protocol.md
│
├── docs/
│   ├── architecture.md
│   ├── deployment.md
│   ├── security.md
│   └── supabase_schema.sql
│
├── .github/workflows/
│   └── deploy-pages.yml
│
├── .gitignore
└── README.md
```

## Requirements

### Agent

- Python 3.9+
- Flask and dependencies from `agent/requirements.txt`
- A directory to expose as AFDrive storage
- Internet connection only for Online Mode

### Relay

- Node.js 18+
- npm
- A publicly reachable HTTPS/WSS endpoint
- A Supabase project

### Web App

The web app is static and requires no Node server when deployed to GitHub Pages. It communicates with Supabase and the deployed relay.

## Quick Start — Agent

```bash
cd agent
python -m venv venv
```

### Linux / macOS

```bash
source venv/bin/activate
pip install -r requirements.txt
cp .env.example .env
python app.py
```

### Windows

```powershell
.\venv\Scripts\Activate.ps1
pip install -r requirements.txt
Copy-Item .env.example .env
python app.py
```

### Android / Termux

```bash
pkg install python
pip install -r requirements.txt
cp .env.example .env
python app.py
```

For local mode, configure `AFDRIVE_STORAGE_PATH` and the local credentials in `.env`.

## Current Agent CLI

The current CLI is a small setup utility:

```bash
cd agent
python setup_cli.py status
python setup_cli.py pair <PAIRING_CODE>
python setup_cli.py unpair
```

Pairing exchanges a one-time dashboard code for the Agent's device credentials.

After pairing, enable Online Mode in `agent/.env`:

```env
AFDRIVE_ONLINE_ENABLED=true
AFDRIVE_RELAY_URL=https://YOUR-RELAY.example.com
```

Then restart the Agent.

> The current repository does **not** yet provide a full account-management CLI. Account registration/login and storage management are currently handled by the web application and pairing flow.

## Supabase Setup

Create **one central Supabase project** for AFDrive Online.

Then run:

```text
SQL Editor → docs/supabase_schema.sql
```

The browser uses only the public/anon key. Never expose the Supabase service-role key in `site/` or commit it to Git.

## Static Site Configuration

Edit:

```text
site/assets/js/config.js
```

with the public Supabase URL/key and deployed relay URL.

Example:

```javascript
export const CONFIG = {
  SUPABASE_URL: "https://YOUR-PROJECT.supabase.co",
  SUPABASE_ANON_KEY: "YOUR-ANON-KEY",
  RELAY_URL: "https://YOUR-RELAY.example.com",
};
```

Only public configuration belongs here.

## Relay Deployment

The relay must run as a persistent Node.js process. It cannot run on GitHub Pages.

```bash
cd relay
npm install
cp .env.example .env
npm start
```

Configure the relay environment with:

- `SUPABASE_URL`
- `SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`
- `ALLOWED_ORIGINS`
- `PORT`

Use HTTPS/WSS in production.

See [`docs/deployment.md`](docs/deployment.md) for the complete deployment procedure.

## GitHub Pages Deployment

The GitHub Actions workflow in:

```text
.github/workflows/deploy-pages.yml
```

deploys the `site/` directory.

In GitHub:

1. Open **Settings → Pages**.
2. Set the source to **GitHub Actions**.
3. Push changes to `main`.
4. GitHub Actions publishes the static site.

The relay remains separately deployed.

## Testing

### Agent

```bash
cd agent
pip install -r requirements.txt
pytest tests/
```

### Relay

```bash
cd relay
npm install
npm test
```

Also run:

```bash
git diff --check
```

Before public use, test the complete flow with a non-sensitive test directory and devices on different networks.

## Security

Read [`docs/security.md`](docs/security.md) before exposing a storage publicly.

Important rules:

- Expose only directories you intentionally want AFDrive to manage.
- Never expose an operating-system root such as `C:\` or `/`.
- Use HTTPS/WSS in production.
- Keep Supabase service-role credentials server-side only.
- Keep relay secrets out of Git.
- Treat the relay as trusted infrastructure because it can observe file bytes in transit.

## Documentation

- [`docs/architecture.md`](docs/architecture.md) — system design and component boundaries
- [`docs/deployment.md`](docs/deployment.md) — Supabase, relay, Agent, and GitHub Pages deployment
- [`docs/security.md`](docs/security.md) — security model and operational precautions
- [`docs/supabase_schema.sql`](docs/supabase_schema.sql) — database schema and RLS policies
- [`shared/protocol.md`](shared/protocol.md) — Agent/relay communication protocol

## Related Project

Original local-network AFDrive:

https://github.com/ashwithfrank/AFDrive

Online version:

https://github.com/ashwithfrank/AFDrive-Online

## License

See the repository license for licensing information.

---

**AFDrive — Your Personal Cloud. Your Device. Your Files.**
