# DailyMacros Privacy Policy

Last updated: July 31, 2026

DailyMacros is a private friends and family beta for nutrition, workout, weight, sleep, and wellness tracking. The public policy is served by the app at `/privacy`; this Markdown copy exists so privacy and App Store review details can be reviewed in the repo.

## Data Collected

- Account details from sign-in providers, such as name, email address, provider identifiers, and profile image when provided.
- Nutrition data, saved foods, meal groups, macro targets, meal text, barcode lookups, and meal photos submitted for parsing.
- Workout, weight, sleep, and wellness entries. If Oura is connected, this includes Oura sleep, readiness, activity, stress, resilience, bedtime-guidance, and optional workout aggregates. Sexual activity entries are available only when enabled for an account.
- Subscription and billing state from Stripe when paid features are enabled.
- Authentication and security records such as API credential metadata, browser-session metadata, audit events, and request references needed to secure and support the service.
- Operational usage records such as per-feature daily usage limits and replay-safe mutation metadata needed to run the service.
- Optional diagnostics linked to the account for support and beta reliability. Automatic browser diagnostics use a strict allowlist: generic error category, relative route template, HTTP status, request reference, app platform/version, timestamp, and script filename/line/column when applicable. They do not include raw URLs or query strings, request or response bodies, typed meal or workout text, health values, tokens, cookies, secrets, stack traces, full user agents, or user/device identifiers in the submitted payload. The iOS diagnostic export remains stored locally until the user chooses to share it.

## Apple Health

HealthKit permissions are optional. If a user grants access, DailyMacros may read or write supported weight, workout, sleep, and sexual activity data so the app and Apple Health stay in sync. Users can change Health permissions at any time in iOS Settings.

## Oura

Connecting Oura is optional and uses Oura's authorization screen. DailyMacros requests daily-data access plus the minimum personal scope needed to obtain Oura's opaque user identifier and route signed webhook updates to the correct account. DailyMacros discards Oura profile fields such as age, height, weight, biological sex, and Oura email.

Oura access and refresh tokens are encrypted on the DailyMacros server. DailyMacros stores allowlisted aggregate Oura metrics and does not retain raw heart-rate, HRV, movement, sleep-phase, or MET sample arrays. Imported aggregates remain stored until the user chooses Disconnect & Delete or deletes the DailyMacros account. Oura cloud updates are received by signed webhooks after the ring syncs to Oura, with scheduled reconciliation for missed events.

DailyMacros may combine Oura aggregates with other app history for deterministic in-app trends and coaching. Oura API data and values derived from it are not provided to OpenAI, Apple Foundation Models, or any other AI or machine-learning model.

## AI Processing

When a user asks DailyMacros to parse or analyze a meal, workout, meal photo, report, or eligible connected health data, relevant content may be sent to OpenAI to produce estimates or analysis. Oura API data and values derived from it are always excluded. DailyMacros does not send other eligible content to OpenAI unless the user uses those AI features. OpenAI publishes API data controls at <https://platform.openai.com/docs/guides/your-data>.

Coach Tony P. coaching uses local deterministic rules to decide whether a card is eligible. On supported iOS versions, on-device Apple Foundation Models may rank or rephrase already-eligible Coach Tony P. cards. Routine Coach Tony P. cards are not sent to OpenAI, and local AI cannot override the rule evidence, confidence gates, actions, or dismissal controls.

## Barcode Data

Barcode lookups use Open Food Facts product data. DailyMacros sends the barcode value needed to look up the product and stores the nutrition entry only when the user saves it.

## How Data Is Used

Data is used for app functionality, account authentication, syncing across web and iOS, support, security, abuse prevention, beta reliability, billing when enabled, and account export or deletion. DailyMacros does not sell personal data and does not use third-party advertising or cross-app tracking.

## Backups And Retention

Production data is backed up for operational recovery. Account data remains in the active database until the user deletes the account or requests help deleting it, except for operational records with shorter limits. Optional browser diagnostics are retained for 30 days, operational usage counters for 90 days, and account audit events for 365 days. A scheduled server cleanup enforces those limits. Deleted account data is removed from the active database; encrypted production backup snapshots currently age out after 7 days, while transport or provider logs follow their providers' limited operational windows.

## User Controls

Users can turn future optional browser diagnostic uploads on or off from Account & Privacy on the web or Settings on iOS. Turning them off does not disable essential server-side security records, audit events, abuse controls, or request references. Users can export a JSON copy of account data, including safe diagnostic metadata, or permanently delete the account from those same settings. Users can disconnect Oura and delete imported Oura data from either Settings surface, revoke HealthKit access from iOS Settings, and sign out from the app.

Users can turn Coach Tony P. off, hide dismissed suggestion patterns, or disable specific Coach Tony P. card categories such as reminders, celebrations, alcohol coaching, and cleanup prompts.

## Support

For support or privacy requests, users should contact the person who invited them. They should include the request reference shown in any error message and the build information from Settings or Account & Privacy.
