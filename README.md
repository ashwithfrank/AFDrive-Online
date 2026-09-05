# AFDrive Online

**Your Personal Cloud. Your Device. Your Files.**

AFDrive Online is the online extension of [AFDrive](https://github.com/ashwithfrank/AFDrive).

It allows you to run AFDrive on your own device — such as a PC, laptop, home server, or Android phone with Termux — and optionally make that storage accessible over the internet.

Your files remain on the device running the AFDrive Agent. AFDrive Online provides the public web interface, account management, storage discovery, authentication, and secure communication between the remote browser and your Agent.

> **AFDrive Online is not traditional cloud storage.**
>
> Your device provides the storage. AFDrive Online provides the connection.

---

## How It Works

AFDrive Online has two main components:

```text
┌──────────────────────┐
│   Your Storage       │
│                      │
│  PC / Laptop /       │
│  Android / Server    │
│                      │
│  AFDrive Agent       │
│       │              │
│       │ Secure       │
│       │ connection   │
└───────┼──────────────┘
        │
        ▼
┌──────────────────────┐
│   AFDrive Online     │
│                      │
│  Public Web App      │
│  Authentication      │
│  Storage Directory   │
│  Relay                │
│                      │
│  Supabase             │
│  (metadata only)     │
└───────┬──────────────┘
        │
        │ HTTPS
        ▼
┌──────────────────────┐
│   Remote Browser     │
│                      │
│  Browse your files   │
│  Upload / Download   │
│  Manage storage      │
└──────────────────────┘
```

The Agent makes the connection **outbound** to AFDrive Online. This means the system is designed so that users do not need to expose their home server directly to the internet or configure router port forwarding.

---

# Local Mode and Online Mode

AFDrive supports two modes.

### Local Mode

This is the original AFDrive experience.

Run the Agent on your device and access it from another device connected to the same network:

```text
http://DEVICE-IP:5000
```

Example:

```text
http://192.168.1.42:5000
```

No internet connection or online account is required.

### Online Mode

Online mode adds remote access:

```text
Your Device
    ↓
AFDrive Agent
    ↓
AFDrive Online
    ↓
Internet
    ↓
Remote Browser
```

You can optionally register your storage with AFDrive Online and make it discoverable to other users.

---

# Features

## Original AFDrive Features

AFDrive Online preserves the main functionality of the original AFDrive project:

* 🔐 Login and logout
* 🔑 Password hashing
* 📁 File and folder browsing
* 📂 Folder creation
* ✏️ Rename files and folders
* 🗑️ Delete files and folders
* 🔎 Recursive file search
* ↕️ Sorting by name, size, and date
* 📤 Multi-file uploads
* 📊 Upload progress
* ♻️ Duplicate-safe filenames
* 📥 Streaming downloads
* 🖼️ Image previews
* 📄 Text previews
* 📕 PDF previews
* 💾 Storage usage information
* 🕒 Recent files
* 🌙 Light and dark mode
* 📱 Responsive mobile-first interface
* 🛡️ Path traversal protection
* 🛡️ Symlink escape protection
* 🛡️ Security headers

The original AFDrive reads file information directly from the filesystem rather than storing file contents in its database.

---

# Online Features

AFDrive Online adds:

* 🌐 Public web application
* 🔎 Public storage discovery
* 👤 Online user accounts
* 🖥️ Storage/server registration
* 🔗 Agent pairing
* 🟢 Online/offline storage status
* 🔐 Remote authentication
* 👥 Storage access permissions
* 🔒 Private storage support
* 📤 Remote uploads
* 📥 Remote downloads
* 🔄 Secure Agent connection
* 📊 Owner dashboard
* 📝 Online activity/audit information

The central database stores **metadata**, not your actual files.

---

# Project Structure

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
│   │
│   ├── storage/
│   │   └── user_files/
│   │
│   ├── templates/
│   ├── static/
│   └── tests/
│
├── web/
│   ├── server.js
│   ├── package.json
│   ├── .env.example
│   │
│   ├── lib/
│   ├── routes/
│   ├── views/
│   ├── public/
│   └── tests/
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
└── README.md
```

### `agent/`

Runs on the device that actually stores the files.

It contains the original Flask-based AFDrive server plus the online Agent functionality.

### `web/`

The public AFDrive Online application.

It contains:

* Web interface
* Authentication
* Storage directory
* Owner dashboard
* Relay server
* Agent connection handling

### `shared/`

Contains the communication protocol shared between the Agent and Online service.

### `docs/`

Contains architecture, deployment, security, and database documentation.

---

# Requirements

## AFDrive Agent

The Agent requires:

* Python 3.9+
* Flask
* Internet connection for Online Mode
* A directory to use as AFDrive storage

It can be used on supported:

* Linux
* Windows
* macOS
* Android / Termux

Local Mode does not require an internet connection.

---

## AFDrive Online Web App

The online web application requires:

* Node.js
* npm
* A Supabase project
* A publicly reachable HTTPS deployment for remote use

The web server uses Socket.IO to maintain live connections with Agents, so the deployment must support persistent WebSocket connections.

---

# 1. Set Up AFDrive Online

Clone the repository:

```bash
git clone https://github.com/ashwithfrank/AFDrive-Online.git
cd AFDrive-Online
```

---

# 2. Create a Supabase Project

Create a new project on Supabase.

The Supabase database is used for AFDrive Online metadata such as:

* User accounts
* Registered storages
* Agent identities
* Access permissions
* Pairing information
* Audit information

Your actual files are **not stored in Supabase**.

---

# 3. Create the Database

Open the Supabase SQL Editor.

Run:

```text
docs/supabase_schema.sql
```

This creates the database structure required by AFDrive Online.

---

# 4. Configure the Web App

Go to:

```bash
cd web
```

Install dependencies:

```bash
npm install
```

Create the environment file:

```bash
cp .env.example .env
```

On Windows, you can simply create a `.env` file by copying `.env.example`.

Edit `.env`:

```env
PORT=8080
NODE_ENV=development

PUBLIC_BASE_URL=http://localhost:8080

SUPABASE_URL=https://YOUR-PROJECT.supabase.co
SUPABASE_ANON_KEY=YOUR-ANON-KEY
SUPABASE_SERVICE_ROLE_KEY=YOUR-SERVICE-ROLE-KEY

SESSION_SECRET=YOUR-LONG-RANDOM-SECRET

LOGIN_RATE_LIMIT_PER_15MIN=20
REGISTER_RATE_LIMIT_PER_15MIN=10
```

### Important

Never commit `.env` to GitHub.

The Supabase service-role key must remain **server-side only**.

Never place it inside:

```text
web/public/
```

or any browser-side JavaScript.

---

# 5. Start the Online Web App

Run:

```bash
npm start
```

The server should start on:

```text
http://localhost:8080
```

Open that address in your browser.

At this point you are running the AFDrive Online web application locally.

---

# 6. Configure the AFDrive Agent

Open another terminal.

From the project root:

```bash
cd agent
```

Create a Python virtual environment:

### Linux / macOS

```bash
python3 -m venv venv
source venv/bin/activate
```

### Windows

```powershell
python -m venv venv
venv\Scripts\activate
```

Install dependencies:

```bash
pip install -r requirements.txt
```

Create the Agent configuration:

```bash
cp .env.example .env
```

Configure the important values:

```env
AFDRIVE_USERNAME=admin
AFDRIVE_PASSWORD=your-strong-password

AFDRIVE_STORAGE_PATH=./storage/user_files

AFDRIVE_HOST=0.0.0.0
AFDRIVE_PORT=5000

AFDRIVE_DEBUG=false

AFDRIVE_ONLINE_ENABLED=false
AFDRIVE_RELAY_URL=http://localhost:8080
AFDRIVE_SERVER_NAME=My AFDrive
AFDRIVE_PUBLIC=false
```

---

# 7. Test Local Mode First

Before enabling Online Mode, make sure the original AFDrive functionality works.

Run:

```bash
python app.py
```

Open:

```text
http://localhost:5000
```

Log in using the credentials configured in `.env`.

If accessing from another device on the same network:

```text
http://YOUR-DEVICE-IP:5000
```

Make sure file browsing, uploads, downloads, folders, and authentication work correctly.

---

# 8. Pair the Agent with AFDrive Online

Once the Online web app is running, use its dashboard to register a storage.

The dashboard should provide a **pairing code** for the new Agent.

On the device running AFDrive:

```bash
cd agent
python setup_cli.py pair YOUR_PAIRING_CODE
```

The pairing process establishes the Agent's online identity.

After pairing, the Agent stores its identity locally so the device does not need to be paired every time it starts.

Check the status with:

```bash
python setup_cli.py status
```

---

# 9. Enable Online Mode

Edit:

```text
agent/.env
```

Change:

```env
AFDRIVE_ONLINE_ENABLED=true
```

Set the relay URL to the address of your AFDrive Online server:

```env
AFDRIVE_RELAY_URL=http://localhost:8080
```

For a deployed server, this will be your public HTTPS address.

For example:

```env
AFDRIVE_RELAY_URL=https://your-afdrive-domain.example
```

Then start the Agent:

```bash
python app.py
```

The Agent should connect to the AFDrive Online relay.

---

# 10. Make Your Storage Public

After the Agent successfully connects:

1. Open the AFDrive Online dashboard.
2. Find your registered storage.
3. Give the storage a name if necessary.
4. Enable public discovery if you want it listed publicly.
5. Configure who can access it.
6. Save the changes.

Your storage should then appear in the public storage directory when it is online.

---

# Online Access Flow

Once everything is configured:

```text
                    AFDrive Online
                         │
                         │ HTTPS
                         ▼
                  ┌──────────────┐
                  │ Public Web   │
                  │ Application  │
                  └───────┬──────┘
                          │
                    Authenticated
                       request
                          │
                          ▼
                  ┌──────────────┐
                  │    Relay     │
                  └───────┬──────┘
                          │
                    Secure tunnel
                          │
                          ▼
                  ┌──────────────┐
                  │ AFDrive      │
                  │ Agent        │
                  └───────┬──────┘
                          │
                          ▼
                  ┌──────────────┐
                  │ Your Files   │
                  │ on your      │
                  │ device       │
                  └──────────────┘
```

The Agent remains the component that accesses the actual filesystem.

---

# Local Mode Without Internet

Online Mode is optional.

If:

```env
AFDRIVE_ONLINE_ENABLED=false
```

AFDrive continues to work as a local network cloud.

For example:

```text
Phone
  │
  │ Wi-Fi
  ▼
AFDrive Agent
  │
  ▼
Local storage
```

You can therefore use AFDrive even when the internet is unavailable.

---

# Production Deployment

For real public access, the `web/` application needs to be deployed to a server that supports:

* Node.js
* HTTPS
* Persistent processes
* WebSocket/Socket.IO connections

Possible deployment approaches include:

* VPS
* Docker
* A Node.js hosting platform
* Other infrastructure that supports long-running WebSocket applications

The public service should sit behind HTTPS.

Example:

```text
https://afdrive.example
```

Then configure the Agent:

```env
AFDRIVE_RELAY_URL=https://afdrive.example
```

See:

```text
docs/deployment.md
```

for deployment-specific information.

---

# Security

AFDrive Online can expose a computer's filesystem to remote users, so security is critical.

**Only expose directories that you intentionally want AFDrive to manage.**

Do not point AFDrive at:

```text
C:\
/
```

or another directory containing sensitive operating-system files.

Use a dedicated storage directory whenever possible.

AFDrive includes protections such as:

* Password hashing
* Protected routes
* Path traversal protection
* Symlink escape protection
* Secure file handling
* Streaming transfers
* Session protection
* Rate limiting
* Authentication and authorization
* Agent identity
* Pairing credentials
* Public/private storage controls

Before exposing a storage publicly, read:

```text
docs/security.md
```

---

# Supabase and File Storage

AFDrive Online uses Supabase for **online metadata**.

Conceptually:

```text
Supabase
├── Users
├── Storage registrations
├── Agent information
├── Access permissions
├── Pairing information
└── Audit information
```

Not:

```text
Supabase
└── All of your files
```

Your files remain on the device running the AFDrive Agent.

This keeps AFDrive different from conventional cloud-storage services where your files are uploaded to the provider's storage infrastructure.

---

# Testing

Before using Online Mode with important files, test the system with a separate test directory.

### Agent tests

```bash
cd agent
pytest tests/
```

### Web tests

```bash
cd web
npm test
```

Test at least:

* Login/logout
* Agent registration
* Pairing
* Agent connection
* Agent disconnection
* Public/private storage
* Access permissions
* File browsing
* Upload
* Download
* Rename
* Delete
* Folder creation
* Search
* Path traversal protection
* Symlink protection
* Large file transfers
* Expired/revoked access
* Offline Agent behavior

---

# Troubleshooting

### Agent does not connect

Check:

```env
AFDRIVE_ONLINE_ENABLED=true
AFDRIVE_RELAY_URL=...
```

Then check:

```bash
python setup_cli.py status
```

Also make sure the Online web server is running and reachable.

---

### Storage shows as offline

The Agent may not currently have an active connection to the Online relay.

Check the Agent terminal and:

```bash
python setup_cli.py status
```

---

### Pairing fails

Make sure the pairing code:

* Is correct
* Has not expired
* Has not already been used

Generate a new pairing code from the Online dashboard if necessary.

---

### Local mode stopped working

Online Mode should be additive.

Make sure:

```env
AFDRIVE_ONLINE_ENABLED=false
```

and run:

```bash
python app.py
```

The Agent should still be accessible through its local IP address.

---

# Current Architecture

AFDrive Online currently consists of:

```text
agent/
    Flask + Python
    Local filesystem
    Local authentication
    Online Agent identity
    WebSocket tunnel

web/
    Node.js
    Express
    Socket.IO
    Public web application
    Relay

Supabase
    Authentication
    PostgreSQL metadata
```

See:

```text
docs/architecture.md
```

for the detailed architecture and communication model.

---

# Roadmap

The online architecture is designed so additional features can be added without changing the fundamental storage model.

Possible future improvements include:

* Resumable uploads/downloads
* Better connection recovery
* Multiple storage devices per account
* More granular sharing permissions
* Shareable storage/file links
* QR-based sharing
* File version history
* Trash/recycle bin
* WebDAV support
* Automatic device backup
* Native Android application
* Native desktop Agent
* Peer-to-peer connections
* Optional cloud backup
* End-to-end encryption
* Storage synchronization

These features are planned ideas and should not be considered available unless implemented and documented.

---

# Why AFDrive?

Traditional cloud storage:

```text
Your Device
     ↓
Internet
     ↓
Cloud Provider
     ↓
Provider's Storage
```

AFDrive:

```text
Your Device
     ↓
AFDrive Agent
     ↓
Your Storage
```

AFDrive Online:

```text
Your Device
     ↓
AFDrive Agent
     ↓
Secure Online Connection
     ↓
Remote Browser
```

**The storage stays yours.**

---

# License

See the repository license for licensing information.

---

# Related Project

Original local-network AFDrive:

https://github.com/ashwithfrank/AFDrive

Online version:

https://github.com/ashwithfrank/AFDrive-Online

---

## AFDrive

**Your Personal Cloud. Your Device. Your Files.**
