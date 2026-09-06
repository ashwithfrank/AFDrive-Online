// Public configuration for the AFDrive Online static site.
//
// Everything in this file is safe to commit and safe to ship to a
// browser: the Supabase anon key is meant to be public (Row Level
// Security is what actually protects data — see docs/supabase_schema.sql).
// NEVER put a service-role key here.
export const CONFIG = {
  SUPABASE_URL: "https://zmokogpszflhjsubznzk.supabase.co",
  SUPABASE_ANON_KEY: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inptb2tvZ3BzemZsaGpzdWJ6bnprIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODg1ODkzNjIsImV4cCI6MjEwNDE2NTM2Mn0.pSVqb0AqJn24-j06usIeLFwFCyuop6qua1ohCYgXd5k",

  // Base URL of the deployed relay (see /relay). No trailing slash.
  RELAY_URL: "https://your-relay.example.com",
};
