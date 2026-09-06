"use strict";

/**
 * Process-local state for the tunnel relay. Deliberately in-memory and
 * not persisted anywhere: if this process restarts, every Agent simply
 * reconnects (they retry with backoff — see agent/tunnel_client.py) and
 * every in-flight request fails cleanly with a 502, which is the
 * correct behavior for a relay that must never be a source of truth.
 *
 * NOTE: this file assumes a single relay process. If you ever run more
 * than one relay instance behind a load balancer, either use sticky
 * sessions keyed on server_id, or replace this module with a shared
 * store (e.g. Redis pub/sub) that can route an http_request to whichever
 * instance actually holds that Agent's socket.
 */

// server_id -> socket.io Socket
const agentsByServerId = new Map();
// device_id -> server_id (so a reconnecting device can be found/replaced)
const serverIdByDeviceId = new Map();
// req_id -> { res: ExpressResponse, headersSent: boolean, timeout: Timeout }
const pendingRequests = new Map();

const REQUEST_TIMEOUT_MS = 120_000;

function registerAgent(serverId, deviceId, socket) {
  const existing = agentsByServerId.get(serverId);
  if (existing && existing.id !== socket.id) {
    // Enforce "only one live tunnel per device" — see shared/protocol.md.
    existing.disconnect(true);
  }
  agentsByServerId.set(serverId, socket);
  serverIdByDeviceId.set(deviceId, serverId);
}

function unregisterAgent(serverId, socketId) {
  const current = agentsByServerId.get(serverId);
  if (current && current.id === socketId) {
    agentsByServerId.delete(serverId);
  }
}

function getAgentSocket(serverId) {
  return agentsByServerId.get(serverId) || null;
}

function isAgentOnline(serverId) {
  return agentsByServerId.has(serverId);
}

function beginRequest(reqId, res, serverId) {
  const entry = { res, headersSent: false, serverId };
  entry.timeout = setTimeout(() => {
    if (!entry.headersSent) {
      res.status(504).json({ ok: false, error: "The storage device did not respond in time." });
    } else {
      res.end();
    }
    pendingRequests.delete(reqId);
  }, REQUEST_TIMEOUT_MS);
  pendingRequests.set(reqId, entry);
  return entry;
}

function getRequest(reqId) {
  return pendingRequests.get(reqId) || null;
}

function endRequest(reqId) {
  const entry = pendingRequests.get(reqId);
  if (entry) {
    clearTimeout(entry.timeout);
    pendingRequests.delete(reqId);
  }
}

module.exports = {
  registerAgent,
  unregisterAgent,
  getAgentSocket,
  isAgentOnline,
  beginRequest,
  getRequest,
  endRequest,
};
