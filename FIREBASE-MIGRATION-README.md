# QA Control Center — Firebase Production Setup

This project no longer uses Google Apps Script, Google Sheets, a Netlify Function, or a Node server for live QA operations.

Production path:

React/Vite on Netlify -> Firebase Authentication + Cloud Firestore + Firebase Realtime Database

## Firebase project

Project ID: `psych-support-app`

The Firebase Web SDK configuration is already present as safe browser configuration in `src/lib/firebase.ts`. The same values are also supported through `VITE_FIREBASE_*` variables in `.env` / Netlify if you prefer environment overrides.

## One-time Firebase Console setup

1. Firebase Authentication -> Sign-in method -> enable Google.
2. Firebase Authentication -> Settings -> Authorized domains -> add the production Netlify domain and any custom domain used by the QA tool.
3. Create a Cloud Firestore database.
4. Create/enable the Realtime Database for live presence.
5. Deploy `firestore.rules` and `database.rules.json` from this project. These are part of the security model and must not be replaced with public read/write rules.

If Firebase CLI is installed and logged into the correct Firebase project, the rules can be deployed with:

`firebase deploy --only firestore:rules,database`

The app itself still deploys to Netlify with the normal Vite build. There is no Netlify Function folder and no production Node API.

## Access model

- Any Google account may authenticate and view the normal QA dashboard/history.
- Unknown users are viewers by default and cannot submit reviews or access Admin Control.
- Only an active evaluator/admin record can submit reviews.
- Junior (`infojr.83@gmail.com`) is the protected owner.
- Barbara (`barbara.kalchik8reserve@gmail.com`) may be an administrator, but Firestore rules do not allow Barbara to modify/delete Junior's owner account.
- Junior can change Barbara's role/access.
- Only Junior and Barbara can change the Email Sent status.

## Legacy Google Sheet migration

Sign in as Junior, open **Admin Control -> Team & Access**, then use **Import the legacy QA Google Sheet workbook**.

Upload the existing `.xlsx`. The browser imports:

- every populated row in `Agents Reviewed`
- all nine saved criteria and custom notes
- scores/KPI/result/markdown count
- call center, evaluator, agent, Call ID, itinerary
- call length/call date/review date/start date
- Email Sent state
- legacy row number and Request ID when present
- active evaluator/admin access
- QA criteria/settings/call centers/rules

The import uses stable IDs (`Request ID` or `legacy-row-<row number>`), so re-running the same workbook updates the same legacy records instead of blindly creating duplicates.

The retired `barbara.kalchik@hotelplanner.com` account is intentionally not reactivated. Barbara's Gmail admin account is used.

## Excel downloads

Review History contains two browser-only exports:

- **Download Team Report (.xlsx)** — the organized report used for sending reviews to teams.
- **Download Full Google-Sheet Style** — rebuilds `Agents Reviewed` using the original A through CK header layout.

Both exports are created in the browser. They do not call Apps Script, Google Drive, Netlify Functions, or a Node API.

## Progress bars

Long actions display percentage progress, including app loading, saving reviews, permission/settings updates, Firebase refresh, Excel creation, and legacy workbook migration.

## Legacy code

`legacy-google-apps-script/` is retained only as historical reference. Nothing in the production app calls it. The old Netlify Function and local Node API were removed.
