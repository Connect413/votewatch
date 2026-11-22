// LIVE configuration for Vote Watch Dominica (Supabase project vote-watch-dominica).
// The publishable key is designed to be public: the database's security rules protect the data.
// NEVER put a secret / service_role key in this file.
window.VW_CONFIG = {
  SUPABASE_URL: "https://bzwswuqukedypowraxlz.supabase.co",
  SUPABASE_ANON_KEY: "sb_publishable_phoaZtub2bBRQuI6wVFQLw_Ry3qHJNt",
};
// Adding ?demo to the address opens demo mode with made-up data instead.
if (/[?&]demo\b/.test(location.search)) window.VW_CONFIG = {};
