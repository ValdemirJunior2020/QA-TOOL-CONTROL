# Security and Access

The production app uses Firebase Authentication, Cloud Firestore, and Firebase Realtime Database directly from the React/Vite browser app. There is no Netlify Function, live Apps Script API, proxy secret, or Node API.

Firebase web configuration is not a server secret. Authorization is enforced by `firestore.rules` and `database.rules.json`, not by hiding the Firebase configuration.

## Access model

- Any verified Google account can sign in and read the normal QA review data.
- Unknown accounts are viewers. They cannot submit reviews or access Admin Control.
- Review creation requires an active user document with evaluator/admin role and `canSubmitReviews=true`, except the protected Junior owner account.
- Admin writes are limited to Junior and an active Barbara admin account.
- Junior (`infojr.83@gmail.com`) is hard-protected in Firestore rules.
- Barbara cannot update, block, demote, delete, or change Junior's account.
- Junior can change Barbara's permissions/role/access.
- Review deletion is owner-only.
- Normal review records cannot be arbitrarily edited after creation; admin review updates are limited to Email Sent metadata.

Do not replace the included Firebase rules with open public read/write rules.
