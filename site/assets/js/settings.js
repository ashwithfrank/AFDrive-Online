import { supabase, requireSession, signOut } from "./supabaseClient.js";

const session = await requireSession();
if (!session) throw new Error("redirecting");

document.getElementById("account-email").textContent = session.user.email || "";

document.getElementById("logout-link").addEventListener("click", (e) => {
  e.preventDefault();
  signOut();
});

const errorEl = document.getElementById("error-msg");
const successEl = document.getElementById("success-msg");

document.getElementById("password-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  errorEl.hidden = true;
  successEl.hidden = true;
  const form = new FormData(e.target);
  const { error } = await supabase.auth.updateUser({ password: form.get("password") });
  if (error) {
    errorEl.textContent = error.message;
    errorEl.hidden = false;
    return;
  }
  e.target.reset();
  successEl.hidden = false;
});
