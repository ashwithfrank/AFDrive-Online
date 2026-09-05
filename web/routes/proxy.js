"use strict";

const { randomUUID } = require("crypto");
const express = require("express");
const { supabaseService } = require("../lib/supabase");
const { getUserFromToken } = require("../lib/supabase");
const registry = require("../lib/proxyRegistry");

const router = express.Router();

const HOP_BY_HOP = new Set(["host", "connection", "content-length", "cookie2"]);
const BODY_METHODS = new Set(["POST", "PUT", "PATCH"]);

/**
 * Decide whether the current relay-authenticated user (if any) is
 * allowed to reach this server at all. This is the OUTER authorization
 * layer described in docs/security.md — it answers "may this browser
 * talk to this Agent", not "is this browser logged into AFDrive itself"
 * (that second question is still answered entirely by the Agent's own
 * login route, forwarded through unchanged).
 */
async function authorizeAccess(server, req) {
  if (server.is_public) return true;

  const token = req.cookies?.afd_sess;
  const user = await getUserFromToken(token);
  if (!user) return false;

  if (user.id === server.owner_id) return true;

  const { data: grant } = await supabaseService
    .from("access_grants")
    .select("id, expires_at, revoked_at")
    .eq("server_id", server.id)
    .eq("user_id", user.id)
    .is("revoked_at", null)
    .maybeSingle();

  if (!grant) return false;
  if (grant.expires_at && new Date(grant.expires_at) < new Date()) return false;
  return true;
}

router.all("/s/:serverId/*", async (req, res) => {
  const { serverId } = req.params;

  const { data: server, error } = await supabaseService
    .from("servers")
    .select("id, owner_id, is_public, revoked_at, display_name")
    .eq("id", serverId)
    .maybeSingle();

  if (error || !server || server.revoked_at) {
    return res.status(404).render("error", { code: 404, message: "That storage doesn't exist." });
  }

  const allowed = await authorizeAccess(server, req);
  if (!allowed) {
    return res.status(403).render("error", {
      code: 403,
      message: "You don't have access to this storage. Ask the owner to share it with you.",
    });
  }

  const socket = registry.getAgentSocket(serverId);
  if (!socket) {
    return res.status(503).render("error", {
      code: 503,
      message: `${server.display_name} is currently offline. Try again once the device is online.`,
    });
  }

  const reqId = randomUUID();
  const forwardPath = "/" + (req.params[0] || "");
  const query = req.originalUrl.includes("?") ? req.originalUrl.split("?").slice(1).join("?") : "";

  const headers = {};
  for (const [key, value] of Object.entries(req.headers)) {
    if (!HOP_BY_HOP.has(key.toLowerCase())) headers[key] = value;
  }
  headers["x-forwarded-for"] = req.ip;
  headers["x-afdrive-relay"] = "1";

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
