"use strict";

const express = require("express");
const { supabaseService, getUserFromToken } = require("../lib/supabase");
const registry = require("../lib/proxyRegistry");

const router = express.Router();

function bearerToken(req) {
  const header = req.headers.authorization || "";
  const [scheme, token] = header.split(" ");
  return scheme && scheme.toLowerCase() === "bearer" ? token : null;
}

async function requireOwnedServer(req, res) {
  const user = await getUserFromToken(bearerToken(req));
  if (!user) {
    res.status(401).json({ ok: false, error: "Sign in required." });
    return null;
  }
  const { data: server } = await supabaseService
    .from("servers")
    .select("id, owner_id, is_public, revoked_at")
    .eq("id", req.params.id)
    .eq("owner_id", user.id)
    .maybeSingle();
  if (!server) {
    res.status(404).json({ ok: false, error: "Storage not found." });
    return null;
  }
  return server;
}

// POST /api/servers/:id/toggle-public
// The static site could also write is_public directly via supabase-js
// (RLS already allows the owner to). This endpoint exists only to push
// the change live to a *currently connected* Agent without waiting for
// its next heartbeat/reconnect.
router.post("/api/servers/:id/toggle-public", express.json(), async (req, res) => {
  const server = await requireOwnedServer(req, res);
  if (!server) return;

  const newValue = !server.is_public;
  await supabaseService.from("servers").update({ is_public: newValue }).eq("id", server.id);

  const socket = registry.getAgentSocket(server.id);
  if (socket) socket.emit("agent_settings_changed", { is_public: newValue });

  res.json({ ok: true, is_public: newValue });
});

// POST /api/servers/:id/revoke
// Sets revoked_at (also settable directly by the owner via RLS) AND
// forcibly disconnects the live tunnel immediately, rather than waiting
// for the Agent's socket to fail its next reconnect auth check.
router.post("/api/servers/:id/revoke", async (req, res) => {
  const server = await requireOwnedServer(req, res);
  if (!server) return;

  await supabaseService
    .from("servers")
    .update({ revoked_at: new Date().toISOString() })
    .eq("id", server.id);

  const socket = registry.getAgentSocket(server.id);
  if (socket) socket.disconnect(true);

  await supabaseService.from("audit_log").insert({
    server_id: server.id,
    user_id: server.owner_id,
    event: "server_revoked",
  });

  res.json({ ok: true });
});

// GET /api/servers/presence?ids=a,b,c
// The `servers.status` column is already kept accurate in real time by
// routes/agentSocket.js on every connect/disconnect, so the static site
// can normally just read it straight from Supabase (optionally via a
// Realtime subscription for live updates). This endpoint exists only as
// a fallback that consults this process's own in-memory socket registry
// directly, for the rare case where a process restart left a stale row
// between an Agent's disconnect and its next reconnect attempt.
router.get("/api/servers/presence", (req, res) => {
  const ids = String(req.query.ids || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const presence = {};
  for (const id of ids) presence[id] = registry.isAgentOnline(id);
  res.json({ ok: true, presence });
});

module.exports = router;
