"use strict";

const bcrypt = require("bcryptjs");
const { supabaseService } = require("../lib/supabase");
const registry = require("../lib/proxyRegistry");

/**
 * Wires up the Socket.IO server that Agents (agent/tunnel_client.py)
 * connect to. See shared/protocol.md for the exact message contract —
 * this file and that file must always agree.
 */
function attachAgentSocketHandlers(io) {
  io.use(async (socket, next) => {
    const { device_id: deviceId, device_secret: deviceSecret } = socket.handshake.auth || {};

    if (!deviceId || !deviceSecret) {
      return next(new Error("device_id and device_secret are required"));
    }

    const { data: server, error } = await supabaseService
      .from("servers")
      .select("id, device_secret_hash, revoked_at")
      .eq("id", deviceId)
      .maybeSingle();

    // Deliberately generic failure for both "no such device" and "wrong
    // secret" — never let a connection attempt reveal which one it was.
    if (error || !server || server.revoked_at) {
      return next(new Error("Authentication failed"));
    }

    const valid = await bcrypt.compare(deviceSecret, server.device_secret_hash);
    if (!valid) {
      return next(new Error("Authentication failed"));
    }

    socket.data.serverId = server.id;
    socket.data.deviceId = deviceId;
    next();
  });

  io.on("connection", async (socket) => {
    const { serverId, deviceId } = socket.data;
    const { public: isPublic, display_name: displayName } = socket.handshake.auth || {};

    registry.registerAgent(serverId, deviceId, socket);

    const updates = { status: "online", last_seen_at: new Date().toISOString() };
    if (typeof isPublic === "boolean") updates.is_public = isPublic;
    if (displayName) updates.display_name = displayName;

    await supabaseService.from("servers").update(updates).eq("id", serverId);
    await supabaseService.from("audit_log").insert({
      server_id: serverId,
      event: "agent_connected",
      detail: { socket_id: socket.id },
    });

    socket.on("disconnect", async () => {
      registry.unregisterAgent(serverId, socket.id);
      await supabaseService
        .from("servers")
        .update({ status: "offline", last_seen_at: new Date().toISOString() })
        .eq("id", serverId);
      await supabaseService.from("audit_log").insert({
        server_id: serverId,
        event: "agent_disconnected",
      });
    });

    // -- Response side of the HTTP proxy protocol ------------------------

    socket.on("http_response_start", ({ req_id: reqId, status, headers }) => {
      const entry = registry.getRequest(reqId);
      if (!entry) return; // browser already gave up / request timed out
      entry.res.status(status || 502);
      for (const [key, value] of Object.entries(headers || {})) {
        if (["content-length", "transfer-encoding", "connection"].includes(key.toLowerCase())) {
          continue;
        }
        if (key.toLowerCase() === "set-cookie") {
          // The Agent's Flask session cookie is scoped Path=/ by default,
          // which would leak across every registered server sharing this
          // domain. Rewrite it to only apply under this server's own
          // proxy prefix, and force Secure since the relay is HTTPS-only.
          const rewritten = (Array.isArray(value) ? value : [value]).map((cookie) =>
            cookie
              .replace(/;?\s*Path=[^;]*/i, "")
              .concat(`; Path=/s/${entry.serverId}`)
              .concat(cookie.toLowerCase().includes("secure") ? "" : "; Secure")
          );
          entry.res.setHeader("Set-Cookie", rewritten);
          continue;
        }
        try {
          entry.res.setHeader(key, value);
        } catch {
          // Ignore invalid header values rather than crashing the request.
        }
      }
      entry.headersSent = true;
    });

    socket.on("http_response_chunk", ({ req_id: reqId, data }) => {
      const entry = registry.getRequest(reqId);
      if (!entry) return;
      entry.res.write(Buffer.isBuffer(data) ? data : Buffer.from(data || ""));
    });

    socket.on("http_response_end", ({ req_id: reqId }) => {
      const entry = registry.getRequest(reqId);
      if (!entry) return;
      entry.res.end();
      registry.endRequest(reqId);
    });
  });
}

module.exports = { attachAgentSocketHandlers };
