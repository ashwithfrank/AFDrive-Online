import { supabase, requireSession, signOut } from "./supabaseClient.js";
import { revokeServer, togglePublic } from "./relayClient.js";

const session = await requireSession();
if (!session) throw new Error("redirecting");

const listEl = document.getElementById("storage-list");
const emptyEl = document.getElementById("empty-state");
const errorEl = document.getElementById("error-msg");
const template = document.getElementById("storage-card-template");

document.getElementById("logout-link").addEventListener("click", (e) => {
  e.preventDefault();
  signOut();
});

function showError(err) {
  errorEl.textContent = err.message || String(err);
  errorEl.hidden = false;
}

const PAIRING_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no 0/O, 1/I
function generateCode() {
  let code = "";
  for (let i = 0; i < 8; i++) {
    code += PAIRING_ALPHABET[Math.floor(Math.random() * PAIRING_ALPHABET.length)];
  }
  return code;
}

document.getElementById("pair-btn").addEventListener("click", async () => {
  errorEl.hidden = true;
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();

  // Retry on the astronomically unlikely case of a code collision
  // (`code` is the primary key).
  for (let attempt = 0; attempt < 3; attempt++) {
    const code = generateCode();
    const { error } = await supabase
      .from("pairing_codes")
      .insert({ code, owner_id: session.user.id, expires_at: expiresAt });
    if (!error) {
      document.getElementById("pairing-code").textContent = code;
      document.getElementById("pairing-box").hidden = false;
      return;
    }
    if (error.code !== "23505") { // not a unique-violation — a real problem
      return showError(error);
    }
  }
  showError(new Error("Could not generate a unique pairing code. Try again."));
});

function renderServer(server) {
  const node = template.content.cloneNode(true);
  const li = node.querySelector(".storage-card");
  li.dataset.id = server.id;

  const online = server.status === "online";
  node.querySelector(".status-dot").classList.toggle("online", online);

  const nameLink = node.querySelector(".storage-name");
  nameLink.textContent = server.display_name;

  const meta = node.querySelector(".storage-meta");
  meta.textContent = `${online ? "Online" : "Offline"} · ${server.is_public ? "Public" : "Private"}`;

  const openBtn = node.querySelector(".open-btn");
  openBtn.href = `filemanager.html?id=${server.id}`;
  if (!online) {
    openBtn.classList.add("btn-danger");
    openBtn.textContent = "Offline";
  }

  node.querySelector(".access-btn").href = `access.html?id=${server.id}`;

  const toggleBtn = node.querySelector(".toggle-btn");
  toggleBtn.textContent = server.is_public ? "Make private" : "Make public";
  toggleBtn.addEventListener("click", async () => {
    toggleBtn.disabled = true;
    try {
      await togglePublic(server.id);
      await loadServers();
    } catch (err) {
      showError(err);
    } finally {
      toggleBtn.disabled = false;
    }
  });

  node.querySelector(".rename-btn").addEventListener("click", async () => {
    const name = prompt("New name for this storage:", server.display_name);
    if (!name || !name.trim()) return;
    const { error } = await supabase
      .from("servers")
      .update({ display_name: name.trim().slice(0, 80) })
      .eq("id", server.id);
    if (error) return showError(error);
    await loadServers();
  });

  node.querySelector(".revoke-btn").addEventListener("click", async () => {
    if (!confirm(`Revoke "${server.display_name}"? Its Agent will be disconnected immediately and it must be re-paired to come back online.`)) return;
    try {
      await revokeServer(server.id);
      await loadServers();
    } catch (err) {
      showError(err);
    }
  });

  node.querySelector(".remove-btn").addEventListener("click", async () => {
    if (!confirm(`Permanently remove "${server.display_name}"? This deletes its pairing history and access grants and cannot be undone.`)) return;
    const { error } = await supabase.from("servers").delete().eq("id", server.id);
    if (error) return showError(error);
    await loadServers();
  });

  return node;
}

async function loadServers() {
  errorEl.hidden = true;
  const { data, error } = await supabase
    .from("servers")
    .select("id, display_name, is_public, status, last_seen_at, created_at")
    .eq("owner_id", session.user.id)
    .is("revoked_at", null)
    .order("created_at", { ascending: false });

  if (error) return showError(error);

  listEl.innerHTML = "";
  emptyEl.hidden = data.length > 0;
  for (const server of data) {
    listEl.appendChild(renderServer(server));
  }
}

await loadServers();

// Live updates: reflect an Agent connecting/disconnecting without a
// manual refresh. Falls back gracefully to the loaded snapshot if
// Realtime isn't reachable.
supabase
  .channel("owned-servers")
  .on(
    "postgres_changes",
    { event: "*", schema: "public", table: "servers", filter: `owner_id=eq.${session.user.id}` },
    () => loadServers()
  )
  .subscribe();
