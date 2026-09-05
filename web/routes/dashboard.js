"use strict";

const crypto = require("crypto");
const express = require("express");
const { supabaseService } = require("../lib/supabase");
const registry = require("../lib/proxyRegistry");
const { requireUser } = require("./auth");

const router = express.Router();
router.use(requireUser);
router.use(express.urlencoded({ extended: false }));

function generatePairingCode() {
  // Short, human-typeable, avoids ambiguous characters (0/O, 1/I).
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "";
  for (let i = 0; i < 8; i++) {
    code += alphabet[crypto.randomInt(alphabet.length)];
  }
  return code;
}

router.get("/", async (req, res) => {
  const { data: servers } = await supabaseService
    .from("servers")
    .select("id, display_name, is_public, status, last_seen_at, created_at")
    .eq("owner_id", req.user.id)
    .is("revoked_at", null)
    .order("created_at", { ascending: false });

  const enriched = (servers || []).map((s) => ({
    ...s,
    reallyOnline: registry.isAgentOnline(s.id), // in-memory truth beats a stale DB row
  }));

  res.render("dashboard", { user: req.user, servers: enriched, pairing: null });
});

router.post("/pairing-code", async (req, res) => {
  const code = generatePairingCode();
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();

  await supabaseService.from("pairing_codes").insert({
    code,
    owner_id: req.user.id,
    expires_at: expiresAt,
  });

  const { data: servers } = await supabaseService
    .from("servers")
    .select("id, display_name, is_public, status, last_seen_at, created_at")
    .eq("owner_id", req.user.id)
    .is("revoked_at", null)
    .order("created_at", { ascending: false });

  res.render("dashboard", {
    user: req.user,
    servers: (servers || []).map((s) => ({ ...s, reallyOnline: registry.isAgentOnline(s.id) })),
    pairing: { code, expiresAt },
  });
});

async function loadOwnedServer(req, res) {
  const { data: server } = await supabaseService
    .from("servers")
    .select("id, owner_id")
    .eq("id", req.params.id)
    .eq("owner_id", req.user.id)
    .maybeSingle();
  if (!server) {
    res.status(404).render("error", { code: 404, message: "Storage not found." });
    return null;
  }
  return server;
}

router.post("/servers/:id/toggle-public", async (req, res) => {
  const server = await loadOwnedServer(req, res);
  if (!server) return;

  const { data: current } = await supabaseService
    .from("servers")
    .select("is_public")
    .eq("id", server.id)
    .single();

  const newValue = !current.is_public;
  await supabaseService.from("servers").update({ is_public: newValue }).eq("id", server.id);

  const socket = registry.getAgentSocket(server.id);
  if (socket) socket.emit("agent_settings_changed", { is_public: newValue });

  res.redirect("/dashboard");
});

router.post("/servers/:id/revoke", async (req, res) => {
  const server = await loadOwnedServer(req, res);
  if (!server) return;

  await supabaseService
    .from("servers")
    .update({ revoked_at: new Date().toISOString() })
    .eq("id", server.id);

  const socket = registry.getAgentSocket(server.id);
  if (socket) socket.disconnect(true); // credential is now dead — cut the tunnel immediately

  await supabaseService.from("audit_log").insert({
    server_id: server.id,
    user_id: req.user.id,
    event: "server_revoked",
  });

  res.redirect("/dashboard");
});

// -- Access grants for a private server --------------------------------

router.get("/servers/:id/access", async (req, res) => {
  const server = await loadOwnedServer(req, res);
  if (!server) return;

  const { data: fullServer } = await supabaseService
    .from("servers")
    .select("id, display_name, is_public")
    .eq("id", server.id)
    .single();

  const { data: grants } = await supabaseService
    .from("access_grants")
    .select("id, invited_email, role, expires_at, created_at")
    .eq("server_id", server.id)
    .is("revoked_at", null)
    .order("created_at", { ascending: false });

  res.render("access", { server: fullServer, grants: grants || [], error: null });
});

router.post("/servers/:id/access", async (req, res) => {
  const server = await loadOwnedServer(req, res);
  if (!server) return;

  const { email, role } = req.body;
  if (!email || !["read", "read_write"].includes(role)) {
    return res.status(400).render("access", {
      server: { id: server.id },
      grants: [],
      error: "A valid email and role are required.",
    });
  }

  // If the invited email already has an account, link the grant to their
  // user_id directly; otherwise it's activated the first time they sign
  // in with that email (left as a documented V1 follow-up — see
  // docs/architecture.md, "Known limitations").
  await supabaseService.from("access_grants").insert({
    server_id: server.id,
    invited_email: email.trim().toLowerCase(),
    role,
  });

  res.redirect(`/dashboard/servers/${server.id}/access`);
});

router.post("/servers/:id/access/:grantId/revoke", async (req, res) => {
  const server = await loadOwnedServer(req, res);
  if (!server) return;

  await supabaseService
    .from("access_grants")
    .update({ revoked_at: new Date().toISOString() })
    .eq("id", req.params.grantId)
    .eq("server_id", server.id);

  res.redirect(`/dashboard/servers/${server.id}/access`);
});

module.exports = router;
