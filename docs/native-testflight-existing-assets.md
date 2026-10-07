# Existing-assets-only Macros TestFlight release

The manual `upload_testflight` input on **Required CI and Release** remains the only upload entry point. It defaults false and requires `main` plus successful Required Checks. The reusable TestFlight workflow has no direct dispatch or push trigger. This change does not authorize signing, upload, or production deployment.

The guard reuses the Workouts GET-only Apple client and local signing/artifact checks. Macros keeps its existing repository-configured distribution certificate and provisioning profile; it does not borrow another app's credentials or require a newly created profile. The decoded profile must match the configured name, Macros bundle/team, App Store distribution type, Apple sign-in and HealthKit entitlements, validity, and the supplied certificate. The public fingerprints and existing UUID are frozen in a run-local policy. Apple GETs must confirm the exact active profile, bundle and unexpired certificate; downloaded profile bytes must equal the configured profile. Cached profiles with differing bytes are preserved and stop the release.

An initial GET-only audience check resolves exactly one existing App Store app for `com.dailymacros.app`. It permits only the approved Jim email hash used in the established release policy, in exactly one existing internal group with automatic build access. Other existing groups must be empty, non-public, and external groups must have no builds. No testers, groups, public links, or settings are created or changed. The complete observed group identities, names, access settings and counts are frozen for this run and rechecked immediately before upload. A broader or unavailable audience stops the release; it is never accepted as the new baseline.

Archive and export use manual signing without provisioning-update or Xcode API-authentication flags. Export sets `testFlightInternalTestingOnly=true` and disables automatic version/build management. The IPA must match the full source SHA, Git-count build, marketing version, production origin, app build/hash, platform, existing profile/certificate and required entitlements, with no extra app extensions. Immediately before the only binary upload, live signing and audience checks run again. Upload acceptance is followed by bounded GET-only checks for `VALID`, `INTERNAL_ONLY`, the intended version/build and availability in the existing internal group. Processing timeout is an unverified release, not success; inspect the existing build before retrying any upload. Do not add a group or tester to make verification pass.

Local checks use synthetic responses and temporary fixtures, with no Apple authentication, signing, upload or app build:

```sh
node --test .github/scripts/release-guard-tests.mjs
PYTHONDONTWRITEBYTECODE=1 python3 .github/scripts/test_release.py
actionlint .github/workflows/testflight.yml .github/workflows/ci.yml
npm run test:check
```

Live Macros signing/audience state has not been verified by local tests. Missing, revoked, expired, mismatched or insufficient assets; unavailable app-specific authentication; broader audience; new Apple terms; or changed capabilities/settings are one explicit prerequisite decision for the coordinator. Never create/renew resources, copy credentials between apps, relax these checks, or change TestFlight distribution to unblock a release. No app code or restricted-database startup behavior changes in this guard.

On October 7, run `37649759421` passed Required Checks, signing, audience and artifact checks, but Apple rejected build 275 because marketing version `1.0` was closed (90186/90062). A GET-only Apple lookup at 16:21 UTC confirmed app `6770046577`, bundle `com.dailymacros.app`, was published at `1.0`. The next candidate uses `1.0.1` consistently across Xcode configurations and the release policy. Signing assets, capabilities, audience and manual release gates are unchanged. The sole release coordinator must run the normal checks and verify upload/processing; the version bump itself is not upload acceptance.
