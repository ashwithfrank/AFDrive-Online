# AFDrive Online — Architecture

## Overview

AFDrive Online keeps the user's files on the device running the AFDrive Agent. The online service provides authentication, storage metadata, permissions, pairing, presence, and a remote transport path.

```text
                 ┌─────────────────────┐
                 │     GitHub Pages    │
                 │       /site         │
                 │  Static Web App     │
                 └─────────┬───────────┘
                           │
                    HTTPS / Supabase
                           │
             ┌─────────────┴─────────────┐
             │                           │
       ┌─────▼─────┐               ┌─────▼─────┐
       │ Supabase  │               │   Relay   │
       │ Auth + DB │               │ /relay    │
       └───────────┘               └─────┬─────┘
                                         │ WSS
                                         ▼
                                  ┌─────────────┐
                                  │ AFDrive     │
                                  │ Agent       │
                                  │ /agent      │
                                  └──────┬──────┘
                                         │
                                         ▼
                                  Local filesystem
```

## Why the relay is separate

GitHub Pages serves static files and cannot maintain the persistent Node.js process required for Agent WebSocket connections. The relay therefore runs separately on infrastructure that supports long-lived HTTP/WebSocket connections.

The relay is not the storage provider. It routes browser requests to connected Agents. It is nevertheless a trusted transit point and can observe file bytes while they are in transit.

## Supabase

The project uses one central Supabase project for the AFDrive Online service.

Supabase handles:

- Authentication
- User accounts
- Storage metadata
- Ownership
- Access grants
- Pairing data
- Agent identity metadata
- Audit/diagnostic metadata where configured

Actual file contents remain on the Agent device.

## Site

`site/` is a static multi-page frontend intended for GitHub Pages.

It communicates directly with Supabase using the browser-safe anon/publishable key and communicates with the relay only for operations that require the live Agent tunnel.

## Relay

`relay/` provides:

- Persistent Socket.IO connections from Agents
- Agent registration/pairing endpoints
- Live Agent presence tracking
- Authorization checks for remote storage access
- Remote browser-to-Agent HTTP proxying
- Live Agent administration actions where required

The relay does not render the public frontend.

## Agent

`agent/` contains the Flask-based AFDrive server plus Online Mode support.

The Agent:

- Owns the actual filesystem access.
- Makes the outbound connection to the relay.
- Handles local/LAN requests.
- Handles remote tunneled requests.
- Applies filesystem safety checks.
- Enforces Agent-side authorization rules implemented by the current code.

## Remote request flow

```text
Browser
  │
  │ HTTPS
  ▼
Relay
  │
  │ authenticated tunnel
  ▼
Agent
  │
  ▼
AFDrive route
  │
  ▼
Filesystem
```

Uploads and downloads are streamed rather than intentionally buffering entire files in memory.

## Pairing

A storage is created/registered in the online service and a short-lived pairing code is issued. The Agent exchanges the one-time code with the relay and receives persistent device credentials that are stored locally.

The pairing code is not intended to be a permanent Agent credential.

## Permissions

The service distinguishes storage ownership and access grants. Remote access is authorized before a request is sent to an Agent, and Agent-side checks provide an additional enforcement layer.

The exact roles and policies are defined in `docs/supabase_schema.sql` and the relay/Agent implementation.

## Presence

The relay maintains the currently connected Agent registry in memory. Online status shown to the web application is based on the live relay connection rather than merely trusting a database status field.

Current limitation: the registry is single-process. Multiple relay instances require sticky routing or shared coordination.

## Local mode

The Agent can continue running without Online Mode:

```text
Browser on LAN
      │
      ▼
AFDrive Agent
      │
      ▼
Local filesystem
```

This mode does not depend on GitHub Pages, Supabase, or the relay.
