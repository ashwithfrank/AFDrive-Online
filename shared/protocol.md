# AFDrive Agent ↔ Online protocol

This document is the single source of truth for the wire format used
between `agent/tunnel_client.py` and `relay/routes/agentSocket.js` +
`relay/lib/proxyRegistry.js`. If you change one side, update this file and
the other side in the same commit.

There are two separate channels:

1. A plain HTTPS **registration** call (one-time, per device).
2. A persistent **Socket.IO connection** (the tunnel itself), used for
   both liveness/presence and for proxying HTTP requests.

## 1. Registration — `POST /api/agent/register`

Called once by `identity.py` when an Agent has a pairing code but no
saved device identity yet.

Request body:
```json
{
  "pairing_code": "6-char-code-from-dashboard",
  "display_name": "My AFDrive",
  "device_hint": "Linux · pixel-7-termux",
  "client_nonce": "uuid4-hex"
}
```

Response (200):
```json
{ "device_id": "uuid", "device_secret": "opaque-random-string" }
```

The relay stores only a hash of `device_secret` (e.g. bcrypt/argon2),
never the plaintext, and marks `pairing_code` as consumed so it can't be
replayed. Any other status code is treated as a hard failure — the Agent
does not retry automatically (the operator has to obtain a fresh code).

## 2. Tunnel connection (Socket.IO)

Agent connects with:
```js
io(RELAY_URL, {
  auth: {
    device_id: "...",
    device_secret: "...",
    public: true|false,
    display_name: "My AFDrive"
  },
  transports: ["websocket"]
})
```

The relay's `connect` middleware:
- Looks up `device_id`, verifies `device_secret` against the stored
  hash, rejects with `connect_error` on any mismatch (generic message —
  never reveal whether the device_id existed).
- On success, joins the socket to room `agent:<server_id>`, updates
  `servers.status = 'online'`, `servers.last_seen = now()` in Supabase,
  and stores `{socketId -> serverId}` in the in-memory `proxyRegistry`.
- On `disconnect`, marks the server offline and removes the mapping.

Only one live connection per device is allowed; a second connection
with the same `device_id` replaces the first (the old socket is
force-disconnected) so a leaked/rotated secret can't hold two tunnels
open simultaneously.

### 2a. Relay → Agent: `http_request`

Emitted once per inbound browser request that has already passed the
relay's own access check (public server, or authenticated user with a
grant — see `docs/security.md`).

```json
{
  "req_id": "uuid",
  "method": "GET",
  "path": "/api/download/vacation.jpg",
  "query": "sort=name",
  "headers": { "Cookie": "afdrive_session=...", "Accept": "*/*" },
  "body": "<raw bytes, present only for POST/PUT with a body>"
}
```

`headers` never includes hop-by-hop headers (`Host`, `Connection`,
`Content-Length`) — the Agent recomputes those locally.

For requests **without** a body (GET, most DELETE/etc.), `http_request`
is the only event needed before the Agent starts its local call.

For requests **with** a body (uploads, POST/PUT), the relay does not
buffer the browser's upload before forwarding it — it starts emitting
as soon as bytes arrive from the browser:

```json
{ "req_id": "uuid", "data": "<raw bytes chunk, <=256KB>" }
// event: http_request_body_chunk (zero or more, in order)

{ "req_id": "uuid" }
// event: http_request_body_end (exactly once, after http_request)
```

The Agent starts its local HTTP call as soon as `http_request` arrives,
streaming the body through to `requests` from an internal queue fed by
`http_request_body_chunk` — so a multi-gigabyte upload is never fully
buffered in memory on the relay *or* the Agent.

### 2b. Agent → Relay: streamed response

Three events per request, always in this order, always for every
request (even errors):

```json
// 1. Once
{ "req_id": "uuid", "status": 200, "headers": { "Content-Type": "..." } }
// event: http_response_start

// 2. Zero or more, in order
{ "req_id": "uuid", "data": "<raw bytes chunk, <=256KB>" }
// event: http_response_chunk

// 3. Exactly once, terminates the request
{ "req_id": "uuid" }
// event: http_response_end
```

The relay buffers nothing beyond a single in-flight chunk per request —
each `http_response_chunk` is written straight to the browser's HTTP
response as it arrives, so a large file download never sits fully in
either the Agent's or the relay's memory.

If the Agent-side local request to its own Flask app fails outright
(local server down, etc.), it still emits the same three events with
`status: 502` and a short plain-text body — the relay never needs a
separate "error" event type.

### 2c. Relay → Agent: `agent_settings_changed`

Best-effort, fire-and-forget notification when the owner flips
public/private from the dashboard, so the Agent's local status view can
reflect it without waiting for a reconnect. The relay is still the
source of truth for enforcement — this event is informational only.
