import { CONFIG } from "./config.js";
import { getAccessToken } from "./supabaseClient.js";

/** Low-level fetch to the relay's file-manager proxy for one storage.
 *  `path` is the path *inside* that Agent's own routes, e.g. "/", "/api/list?...".
 *  Returns the raw Response so callers can stream bodies (downloads) or
 *  parse JSON (API calls) as appropriate. */
export async function proxyFetch(serverId, path, options = {}) {
  const token = await getAccessToken();
  const headers = new Headers(options.headers || {});
  if (token) headers.set("Authorization", `Bearer ${token}`);
  const url = `${CONFIG.RELAY_URL}/s/${serverId}${path}`;
  return fetch(url, { ...options, headers });
}

async function adminAction(path, options = {}) {
  const token = await getAccessToken();
  const headers = new Headers(options.headers || {});
  headers.set("Authorization", `Bearer ${token}`);
  if (options.body) headers.set("Content-Type", "application/json");
  const res = await fetch(`${CONFIG.RELAY_URL}${path}`, { ...options, headers });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.ok === false) {
    throw new Error(data.error || `Request failed (${res.status})`);
  }
  return data;
}

/** Immediately disconnects a currently-online Agent and marks it revoked. */
export function revokeServer(serverId) {
  return adminAction(`/api/servers/${serverId}/revoke`, { method: "POST" });
}

/** Toggles public/private and pushes the change live if the Agent is connected. */
export function togglePublic(serverId) {
  return adminAction(`/api/servers/${serverId}/toggle-public`, { method: "POST" });
}

/** Best-effort live presence check for a set of server ids, straight from
 *  the relay's in-memory socket registry (fallback — the `servers.status`
 *  column read via Supabase is normally sufficient and lower-latency). */
export async function checkPresence(serverIds) {
  const res = await fetch(`${CONFIG.RELAY_URL}/api/servers/presence?ids=${serverIds.join(",")}`);
  const data = await res.json().catch(() => ({ presence: {} }));
  return data.presence || {};
}
