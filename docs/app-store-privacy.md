# App Store Privacy Notes

Use this as the repo-grounded starting point for App Store Connect privacy answers. It is not legal advice; confirm the final choices against current Apple prompts before submission.

Apple's App Privacy Details guidance says the app should identify data collected by the app and third-party partners, keep responses accurate, and update them when practices change: <https://developer.apple.com/app-store/app-privacy-details/>. Apple also requires a Privacy Policy URL for iOS apps in App Store Connect: <https://developer.apple.com/help/app-store-connect/reference/app-information/app-information>.

## Privacy Policy URL

Use the production app URL:

```text
https://<production-domain>/privacy
```

## Tracking

- Tracking: No.
- Third-party advertising: No.
- Data broker sharing: No.

## Data Linked To The User

- Contact Info: email address and name from Google or Apple sign-in, used for account management and app functionality.
- Identifiers: app user id, OAuth provider ids, API token records, Stripe customer/subscription ids when billing is enabled, used for account management, auth, billing, and security.
- Health & Fitness: weight, workouts, sleep, calories, nutrition/macros, and HealthKit-synced wellness data, used for app functionality.
- Sensitive Info: sexual activity entries only when that feature is enabled for the account, used for app functionality.
- User Content: meal text, workout text, saved foods, meal photos submitted for parsing, analysis prompts/results, and diagnostics exported and shared by the user, used for app functionality and support.
- Purchases: subscription status and billing events from Stripe when paid features are enabled, used for app functionality and billing support.

## Data Not Used For Tracking

DailyMacros does not use third-party advertising SDKs, does not sell personal data, and does not use collected data to track users across apps or websites.

## Third-Party Processing To Disclose

- OpenAI: meal/workout/report text and meal photos are sent only when the user asks the app to parse or analyze them.
- Coach Tony P. coaching: routine coach cards are generated from local deterministic rules. On supported iOS versions, on-device Apple Foundation Models may rank or rephrase already-eligible cards without sending those cards to OpenAI.
- Google and Apple: sign-in provider data is used for authentication.
- Stripe: subscription checkout, customer portal, and webhook state when paid features are enabled.
- Open Food Facts: barcode lookup sends the barcode needed to retrieve product nutrition.

## HealthKit Notes

HealthKit permissions are optional and controlled by the user. DailyMacros reads and writes only supported categories used by app features: weight, workouts, sleep, and sexual activity where enabled. Apple's HealthKit guidance says apps using HealthKit must provide a clearly stated privacy policy URL during submission: <https://developer.apple.com/design/human-interface-guidelines/healthkit/>.

## Reviewer Notes

- Account export: web Account & Privacy and iOS Settings.
- Account deletion: web Account & Privacy and iOS Settings.
- Coach Tony P. controls: web Account & Privacy and iOS Settings support coach mode/category controls and dismissal reset.
- Support path: contact the inviter with request references and build metadata.
- Public policy route: `/privacy`.
