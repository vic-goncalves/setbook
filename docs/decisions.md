# Decisions

## Architecture
- **iPhone app** keeps a full local SQLite copy and syncs in the background, so logging never waits on the network.
- **API** is a Cloudflare Worker with D1 (free tier). Records are stored as validated JSON documents (one row per template, workout, weigh-in or custom exercise) with a per-record revision, tombstones, and an ordered change log. This keeps writes to one row plus one change row, which matters for D1's 100k writes/day free limit, and keeps the server schema stable as the app models evolve; validation lives in `server/src/records.ts`.
- **Web app** is static (GitHub Pages) and calls the API cross-origin with bearer tokens. GitHub Pages can't run code, which is why the API is separate.

## Auth
- Google sign-in for both clients, through the server: Authorization Code + PKCE to Google, ID token verified with `jose` (signature, issuer, audience, expiry, nonce). Users are keyed by `(provider, subject)`, never email.
- Both clients then get a one-time code (iOS via `setbook://auth`, web via an allow-listed return URL) redeemable only with the client's own PKCE verifier.
- 15-minute HS256 access tokens; 60-day refresh tokens that rotate on every use. Only SHA-256 hashes are stored. Replaying a rotated refresh token revokes the whole family.
- Tokens live in the iOS Keychain and in the browser's localStorage (no cookies, since the site and API are on different origins).
- Sign in with Apple isn't used: it needs the paid Apple Developer Program.
- `POST /v1/auth/dev` exists only when `DEV_AUTH=true` (local development); production returns 404.

## Sync
- Push sends whole records with the revision they were based on and a mutation ID. Server writes, change-log row and idempotency record commit in one D1 batch; a guard row aborts the batch if the revision moved. Retrying a mutation ID returns the original result.
- One write per record in flight at a time, so each is based on the previous result.
- Stale revision or a second active workout → conflict. The client keeps its version and the server's copy, and the user chooses "keep this version" (overwrite) or "use the other version". Nothing merges silently.
- iOS: SQLite triggers queue every change to a record or its children; pulled changes are applied with triggers silenced. Each account has its own database file; signing out deletes it (after warning about unsynced changes).

## SQLite via GRDB, not SwiftData (iPhone)
Explicit versioned migrations, real foreign keys and CHECK constraints, a partial unique index enforcing one active workout, aggregate writes in a single transaction, and fast in-memory test databases. Domain and Metrics modules do not import GRDB.

## Snapshots and history
- Starting a template copies it into an independent session that stores the template ID and revision. `workout_session.source_template_id` is not a foreign key, so deleting a template leaves history untouched.
- Each workout exercise snapshots the exercise name and measurement convention.
- A custom exercise's measurement type and load convention lock once it has logged sets. Referenced exercises are archived, not deleted.
- Repeating a workout copies completed warm-up and working sets as targets (reps exact, load as logged). All new sets start incomplete.
- Template updates at finish compare structure and prescriptions only, matching the k-th occurrence of an exercise. Template notes and rest settings are kept for matched exercises.

## Units
Masses are stored as the value and unit the user typed. Kilograms are derived for comparison. Two loads are equal if they agree within 1 g. Changing the display unit never rewrites stored values.

## Metric definitions (version 1)
Inputs: completed working sets that pass validation. Warm-ups and incomplete sets never count. One point per session at its start time; same-day sessions stay separate; sessions without qualifying sets produce no point. Series only include sessions recorded with the exercise's current measurement convention.

- Heaviest set: max load, ties broken by more reps. Labeled "Heaviest added load" for weighted bodyweight.
- Volume: sum of load x reps. External-load exercises only; per-hand is labeled per-hand load x reps and never doubled. No bodyweight-inclusive or assisted volume.
- Best reps at load: max reps among sets at the chosen load; sessions without that load are omitted.
- Best reps / total reps: bodyweight exercises (default best reps).
- Least assistance: assisted exercises, ties broken by more reps. Lower means less help.
- Records: heaviest load (or least assistance) with reps, and most reps at each load. A tie does not move a record. No estimated 1RM.

Body weight: entries are bucketed by calendar day in the time zone they were recorded in, and each day's mean counts once. The 7-day average for observed day D averages observed daily means in D-6..D, without filling gaps. With fewer than two observed days in the range, no average or change is shown. Change = last observed day mean minus first observed day mean in the range.

## Logging behavior
- Every edit to an active workout is written to SQLite immediately; the in-progress workout is reloaded at launch.
- Tapping a set's check with empty fields records the greyed suggestion (previous counterpart, else the template target). That tap is the confirmation; nothing is completed automatically.
- The rest timer is stored as an end timestamp (UserDefaults), so it is correct after backgrounding or relaunch. Notifications are requested only when "Alert when rest ends" is turned on; failures are ignored so they never block logging.
- Edits to a finished workout from History are only written on Save. Unticked sets are dropped on save; a finished workout must keep at least one completed set.

## Backup
JSON backups contain custom exercises, templates (with their stored revision), all sessions, and body measurements. Import upserts by ID inside one transaction. If the file has an in-progress workout and one already exists on the phone, the file's is skipped.

## Visual design
Dark only (`UIUserInterfaceStyle: Dark` plus `.preferredColorScheme(.dark)`). Tokens live in `App/Sources/DesignSystem/Theme.swift`:
- Near-black page (#0B0B0C), raised surfaces with 1px hairlines, white ink in three strengths.
- Primary actions are inverted: white fill, black text. One per screen.
- One signal color, green, means "done" (completed sets, Finish, in-progress dot). Amber marks warm-ups. Red is for destructive actions only.
- Numbers use SF Rounded with tabular digits (`Font.metric`); labels use small uppercase eyebrows.
- Tab roots draw their own large header instead of the system large title, which collided with toolbar buttons.
