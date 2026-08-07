# Legacy Workbook Mapping

Google Sheets is no longer the live database. The original workbook is supported for one-time migration and for familiar Excel exports.

## Legacy input

Admin Control accepts the old `.xlsx` workbook and reads the `Agents Reviewed` sheet. Every populated review row is mapped to a Firestore document while keeping its original row number and Request ID when available.

The importer preserves these review fields: Saved Timestamp, Agent Start Date, Today's Date, Evaluator, Agent Name, Call Center, Call ID, Email Sent, QA Type, Final Score, KPI Target, Result, Markdowns, all nine criteria groups, all nine Custom Notes, Itinerary Number, Length of Call, Date of Call, and Request ID.

The importer also reads `QA App Users`, `QA App Settings`, and the latest matching state from `emails sent details`. The retired `barbara.kalchik@hotelplanner.com` record is intentionally skipped.

## Firestore collections

- `reviews` — live QA reviews and imported legacy values
- `users` — evaluator/admin access and permissions
- `settings/main` — criteria, call centers, status options, and QA rules
- `meta/reviews` — next legacy-style row number
- `auditLogs` — app security/admin audit records

Realtime presence is stored separately in Firebase Realtime Database under `presence/{uid}`.

## Excel output

Review History has two exports. The Team Report keeps the organized send-to-team format. The Full Google-Sheet Style export recreates the 89-column `Agents Reviewed` A:CK layout and uses preserved legacy column values when available.
