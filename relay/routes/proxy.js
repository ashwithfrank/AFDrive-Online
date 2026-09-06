"use strict";

const { randomUUID } = require("crypto");
const express = require("express");
const { supabaseService, getUserFromToken } = require("../lib/supabase");
const registry = require("../lib/proxyRegistry");

const router = express.Router();

const HOP_BY_HOP = new Set(["host", "connection", "content-length", "cookie2"]);
const BODY_METHODS = new Set(["POST", "PUT", "PATCH"]);

function bearerToken(req) {
  const header = req.headers.authorization || "";
  const [scheme, token] = header.split(" ");
  if (scheme && scheme.toLowerCase() === "bearer") return token;
  // Fallback for plain top-level navigations (e.g. "Open in new tab"),
  // which can't attach an Authorization header. The static site appends
  // this for private storages so the browser's own file-manager tab is
  // a normal same-site context with the Agent (avoiding third-party
  // cookie restrictions an <iframe> embed would hit). Supabase access
  // tokens are short-lived, but this still means a copied link works
  // until it expires — see docs/architecture-pages-split.md, "Known
  // limitations", for the hardening path (short-lived relay_sessions
  // instead of the raw token).
  if (typeof req.query.access_token === "string") return req.query.access_token;
  return null;
}

/**
 * Decide whether the current caller may reach this server at all, and
 * with what role. This is the OUTER authorization layer described in
 * docs/security.md — it answers "may this browser talk to this Agent,
 * and as what", not "is this browser logged into AFDrive itself" (that
 * second question is still answered entirely by the Agent's own login
 * route, forwarded through unchanged).
 *
 * NOTE: the resolved role is forwarded to the Agent as a header so the
 * Agent can enforce it. As of this pass the Agent's own Flask routes do
 * not yet branch on that header — see docs/architecture-pages-split.md,
 * "Known limitation", before relying on read-only being enforced.
 */
async function resolveAccess(server, req) {
  const token = bearerToken(req);
  const user = token ? await getUserFromToken(token) : null;

  if (user && user.id === server.owner_id) {
    return { allowed: true, role: "owner", userId: user.id };
  }

  if (user) {
    const { data: grant } = await supabaseService
      .from("access_grants")
      .select("role, expires_at, revoked_at")
      .eq("server_id", server.id)
      .eq("user_id", user.id)
      .is("revoked_at", null)
      .maybeSingle();

    if (grant && !(grant.expires_at && new Date(grant.expires_at) < new Date())) {
      return { allowed: true, role: grant.role, userId: user.id };
    }
  }

  if (server.is_public) {
    return { allowed: true, role: "read", userId: user ? user.id : null };
  }

  return { allowed: false, role: null, userId: user ? user.id : null };
}

router.all("/s/:serverId/*", async (req, res) => {
  const { serverId } = req.params;

  const { data: server, error } = await supabaseService
    .from("servers")
    .select("id, owner_id, is_public, revoked_at, display_name")
    .eq("id", serverId)
    .maybeSingle();

  if (error || !server || server.revoked_at) {
    return res.status(404).json({ ok: false, error: "That storage doesn't exist." });
  }

  const access = await resolveAccess(server, req);
  if (!access.allowed) {
    return res.status(403).json({
      ok: false,
      error: "You don't have access to this storage. Ask the owner to share it with you.",
    });
  }

  const socket = registry.getAgentSocket(serverId);
  if (!socket) {
    return res.status(503).json({
      ok: false,
      error: `${server.display_name} is currently offline. Try again once the device is online.`,
    });
  }

  const reqId = randomUUID();
  const forwardPath = "/" + (req.params[0] || "");
  // Never forward our own auth query param to the Agent — it's not part
  // of that Agent's own URL space and shouldn't leak into its logs,
  // rendered links, or Referrer headers.
  const forwardQuery = new URLSearchParams(req.query);
  forwardQuery.delete("access_token");
  const query = forwardQuery.toString();

  const headers = {};
  for (const [key, value] of Object.entries(req.headers)) {
    if (!HOP_BY_HOP.has(key.toLowerCase())) headers[key] = value;
  }
  headers["x-forwarded-for"] = req.ip;
  headers["x-afdrive-relay"] = "1";
  // Resolved once here, server-side, from data the caller cannot forge —
  // never trust a client-supplied role header for this.
  headers["x-afdrive-role"] = access.role;

  const hasBody = BODY_METHODS.has(req.method) || Number(req.headers["content-length"]) > 0;

  registry.beginRequest(reqId, res, serverId);

  socket.emit("http_request", {
    req_id: reqId,
    method: req.method,
    path: forwardPath,
    query,
    headers,
    has_body: hasBody,
  });

  if (hasBody) {
    // Stream the browser's request body straight through as it arrives
    // — never buffered fully in this process, however large the upload.
    req.on("data", (chunk) => {
      socket.emit("http_request_body_chunk", { req_id: reqId, data: chunk });
    });
    req.on("end", () => {
      socket.emit("http_request_body_end", { req_id: reqId });
    });
    req.on("error", () => {
      socket.emit("http_request_body_end", { req_id: reqId });
    });
  }

  res.on("close", () => {
    // Browser navigated away / cancelled a download mid-stream — stop
    // tracking the request so a late chunk from the Agent doesn't throw.
    registry.endRequest(reqId);
  });
});

module.exports = router;
