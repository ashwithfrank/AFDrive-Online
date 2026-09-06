import { supabase, requireSession } from "./supabaseClient.js";

const session = await requireSession();
if (!session) throw new Error("redirecting");

const params = new URLSearchParams(location.search);
const serverId = params.get("id");
const errorEl = document.getElementById("error-msg");
const listEl = document.getElementById("grant-list");
const emptyEl = document.getElementById("empty-state");
const template = document.getElementById("grant-template");

function showError(err) {
  errorEl.textContent = err.message || String(err);
  errorEl.hidden = false;
}

if (!serverId) {
  showError(new Error("No storage specified."));
  throw new Error("missing id");
}

const { data: server, error: serverErr } = await supabase
  .from("servers")
  .select("id, display_name")
  .eq("id", serverId)
  .maybeSingle();

if (serverErr || !server) {
  document.getElementById("server-name").textContent = "Storage not found";
  showError(new Error("This storage doesn't exist, or you're not its owner."));
} else {
  document.getElementById("server-name").textContent = `Access — ${server.display_name}`;
}

async function loadGrants() {
  const { data, error } = await supabase
    .from("access_grants")
    .select("id, invited_email, role, expires_at, created_at")
    .eq("server_id", serverId)
    .is("revoked_at", null)
    .order("created_at", { ascending: false });

  if (error) return showError(error);

  listEl.innerHTML = "";
  emptyEl.hidden = data.length > 0;
  for (const grant of data) {
    const node = template.content.cloneNode(true);
    node.querySelector(".grant-email").textContent = grant.invited_email || "(linked account)";
    node.querySelector(".role-tag").textContent = grant.role === "read_write" ? "Read/write" : "Read only";
    node.querySelector(".revoke-grant-btn").addEventListener("click", async () => {
      const { error: revokeErr } = await supabase
        .from("access_grants")
        .update({ revoked_at: new Date().toISOString() })
        .eq("id", grant.id);
      if (revokeErr) return showError(revokeErr);
      await loadGrants();
    });
    listEl.appendChild(node);
  }
}

document.getElementById("grant-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  errorEl.hidden = true;
  const form = new FormData(e.target);
  const email = form.get("email").trim().toLowerCase();
  const role = form.get("role");

  // NOTE: this only takes effect immediately for an email that already
  // has an AFDrive account with a matching auth.users row and, today,
  // relies on the proxy's own lookup by user_id at request time (see
  // relay/routes/proxy.js). An invite for an email with no account yet
  // is stored but won't grant access until it's backfilled with a
  // user_id — that backfill is not implemented yet. See
  // docs/architecture-pages-split.md, "Known limitations".
  const { error } = await supabase
    .from("access_grants")
    .insert({ server_id: serverId, invited_email: email, role });

  if (error) return showError(error);
  e.target.reset();
  await loadGrants();
});

await loadGrants();
