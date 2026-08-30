// OPTIONAL runtime configuration.
//
// Environment variables (see .env.example) are the normal way to configure
// ChEckIn. This file is an escape hatch for changing settings on an already
// deployed build without rebuilding: copy it to `public/config.js`, fill it in,
// and add this line to index.html inside <head>:
//
//     <script src="/config.js"></script>
//
// Values here OVERRIDE the build-time environment variables.
//
// `config.js` is git-ignored on purpose so that redeploying can never clobber
// the copy sitting on your server. Never put a service_role key or a VAPID
// private key in this file — it is served to every visitor.

window.__CHECKIN_CONFIG__ = {
  SUPABASE_URL: '',
  SUPABASE_ANON_KEY: '',
  HOUSEHOLD: '',
  VAPID_PUBLIC_KEY: '',
};
