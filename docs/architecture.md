# AFDrive — Architecture

## Two components, one philosophy

AFDrive Online never becomes your storage provider. It exists to answer
three questions for a browser: *which storages exist, who's allowed to
open one, and how do I reach the device that's actually holding it.*
Every byte of file content still flows directly between your browser
and the owning Agent — the relay only ever sees it in transit, the same
way any reverse proxy does.

```
Your Device                          AFDrive Online                    Remote Browser
┌────────────────┐                  ┌──────────────────┐               ┌──────────────┐
│ AFDrive Agent   │  outbound WSS    │ Relay (Socket.IO) │   HTTPS       │ Browser      │
│ (Flask, unchanged│ ───────────────▶│  + Express web app│◀─────────────│              │
│  routes/fs_utils)│                 │  + Supabase (meta) │              │              │
│                 │                  └──────────────────┘               └──────────────┘
│ Local filesystem │
└────────────────┘
```

The Agent only ever makes *outbound* connections. It never listens for
inbound internet traffic. This is what makes NAT/CGNAT and "no port
forwarding" possible: the relay is reachable, the Agent reaches out to
it, and the relay routes browser requests down that same connection.

## Why a generic HTTP-over-WebSocket proxy, not a rewrite

The existing AFDrive Flask app already has a correct, tested security
model for filesystem access (`fs_utils.safe_join_storage`, session
auth, CSRF-safe forms). Rather than re-implementing upload/download/
rename/search/preview against a new API surface, the tunnel forwards
raw HTTP requests to the Agent's own loopback Flask server and streams
the response back unmodified. Every existing route works remotely with
zero duplicated logic — see `shared/protocol.md` for the exact message
format, and `agent/tunnel_client.py` / `web/routes/agentSocket.js` +
`web/routes/proxy.js` for the two ends of it.

Both uploads and downloads are streamed in fixed-size chunks in both
directions — a multi-gigabyte file is never fully buffered in the
relay's or the Agent's memory (see `_body_generator` /
`_forward_request` in `tunnel_client.py`, and the `data`/`end` handlers
in `web/routes/proxy.js`).

## Why Supabase (Postgres) over Firestore

Every piece of metadata AFDrive Online needs is inherently relational
with real foreign keys and cascading deletes: a server belongs to one
owner, an access grant belongs to one server and optionally one user, a
pairing code is consumed by exactly one registration. Postgres' foreign
keys and `CHECK` constraints enforce these invariants at the database
level rather than in application code, and Row Level Security lets the
dashboard's own Supabase queries be scoped to "servers I own" without
the relay needing to re-derive that on every read. Supabase Auth also
gives us email/password accounts, session tokens, and admin user
creation out of the box — see `docs/supabase_schema.sql`.

Firestore would work for a pure key-value "device status" cache, but
would need denormalized duplicate writes (or a second database) the
moment you need "all grants for this server" and "all servers this
user can access" to both be cheap, consistent queries.

## Component boundaries

- `agent/` — unchanged AFDrive Flask app, plus `identity.py` (device
  registration/credentials), `tunnel_client.py` (the outbound proxy
  client), `setup_cli.py` (pairing wizard). Runs standalone with
  `AFDRIVE_ONLINE_ENABLED=false` exactly like the original project.
- `web/` — the relay + public web app, as one Node/Express process.
  Owns the Socket.IO server Agents connect to, the public directory,
  the owner dashboard, and Supabase Auth-backed accounts.
- `shared/protocol.md` — the wire contract between the two. Change one
  side, update this file and the other side together.

## Known limitations (V1, documented rather than hidden)

- **Single relay process.** `web/lib/proxyRegistry.js` is in-memory. If
  you horizontally scale the relay, either use sticky sessions keyed on
  `server_id` or replace the registry with a shared pub/sub store.
- **Access grants by email before signup.** `access_grants.invited_email`
  is not yet automatically linked to `user_id` the moment that person
  creates an account — for V1 this requires a small follow-up job or a
  "claim my invites on first login" check in `routes/auth.js`.
- **No resumable uploads yet.** The chunked-streaming design in
  `shared/protocol.md` was built so resumability could be layered on
  later (each chunk is already ordered and independently forwardable)
  without changing the wire format, but resume-after-interruption isn't
  implemented in this pass.
- **Session refresh.** The relay account cookie holds a Supabase access
  token directly and isn't refreshed automatically; a user is logged
  out after that token's normal expiry rather than staying signed in
  indefinitely. See `routes/auth.js`.
