// Public configuration for the AFDrive Online static site.
//
// Everything in this file is safe to commit and safe to ship to a
// browser: the Supabase anon key is meant to be public (Row Level
// Security is what actually protects data — see docs/supabase_schema.sql).
// NEVER put a service-role key here.
export const CONFIG = {
  SUPABASE_URL: "https://your-project.supabase.co",
  SUPABASE_ANON_KEY: "your-anon-key",

  // Base URL of the deployed relay (see /relay). No trailing slash.
  RELAY_URL: "https://your-relay.example.com",
};
