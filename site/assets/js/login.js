import { supabase, getSession } from "./supabaseClient.js";

document.getElementById("forgot-link").addEventListener("click", async (e) => {
  e.preventDefault();
  const email = prompt("Enter your account email to receive a reset link:");
  if (!email) return;
  const { error } = await supabase.auth.resetPasswordForEmail(email, {
    redirectTo: new URL("settings.html", location.href).toString(),
  });
  alert(error ? error.message : "If that email has an account, a reset link is on its way.");
});

const params = new URLSearchParams(location.search);
const errorEl = document.getElementById("error-msg");
const createdEl = document.getElementById("created-msg");

if (params.get("created") === "1") createdEl.hidden = false;

// Already signed in? Skip straight past the login form.
const existing = await getSession();
if (existing) {
  location.replace(params.get("next") || "storages.html");
}

document.getElementById("login-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  errorEl.hidden = true;
  const form = new FormData(e.target);
  const { error } = await supabase.auth.signInWithPassword({
    email: form.get("email"),
    password: form.get("password"),
  });
  if (error) {
    errorEl.textContent = "Invalid email or password.";
    errorEl.hidden = false;
    return;
  }
  location.href = params.get("next") || "storages.html";
});
