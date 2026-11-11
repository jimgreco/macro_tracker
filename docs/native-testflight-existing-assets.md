# Existing-assets-only Macros TestFlight release

**Required CI and Release** uploads a TestFlight build on every push to `main` after successful Required Checks; a manual run can re-upload via the `upload_testflight` input (default true). The reusable `.github/workflows/testflight.yml` has no direct dispatch or push trigger. It runs the shared engine pinned by commit: `jimgreco/release-tools/ios/prepare`, then `ios/upload` (archive with `API_BASE_URL=https://macrovana.com`, `APP_BUILD=<commit count>`, `GIT_COMMIT_HASH=<sha7>` and the pinned profile UUID), then `ios/cleanup`. There is no Info.plist configure step. Engine behaviour and the policy schema are documented in release-tools `ios/README.md`.

`.github/scripts/release-policy.json` pins everything the release may use: app id `6770046577`, bundle/team, the existing distribution certificate (SHA-1 and SHA-256), the existing App Store profile (UUID, name, entitlements incl. Apple sign-in and HealthKit), every existing TestFlight group, the approved tester email hash, the marketing version and the artifact Info.plist values (`APIBaseURL`, `AppBuild`, `GitCommitHash`). Any difference stops the release before upload; never create, renew or edit Apple resources, testers or groups to make a guard pass, and never copy another app's credentials. Rotating the profile requires a policy commit.

`buildAudience` is the engine default `APP_STORE_ELIGIBLE`, so every upload can later be submitted with `App Store Submit` (`.github/workflows/app-store-submit.yml`, `.github/scripts/asc-submit.mjs`), which attaches a processed build to the marketing version, sets What's New on every localization and submits it for review; with `submit` unchecked it is GET-only. `asc-submit.mjs` imports the release policy and API token helper from the trimmed local `.github/scripts/asc-readonly.mjs`.

After an upload, `verify-testflight.yml` repeats the engine's GET-only processing/audience verification for a given `build` and `source_sha` without another archive or upload.

Local checks (no Apple authentication, signing or upload):

```sh
node --test .github/scripts/release-guard-tests.mjs   # submit tooling + marketing-version alignment
node <release-tools>/ios/scripts/asc-readonly.mjs validate-policy --policy .github/scripts/release-policy.json
actionlint .github/workflows/testflight.yml .github/workflows/ci.yml
npm run test:check
```

On October 7, run `37649759421` passed Required Checks, signing, audience and artifact checks, but Apple rejected build 275 because marketing version `1.0` was closed (90186/90062). A GET-only Apple lookup at 16:21 UTC confirmed app `6770046577`, bundle `com.dailymacros.app`, was published at `1.0`. The next candidate uses `1.0.1` consistently across Xcode configurations and the release policy. Signing assets, capabilities, audience and manual release gates are unchanged. The sole release coordinator must run the normal checks and verify upload/processing; the version bump itself is not upload acceptance.
