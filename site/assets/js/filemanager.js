import { supabase, requireSession, getAccessToken } from "./supabaseClient.js";
import { CONFIG } from "./config.js";

const session = await requireSession();
if (!session) throw new Error("redirecting");

const params = new URLSearchParams(location.search);
const serverId = params.get("id");
const errorEl = document.getElementById("error-msg");

function showError(err) {
  errorEl.textContent = err.message || String(err);
  errorEl.hidden = false;
}

if (!serverId) {
  showError(new Error("No storage specified."));
  throw new Error("missing id");
}

const { data: server, error } = await supabase
  .from("servers")
  .select("id, owner_id, display_name, is_public, status, last_seen_at, revoked_at")
  .eq("id", serverId)
  .maybeSingle();

if (error || !server || server.revoked_at) {
  document.getElementById("server-name").textContent = "Storage not found";
  showError(new Error("This storage doesn't exist, has been revoked, or you don't have access to it."));
  throw new Error("not found");
}

document.getElementById("server-name").textContent = server.display_name;

const online = server.status === "online";
document.getElementById("status-dot").classList.toggle("online", online);
document.getElementById("status-text").textContent = online ? "Online" : "Offline";
if (server.last_seen_at) {
  document.getElementById("last-seen").textContent = `Last seen ${new Date(server.last_seen_at).toLocaleString()}`;
}

// Resolve role for display only — the relay re-resolves it authoritatively
// server-side on every request, so this label can never grant more than
// the relay actually allows.
let role = "read";
if (server.owner_id === session.user.id) {
  role = "owner";
} else {
  const { data: grant } = await supabase
    .from("access_grants")
    .select("role")
    .eq("server_id", serverId)
    .eq("user_id", session.user.id)
    .is("revoked_at", null)
    .maybeSingle();
  if (grant) role = grant.role;
}

const roleLabels = { owner: "Owner (full access)", read_write: "Read/write", read: "Read only" };
document.getElementById("role-badge").textContent = roleLabels[role] || role;
document.getElementById("role-badge").classList.add(role);
document.getElementById("role-explain").textContent =
  role === "read"
    ? "you can browse, search, preview, and download, but not upload, delete, rename, or create folders"
    : "you can browse, search, preview, download, upload, delete, rename, and create folders";

if (online) {
  document.getElementById("details").hidden = false;
  const token = await getAccessToken();
  const url = new URL(`${CONFIG.RELAY_URL}/s/${serverId}/`);
  // A plain <a target="_blank"> navigation can't carry an Authorization
  // header, so private storages need the token in the URL instead — see
  // relay/routes/proxy.js for the tradeoffs of that fallback.
  if (!server.is_public) url.searchParams.set("access_token", token);
  document.getElementById("open-btn").href = url.toString();
} else {
  document.getElementById("offline-banner").hidden = false;
}
