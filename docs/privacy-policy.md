# DailyMacros Privacy Policy

Last updated: May 25, 2026

DailyMacros is a private friends and family beta for nutrition, workout, weight, sleep, and wellness tracking. The public policy is served by the app at `/privacy`; this Markdown copy exists so privacy and App Store review details can be reviewed in the repo.

## Data Collected

- Account details from sign-in providers, such as name, email address, provider identifiers, and profile image when provided.
- Nutrition data, saved foods, meal groups, macro targets, meal text, barcode lookups, and meal photos submitted for parsing.
- Workout, weight, sleep, and wellness entries. Sexual activity entries are available only when enabled for an account.
- Subscription and billing state from Stripe when paid features are enabled.
- Operational records such as API tokens, audit events, request references, build/version metadata, and beta usage limits needed to run and support the service.
- Diagnostics that users choose to export and share for support. The iOS diagnostic export is stored locally until the user shares it.

## Apple Health

HealthKit permissions are optional. If a user grants access, DailyMacros may read or write supported weight, workout, sleep, and sexual activity data so the app and Apple Health stay in sync. Users can change Health permissions at any time in iOS Settings.

## AI Processing

When a user asks DailyMacros to parse or analyze a meal, workout, meal photo, or report, that content may be sent to OpenAI to produce nutrition or workout estimates. DailyMacros does not send that content to OpenAI unless the user uses those AI features. OpenAI publishes API data controls at <https://platform.openai.com/docs/guides/your-data>.

## Barcode Data

Barcode lookups use Open Food Facts product data. DailyMacros sends the barcode value needed to look up the product and stores the nutrition entry only when the user saves it.

## How Data Is Used

Data is used for app functionality, account authentication, syncing across web and iOS, support, security, abuse prevention, beta reliability, billing when enabled, and account export or deletion. DailyMacros does not sell personal data and does not use third-party advertising or cross-app tracking.

## Backups And Retention

Production data is backed up for operational recovery. Account data remains in the active database until the user deletes the account or requests help deleting it. Deleted account data is removed from the active database, while transport/provider logs or infrastructure backups may remain for a limited operational window before aging out.

## User Controls

Users can export a JSON copy of account data or permanently delete the account from Account & Privacy on the web or Settings on iOS. Users can revoke HealthKit access from iOS Settings and sign out from the app.

## Support

For support or privacy requests, users should contact the person who invited them. They should include the request reference shown in any error message and the build information from Settings or Account & Privacy.
