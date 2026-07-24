# Security and Access

The browser never receives the Apps Script URL, Apps Script API key, or React API proxy secret. Those values belong only in the Netlify environment.

Google Sign-In returns an ID token to the browser. The Netlify Function verifies that token against the configured Google OAuth client ID before forwarding any request.

The Apps Script API checks the verified email against `QA App Users`. Only the hard-coded Junior and Barbara email addresses may hold the administrator role. Administrator accounts cannot be blocked from the app screen.

Every write request must include the private `QA_APP_PROXY_SECRET` created by `qaAppSetup()`. Apps Script also validates review fields, permissions, Guided Mode Call ID rules, scoring selections, and required custom notes before appending a row.

Set `ALLOW_DEV_BYPASS=false` in Netlify production. The local test-login headers are accepted only by Netlify Dev when that flag is explicitly enabled.
