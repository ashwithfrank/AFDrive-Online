"use strict";

/**
 * Two distinct Supabase clients, used for two distinct trust levels —
 * never mix them up:
 *
 *  - `supabaseService` uses the SERVICE ROLE key. It bypasses Row Level
 *    Security entirely. Only ever used from server-side code that has
 *    already done its own authorization check (e.g. "is this the
 *    server's owner?"). NEVER send this key to the browser.
 *
 *  - `getUserClient(accessToken)` uses the ANON key plus a specific
 *    user's access token, so RLS policies apply exactly as they would
 *    for that user's own browser. Used to validate "is this token
 *    still valid, and who does it belong to?" without granting
 *    service-role-level access just to check a session.
 */

const { createClient } = require("@supabase/supabase-js");

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_ANON_KEY || !SUPABASE_SERVICE_ROLE_KEY) {
  // Fail loudly at startup rather than silently running with a
  // half-configured backend that would misbehave in confusing ways.
  console.warn(
    "[afdrive-online] Supabase environment variables are missing. " +
      "Copy relay/.env.example to relay/.env and fill in your project's values."
  );
}

const supabaseService = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

function getUserClient(accessToken) {
  return createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: `Bearer ${accessToken}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

/** Resolve the current user from the relay's own session cookie value
 * (a Supabase access token — see routes/auth.js). Returns null if the
 * cookie is missing, expired, or otherwise invalid. */
async function getUserFromToken(accessToken) {
  if (!accessToken) return null;
  const client = getUserClient(accessToken);
  const { data, error } = await client.auth.getUser();
  if (error || !data?.user) return null;
  return data.user;
}

module.exports = { supabaseService, getUserClient, getUserFromToken };
