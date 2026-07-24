# Apps Script setup

This React app uses the same Google Apps Script Web App deployment that already reads the **Agents Reviewed** tab.

## Safe installation

1. Open the Google Sheet.
2. Open **Extensions → Apps Script**.
3. Keep the existing `Code.gs` file.
4. Click **+ → Script** and name the new file `ReactQaApi`.
5. Paste the complete contents of `ReactQaApi.gs` into that new file.
6. Save the Apps Script project.
7. Select the function `qaAppSetup` and run it once while signed in as Junior or Barbara.
8. Approve Google permissions.
9. Copy the secret shown by the setup alert.
10. Add that secret to Netlify as `QA_APP_PROXY_SECRET`.
11. Update the existing Web App deployment using **Deploy → Manage deployments → Edit → New version → Deploy**. Keep **Execute as: Me** and the same access level already used by your current React API. Updating the current deployment keeps the same `/exec` URL.

## What the setup creates

The setup creates these new tabs only when they do not already exist:

- `QA App Users`
- `QA App Settings`
- `QA App Audit`

It seeds these accounts:

- `infojr.83@gmail.com` — Junior — administrator
- `barbara.kalchik8reserve@gmail.com` — Barbara — administrator
- `barbara.kalchik@hotelplanner.com` — Barbara — administrator
- `shoultskelly22@gmail.com` — Kelly — evaluator with Guided Mode

The setup does **not** delete, move, replace, or clear existing rows in `Agents Reviewed`.

## Netlify environment variables

Set these in **Netlify → Site configuration → Environment variables**:

```text
VITE_GOOGLE_CLIENT_ID=your Google Web OAuth client ID
VITE_ENABLE_DEV_LOGIN=false
APPS_SCRIPT_WEB_APP_URL=https://script.google.com/macros/s/YOUR_DEPLOYMENT_ID/exec
APPS_SCRIPT_API_KEY=your existing dashboard API key
GOOGLE_CLIENT_ID=the same Google Web OAuth client ID
QA_APP_PROXY_SECRET=the secret shown by qaAppSetup
ALLOW_DEV_BYPASS=false
```

Use `ALLOW_DEV_BYPASS=true` only inside the local `.env` file when testing with `netlify dev`.
