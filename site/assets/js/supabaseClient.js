import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { CONFIG } from "./config.js";

export const supabase = createClient(CONFIG.SUPABASE_URL, CONFIG.SUPABASE_ANON_KEY, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    storageKey: "afdrive-online-auth",
  },
});

/** Resolve the current session, or null if signed out. */
export async function getSession() {
  const { data, error } = await supabase.auth.getSession();
  if (error) return null;
  return data.session;
}

/** Redirect to login if no session exists. Returns the session otherwise.
 *  Call this at the top of any page that requires sign-in. */
export async function requireSession() {
  const session = await getSession();
  if (!session) {
    const next = encodeURIComponent(location.pathname + location.search);
    location.replace(`login.html?next=${next}`);
    return null;
  }
  return session;
}

export async function signOut() {
  await supabase.auth.signOut();
  location.replace("index.html");
}

/** Convenience accessor for the current access token, for relay calls. */
export async function getAccessToken() {
  const session = await getSession();
  return session ? session.access_token : null;
}
