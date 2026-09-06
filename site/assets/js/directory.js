import { supabase } from "./supabaseClient.js";

const listEl = document.getElementById("storage-list");
const emptyEl = document.getElementById("empty-state");
const template = document.getElementById("storage-card-template");
const searchInput = document.getElementById("search-input");

function render(servers) {
  listEl.innerHTML = "";
  emptyEl.hidden = servers.length > 0;
  for (const server of servers) {
    const node = template.content.cloneNode(true);
    const online = server.status === "online";
    node.querySelector(".status-dot").classList.toggle("online", online);
    const link = node.querySelector(".storage-name");
    link.textContent = server.display_name;
    link.href = `filemanager.html?id=${server.id}`;
    node.querySelector(".storage-meta").textContent = online
      ? "Online"
      : `Offline${server.last_seen_at ? " · last seen " + new Date(server.last_seen_at).toLocaleString() : ""}`;
    listEl.appendChild(node);
  }
}

async function search(q) {
  let query = supabase
    .from("servers")
    .select("id, display_name, status, last_seen_at")
    .eq("is_public", true)
    .is("revoked_at", null)
    .order("display_name", { ascending: true });

  if (q) query = query.ilike("display_name", `%${q}%`);

  const { data, error } = await query;
  if (error) {
    listEl.innerHTML = "";
    emptyEl.hidden = false;
    emptyEl.textContent = "Couldn't load the directory right now.";
    return;
  }
  render(data || []);
}

let debounceTimer;
searchInput.addEventListener("input", () => {
  clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => search(searchInput.value.trim()), 200);
});

await search("");
