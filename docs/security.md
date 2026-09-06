# AFDrive — Security model

Exposing personal storage to the internet is a real risk. Only mark a
storage **public** if you intend for strangers to be able to attempt to
log into it, and only grant **access** to people you actually trust
with those files. AFDrive Online's job is to make that an informed,
revocable choice — not to make the risk disappear.

## Trust boundaries

There are three distinct boundaries, and it matters which one is
answering which question:

1. **Relay-level authorization** (`relay/routes/proxy.js`,
   `authorizeAccess`): *may this browser talk to this Agent at all?*
   Public servers: yes, always. Private servers: only the owner, or
   someone with a non-revoked, non-expired row in `access_grants`.
2. **Agent-level authentication** (unchanged from the original AFDrive):
   *is this browser logged into the AFDrive account on this specific
   device?* Still a separate username/password, still Werkzeug
   password hashing, still a Flask session cookie — forwarded through
   the tunnel unchanged.
3. **Filesystem-level safety** (unchanged `fs_utils.py`): *does this
   specific path resolve inside the storage root?* Every path is
   `os.path.realpath`-checked against the storage root; symlinks that
   would escape it are skipped in listings; the same code path runs
   whether the request arrived over LAN or through the tunnel.

A request has to clear all three before it touches a file. Compromising
one layer (e.g. a leaked share link) does not bypass the other two.

## Device identity and secrets

- Pairing codes (`pairing_codes.code`) are single-use, expire in 10
  minutes, and are only ever exchanged for a device_secret once (see
  `routes/agentRegister.js`). A leaked pairing code is worthless after
  first use or after 10 minutes.
- `device_secret` is generated with `crypto.randomBytes(32)`, shown to
  the Agent exactly once, and stored on the relay only as a bcrypt hash
  (`servers.device_secret_hash`). The Agent stores its own copy locally
  at `instance/device_identity.json` with `0o600` permissions.
- Only one live tunnel connection per `device_id` is allowed
  (`proxyRegistry.registerAgent`) — a second connection attempt forcibly
  disconnects the first, so a stolen secret can't quietly ride alongside
  the legitimate device.
- Revoking a device (`/dashboard/servers/:id/revoke`) sets
  `revoked_at`, which the Socket.IO auth middleware checks on every new
  connection attempt, and immediately force-disconnects any currently
  open socket for that device.

## Session cookies across multiple Agents on one domain

A naive proxy would let one Agent's `Set-Cookie: session=...; Path=/`
leak onto every other server hosted under the same relay domain. The
relay rewrites every `Set-Cookie` from an Agent to `Path=/s/<server_id>`
and forces `Secure` before it ever reaches the browser (see
`http_response_start` in `relay/routes/agentSocket.js`) — one storage's
session cookie is never sent to another.

## Transport security

- Browser ↔ relay: HTTPS/WSS in production (`AFDRIVE_FORCE_HTTPS` on the
  Agent, and deploy the relay itself behind TLS — see
  `docs/deployment.md`).
- Agent ↔ relay: the tunnel itself should run over `wss://` in
  production (`AFDRIVE_RELAY_URL=https://...`). The relay is a genuine
  trust boundary — it can see request metadata (paths, headers) for
  every forwarded request even though it doesn't retain file bytes. Treat
  compromise of the relay process as equivalent to compromise of a
  reverse proxy in front of every registered Agent, and scope who can
  deploy/operate it accordingly.

## Application-layer protections already in place

- Rate limiting on `/login` and `/api/agent/register` (`express-rate-limit`).
- `helmet()` security headers on every relay response; the Agent keeps
  its own strict CSP on every LAN/tunnel response (`app.py`,
  `set_security_headers`).
- Generic error messages on both login surfaces (relay account login
  and the Agent's own login) — never reveal whether an email/username
  exists.
- Input validation: filenames go through `fs_utils.sanitize_name`
  (strips path separators, control characters, reserved Windows device
  names); every path goes through `safe_join_storage` before any
  filesystem call.
- No debug mode by default (`AFDRIVE_DEBUG=false`); Flask's `SECRET_KEY`
  is either explicitly set or generated once and persisted with `0o600`
  permissions rather than regenerated on every restart (which would
  invalidate all sessions).
- Upload size is bounded (`MAX_CONTENT_LENGTH` on the Agent); the relay
  never buffers a full upload before forwarding it (see
  `docs/architecture.md`).
- Logging never includes passwords, device secrets, or file contents —
  `audit_log.detail` is limited to structural metadata like socket IDs.

## What you still need to decide as an operator

- Whether a given storage should be public or private at all.
- Who gets `read` vs `read_write` access grants, and for how long
  (`access_grants.expires_at` supports temporary access today; the
  dashboard UI for setting an expiry is a natural next addition).
- Rotating a device's credentials periodically by revoking and
  re-pairing, especially for a storage you've made public.

If you find a security issue in this project, treat it the way you
would any other software vulnerability report — this document describes
intended behavior, not a guarantee of freedom from bugs.
