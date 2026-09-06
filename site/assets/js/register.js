import { supabase } from "./supabaseClient.js";

const errorEl = document.getElementById("error-msg");

document.getElementById("register-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  errorEl.hidden = true;
  const form = new FormData(e.target);
  const { data, error } = await supabase.auth.signUp({
    email: form.get("email"),
    password: form.get("password"),
  });
  if (error) {
    errorEl.textContent = error.message;
    errorEl.hidden = false;
    return;
  }
  // Whether this account can log in immediately depends on your Supabase
  // project's "Confirm email" setting (Authentication > Providers > Email).
  // The old server-side flow used the admin API to auto-confirm every
  // signup — that required the service-role key, which can never live in
  // a static frontend. Toggle that setting in Supabase to match the UX
  // you want; this page reflects whichever behavior is actually active.
  if (data.session) {
    location.href = "storages.html";
  } else {
    location.href = "login.html?created=1";
  }
});
