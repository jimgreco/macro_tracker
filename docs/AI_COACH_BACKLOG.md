# AI Coach Backlog

Last updated: 2026-05-27

## Implementation Status

- 2026-05-27: Started iOS implementation with a shared AI coach suggestion model, dismissals, coach card UI, and deterministic high-confidence candidate rules for Macros, Workouts, Weight, and Sleep.
- 2026-05-27: Named the iOS coach `Compass`, changed the coach card to lead with the suggestion title before the author/source line, and added Settings controls to show/hide Compass cards and reset dismissed suggestions.
- 2026-05-27: Improved Compass candidate quality with learned meal windows for missed breakfast/lunch prompts, distinct-day habitual quick-add detection with direct add payloads, weight goal-date pace coaching, repeated-evidence wake-up handling for sleep, and local diagnostics for shown/dismissed/acted-on suggestions.
- 2026-05-27: Added iOS repeat-workout coaching that detects recurring workouts across distinct recent days and logs the reconstructed workout directly from the Compass card.
- 2026-05-27: Added iOS weight-maintenance congratulations that require repeated weigh-ins across at least 10 days, all within the goal band.
- 2026-05-27: Added iOS sleep-streak congratulations for consecutive logged nights that meet the sleep target.
- 2026-05-27: Split iOS Compass "Not useful" into a distinct local diagnostics event while still suppressing the specific pattern.
- 2026-05-27: Added an iOS Compass "Why am I seeing this?" detail sheet with reason, evidence, confidence, source, category, and expiry.
- The current implementation uses local deterministic rules/templates as the confidence gate and fallback path. Local AFM narration/ranking is still pending and should be layered on top of these candidates rather than replacing the rule calculations.

## Goal

Add an AI coach that helps users understand recent behavior, make practical decisions, and notice high-confidence opportunities without adding noise. The coach should feel firm, friendly, and timely. It should use local Apple Foundation Models where available so coaching is cheaper, faster, and more private.

## Product Principles

- Coach only when the app has enough evidence. A silent coach is better than a confident guess.
- Use deterministic app data as the source of truth. The model may rank, summarize, and phrase suggestions, but it should not invent facts or decide from raw vibes.
- Prefer recent, actionable observations over generic advice.
- Keep the tone direct and supportive: "You are behind your protein target today" is useful; shame, medical claims, and vague motivation are not.
- Show at most one primary suggestion per page by default, with a path to expand if multiple high-confidence suggestions exist.
- Make every suggestion dismissible for today and dismissible for the specific action or pattern.
- Do not require network AI for routine coaching in the iOS app. If AFM is unavailable, fall back to deterministic templated copy before using paid server AI.

## Important Constraint From Prior AFM Work

The previous AFM/on-device LLM experiment was backed out because meal-photo image input was not available in the public AFM surface used at the time. This coach should not depend on image input. Scope AFM usage to text and structured insight generation from existing local data summaries, targets, and deterministic candidate suggestions.

## User Experience

- Placement: render the coach directly below the page title and above the page content on Macros, Workouts, Weight, and Sleep.
- Visual treatment: compact banner/card with a subtle gradient, a small sparkle/AI icon, and enough contrast for accessibility. Avoid oversized hero styling.
- Actions: each suggestion can have one primary action, one secondary action when needed, and a dismiss menu.
- Dismissal options:
  - Dismiss for today: hide the suggestion type on that page until the next local day.
  - Dismiss this action: suppress that specific suggestion signature until the underlying data pattern changes materially.
- The card should show evidence in plain language, for example "based on 5 of the last 7 logged days" or "based on your last 8 workouts."
- The coach should never block logging. It is an assistive layer, not a modal.

## Suggestion Data Contract

Each generated suggestion should use a structured object:

```json
{
  "id": "macro-protein-shortfall-2026-05-27",
  "surface": "macros",
  "category": "trend",
  "priority": 80,
  "confidence": 0.92,
  "title": "Protein is running low",
  "message": "You are 42g short of your usual protein target and this has happened 4 of the last 6 logged days. Make the next meal protein-first.",
  "evidence": ["4 of last 6 logged days below protein target", "average shortfall 38g"],
  "primaryAction": {
    "label": "Log protein",
    "type": "open_log_meal"
  },
  "secondaryAction": null,
  "dismissalKey": "macro:protein_shortfall:v1",
  "expiresAt": "2026-05-28T04:59:59Z",
  "modelSource": "afm_local"
}
```

Implementation notes:
- `confidence` is computed by rules, not by the language model alone.
- `priority` decides which suggestion appears first when several qualify.
- `dismissalKey` must be stable across devices and app launches.
- `expiresAt` should respect the app's Eastern-time day boundary unless user-specific time zones are added later.

## Confidence Gates

Global gates:
- Do not show trend coaching with fewer than 5 relevant data points.
- Do not show "usual time" coaching until the app has at least 3 matching historical logs in the same daypart.
- Do not coach from a single outlier unless the user explicitly set a target and the current state is clearly off track.
- Do not show negative coaching immediately after congratulating the user on the same page.
- Suppress coaching when today's data is likely incomplete unless the suggestion is explicitly about incomplete logging.
- Include enough evidence text that the user can understand why the suggestion appeared.

Suggested thresholds:
- High confidence: at least 0.85 rule confidence and no missing critical data.
- Medium confidence: eligible for hidden debug/QA logging, not user-facing.
- Low confidence: discarded.

## Local AFM Architecture

Backlog tasks:
- Add a `CoachCandidateEngine` that computes deterministic candidates from local summaries, targets, and logging history.
- Add a local `CoachNarrator` backed by Apple Foundation Models on supported iOS versions.
- Use AFM for:
  - choosing the clearest candidate when several qualify,
  - generating firm but friendly copy,
  - shortening copy to fit the card,
  - producing structured output that matches the suggestion contract.
- Do not use AFM for:
  - numeric calculations,
  - target comparisons,
  - determining whether there is enough data,
  - meal-photo analysis,
  - medical or diagnostic claims.
- Add runtime availability checks. If AFM is unavailable, use deterministic templates.
- Add a Settings toggle for AI Coach with options:
  - On,
  - Off,
  - Local model only,
  - Local model with fallback templates.
- Started: iOS Settings now has a Compass on/off control and reset for dismissed suggestions. More granular local-model modes are still pending.
- Add diagnostics that expose which source produced the suggestion: rule template, AFM local, or server fallback if server fallback is later enabled.
  - Started in iOS: Compass records local diagnostics when suggestions are shown, dismissed, or acted on, including surface, category, confidence, source, and dismissal key.

## Shared Data Requirements

Backlog tasks:
- Add normalized daypart helpers: breakfast, lunch, dinner, evening, late night.
  - Started in iOS: `CoachDaypart` now normalizes meal windows and powers missed-meal and usual-item rules.
- Add per-user "usual logging window" learning for meals and workouts.
  - Started in iOS: breakfast/lunch prompts require at least 3 historical daypart logs and wait until later than the learned first-log window.
- Add rolling summaries for:
  - previous day,
  - last 3 days,
  - last 7 days,
  - current week to date,
  - previous week.
- Add suggestion dismissal persistence.
  - iOS first: local storage with stable keys.
  - Later: sync dismissals through the backend so web and iOS do not repeat dismissed coaching.
- Add lightweight analytics for quality only if privacy-safe:
  - shown,
  - dismissed for today,
  - dismissed action,
  - acted on,
  - hidden by confidence gate.

## Macros Page

Placement: below the Macros title and above the macro logging/dashboard content.

Backlog items:
- Recent calorie coaching:
  - Detect when calories are above target by at least 10 percent on 2 of the last 3 complete logged days or 4 of the last 7 complete logged days.
  - Phrase around decisions, not blame: "Your logged calories have run high this week. Keep dinner simpler tonight."
- Protein shortfall coaching:
  - Detect when protein is below target by at least 15 percent on 3 of the last 5 complete logged days.
  - Suggest the next best action, such as logging or choosing a protein-forward meal.
- Alcohol coaching:
  - Add or reuse alcohol tagging so the coach can identify alcohol from parsed entries or saved items.
  - Only coach when alcohol appears repeatedly or meaningfully affects calories, not from a single social event.
- Missed meal prompt:
  - Learn usual breakfast and lunch logging windows from historical logs.
  - If it is later than the user's normal window and no matching meal is logged, ask whether they still need to enter it.
  - Primary action: open meal logging with a daypart hint.
- Habitual quick-add:
  - Detect repeated foods around the same time, such as yogurt and granola for breakfast.
  - Require at least 3 occurrences in 14 days with similar timing.
  - Offer one-tap quick add for the saved item or reconstructed meal group.
  - Started in iOS: Compass detects repeated foods by distinct daypart days and can add the reconstructed item directly from the card.
- Macro target congratulations:
  - Congratulate when the current day or previous complete day lands within a realistic band:
    - calories within 5 percent,
    - protein at or above 95 percent of target,
    - carbs and fat within 10 percent when targets exist.
  - Avoid congratulating if the day is clearly incomplete.
- End-of-day steering:
  - In late afternoon or evening, detect whether one macro is clearly lagging while calories remain available.
  - Suggest a concrete direction, for example "protein-first dinner" or "lighter snack."
- Saved-item cleanup prompt:
  - If the same food is manually entered often but not saved, suggest saving it as a quick add.

Acceptance criteria:
- No macro warning appears until enough complete-day data exists.
- Same-day macro coaching is time-aware and does not treat a half-logged morning as failure.
- Quick-add suggestions can be dismissed per food/pattern.

## Workouts Page

Placement: below the Workouts title and above the workout logging/stats content.

Backlog items:
- Recent workout trend:
  - Compare the last 3 to 5 workouts against the user's prior baseline for duration, calories, and intensity.
  - Show changes only when the difference is meaningful, for example at least 15 percent from baseline.
- Falling-behind reminder:
  - Compare current week-to-date workout days against weekly target and usual workout cadence.
  - Show only when there is still time to act and the user is materially behind.
  - Primary action: log workout or open workout parser.
- Weekly target congratulations:
  - Congratulate when workout-days target or workout-calorie target is reached.
  - Avoid repeating the same congratulations after dismissal.
- Intensity coaching:
  - Detect when intensity is consistently lower or higher than usual.
  - If higher than usual and recent sleep is poor, suggest recovery-oriented phrasing.
- Repeat workout quick action:
  - Detect common recurring workouts and offer a one-tap "Log usual workout" action.
  - Started in iOS: Compass requires at least 3 matching workout days in the last 30 days and no matching workout today before showing a direct log action.
- Rest/recovery guardrail:
  - If the user has several consecutive high-intensity days and poor sleep, suggest an easier session or rest day without making medical claims.

Acceptance criteria:
- Workout coaching distinguishes workout days from total session count.
- Reminders do not fire after the user already hit the weekly target.
- The coach never tells the user to push harder when recent sleep or recovery data argues against it.

## Weight Page

Placement: below the Weight title and above the weight logging/chart content.

Backlog items:
- Trend analysis:
  - Use rolling averages rather than single weigh-ins.
  - Require at least 4 weigh-ins in the last 14 days before trend coaching.
- Goal tracking:
  - Compare current rolling trend against target weight and target date when available.
  - Estimate whether the current trend is on track, ahead, or behind.
  - Keep language practical and non-alarming.
  - Started in iOS: Compass compares recent rolling pace with the pace needed for a future target date when there are at least 6 recent weigh-ins.
- Goal congratulations:
  - Congratulate when the user reaches the target band.
  - Add a separate maintenance congratulations when the user remains within the target band for a defined period, such as 14 or 30 days.
  - Started in iOS: Compass shows a separate maintenance card only after at least 5 recent weigh-ins across 10+ days are all within 1 lb of target.
- Weigh-in consistency:
  - If the user normally logs weight but has not logged recently, prompt for a check-in.
  - Do not prompt users who do not have an established weight logging habit.
- Plateau coaching:
  - Detect a flat rolling trend over 3 or more weeks only when the goal requires movement.
  - Suggest reviewing recent macro adherence rather than making unsupported claims.

Acceptance criteria:
- No weight suggestion is based on a single weigh-in.
- Goal projections show the evidence behind the claim.
- Maintenance and loss/gain coaching are distinct.

## Sleep Page

Placement: below the Sleep title and above the sleep logging/history content.

Backlog items:
- Recent sleep trend:
  - Compare last 3 to 7 nights against the user's sleep target.
  - Require at least 5 sleep logs in the relevant window.
- Target comparison:
  - Show whether the user's average duration is above, near, or below target.
  - Include wake-up counts when they are consistently elevated.
  - Started in iOS: wake-up language now requires repeated recent nights rather than one rough night.
- Recovery tie-in:
  - If sleep is below target and workouts have been high intensity, suggest a lighter workout or earlier wind-down.
- Sleep congratulations:
  - Congratulate on meeting the target for several nights in a row or improving the weekly average.
  - Started in iOS: Compass recognizes 3+ consecutive logged nights that meet the target before showing a streak card.
- Logging reminder:
  - If the user usually logs sleep and missed the prior night, ask whether they want to enter it.

Acceptance criteria:
- Sleep coaching does not imply diagnosis.
- Suggestions use the user's target when available and app defaults otherwise.
- Wake-up coaching requires repeated evidence, not one rough night.

## Cross-Page Suggestions

Backlog items:
- Correlate sleep and workouts when both data sets are strong enough.
- Correlate macro adherence and weight trend only over multi-week windows.
- Detect "good streaks" across multiple surfaces, for example macro adherence plus workout target met.
- Add a weekly coach recap once daily coach cards are reliable.
- Add "Why am I seeing this?" detail for every suggestion.
  - Started in iOS: every Compass card can open a detail sheet with the suggestion reason, evidence, confidence, source, category, and expiry.
- Add "Not useful" feedback so repeated poor suggestions can be suppressed.
  - Started in iOS: the card records `not_useful` separately from dismissals and hides that specific suggestion pattern.

## Copy Guidelines

Use:
- "Your logs show..."
- "You are on track for..."
- "You are behind..."
- "Make the next meal..."
- "You hit..."
- "Consider..."

Avoid:
- "You failed..."
- "You must..."
- "This will cause..."
- "Guaranteed..."
- Medical or diagnostic language.

Example copy:
- "You are 38g short on protein today and this has been the pattern most of the week. Make the next meal protein-first."
- "It is later than your usual breakfast log. Want to add your yogurt bowl?"
- "You have hit your workout target for the week. Keep the next session easy if you are feeling worn down."
- "Your 7-day weight trend is moving toward your goal, but a little slower than planned. The useful lever is consistency, not a drastic change."
- "Your sleep average is 54 minutes under target this week. Keep tonight simple and protect the wind-down window."

## Implementation Phases

### Phase 1: Foundation

- Add suggestion data model and dismissal model.
- Add deterministic candidate engine.
- Add page-level coach card UI in iOS.
- Add template fallback copy.
- Add tests for confidence gates and dismissal behavior.

### Phase 2: Macros And Workouts

- Implement macro trend, missed meal, habitual quick-add, and macro congratulations.
- Implement workout trend, falling-behind reminder, and weekly congratulations.
- Add local AFM narrator for eligible iOS versions.
- Add diagnostics for suggestion source and hidden candidates.

### Phase 3: Weight And Sleep

- Implement rolling weight trend, goal tracking, maintenance congratulations, and weigh-in consistency prompts.
- Implement sleep trend, target comparison, sleep congratulations, and recovery tie-ins.
- Add cross-page sleep/workout guardrails.

### Phase 4: Polish And Sync

- Add synced dismissals through the backend.
- Add web coach card parity if the web app remains an active surface.
- Add quality feedback controls.
- Add weekly recap after daily cards prove reliable.
- Add privacy copy and App Store notes for local AI coaching.

## Test Plan

- Unit-test each confidence gate with insufficient data, borderline data, and high-confidence data.
- Unit-test dismissal keys so "dismiss today" and "dismiss this action" behave differently.
- Snapshot-test coach card layout on small and large iPhones.
- Verify VoiceOver labels for the sparkle/AI icon, dismiss menu, and evidence text.
- Verify AFM unavailable path uses deterministic templates.
- Verify no network AI request is made for routine iOS coach generation when local mode is available.
- Verify suggestions expire at the expected local-day boundary.

## Open Questions

- Should the first version be iOS-only, or should the web app get deterministic coach cards at the same time?
- Should coach dismissals sync immediately, or is local-only dismissal acceptable for the first beta?
- Should users be able to disable specific coach categories, such as alcohol coaching or weight coaching?
- Should weekly recap use AFM locally, server AI, or deterministic templates?
- Do we want a visible "AI Coach" Settings section, or should the controls live under existing app preferences?
