# Setbook

A strength-training log: an iPhone app for logging at the gym, a web app for reviewing and editing, and a small API that keeps them in sync. Dark, quiet, numbers first.

- Web app: https://vic-goncalves.github.io/setbook/
- API: https://setbook.vic-goncalves.workers.dev (Cloudflare Worker + D1, free tier)

## How it fits together

```
iPhone app (SwiftUI, SQLite)  ──┐
                                ├──>  API: Cloudflare Worker + D1  (server/)
Web app (React, GitHub Pages) ──┘
```

- **iPhone** (`App/`, `Packages/SetbookKit/`): everything is saved to SQLite on the phone first, so logging works offline. Triggers queue every change; sync pushes and pulls in the background.
- **Web** (`web/`): React + Vite, deployed to GitHub Pages by `.github/workflows/deploy-web.yml`. It reads and writes through the same sync API.
- **API** (`server/`): Hono on Cloudflare Workers with a D1 database. Google sign-in, rotating refresh sessions, idempotent push/pull with per-record revisions and explicit conflicts.
- **Contracts** (`contracts/`): the built-in exercise catalog and a sample backup with expected metric values, generated from Swift. The server validates against them and the web app's metric math is tested against them, so all three agree.

Decisions and metric definitions: `docs/decisions.md`.

## Google sign-in

Configured: one **Web application** OAuth client serves both the web app and the iPhone app. Its ID is in `server/wrangler.jsonc`; the secret is a Worker secret. While the Google app is in testing mode, only test users added under Google Auth Platform → Audience can sign in.

To set it up on a fork:

1. https://console.cloud.google.com/ → create a project (any name).
2. APIs & Services → OAuth consent screen → External → fill in the app name and your email. Add yourself and friends as test users (or publish the app).
3. APIs & Services → Credentials → Create credentials → OAuth client ID → **Web application**.
   - Authorized redirect URI: `https://setbook.vic-goncalves.workers.dev/v1/auth/google/callback`
4. Copy the client ID and secret, then:
   ```sh
   cd server
   npx wrangler secret put GOOGLE_CLIENT_SECRET      # paste the secret
   # put the client ID in wrangler.jsonc → vars.GOOGLE_CLIENT_ID, then:
   npx wrangler deploy
   ```

The same web client serves the iPhone app too: the phone opens the sign-in page in the system browser sheet and receives a one-time code at `setbook://auth`, which only that phone can redeem (PKCE).

## Web app on your iPhone (recommended)

Open https://vic-goncalves.github.io/setbook/ in Safari, tap Share, then **Add to Home Screen**. It launches full-screen with the Setbook icon, never expires, and updates itself on every deploy.

- Works offline: the app loads without signal, your data is kept on the phone (IndexedDB), and edits sync when you're back online.
- Keeps the screen awake during a workout, ticks a haptic when you complete a set (iOS 18+), and the number pad's Return moves weight -> reps -> next set.
- Swipe a set or weigh-in left to delete it.

## Native iPhone app

```sh
brew install xcodegen
xcodegen generate
open Setbook.xcodeproj
```

The app talks to the API set by `SETBOOK_API_ORIGIN` in `project.yml`. To install on your phone with a free Apple ID:

1. Xcode → Settings → Accounts: add your Apple ID.
2. Setbook target → Signing & Capabilities → Team: your Personal Team. If the bundle ID is taken, change `com.setbook.app`.
3. iPhone: Settings → Privacy & Security → Developer Mode → On.
4. Plug in, pick the phone as run destination, press Run. Then trust the developer certificate in Settings → General → VPN & Device Management.

Free provisioning expires after 7 days: press Run again. Your data is kept, and it's also on the server.

Logs made before sign-in existed are adopted by the first account that signs in and uploaded.

## Local development

```sh
# API (needs npm 11 locally because of an npm 10.9 peer-dependency bug: use `npx npm@11 ci`)
cd server
cp .dev.vars.example .dev.vars            # then set SESSION_SIGNING_KEY (openssl rand -base64 48)
npx npm@11 ci
npm run migrate:local
npx wrangler dev                          # http://localhost:8787, dev sign-in enabled via .dev.vars

# Web
cd web
npx npm@11 ci
npm run dev                               # http://localhost:5173, shows a "Dev sign-in" field

# iPhone (simulator) against the local API: add launch arguments
#   -apiOrigin http://localhost:8787
# Debug builds show a dev sign-in field. For automated checks:
#   -apiOrigin http://localhost:8787 -devSignIn <name> -devSeed
```

Debug-only demo data without any server: launch with `-demo`, `-demo -demoWorkout`, or `-demo -demoScreen <history|historyDetail|progress|bench|assisted|bodyWeight|templateEditor|library|settings>`.

## App icon

`swift scripts/render-icon.swift` regenerates the iPhone icon (light, dark and tinted) and the web home-screen icon.

## Tests

```sh
cd Packages/SetbookKit && swift test      # domain, metrics, persistence, workout logging, sync engine
cd server && npm test                     # auth, sessions, sync, isolation, export, deletion (real local D1)
cd web && npm test                        # metrics vs. the Swift fixture, workout rules
SETBOOK_WRITE_CONTRACTS=1 swift test --filter ContractTests   # regenerate contracts/ after a model change
```

CI runs all three on every push (`.github/workflows/ci.yml`).

## Deploying

- **Web:** push to `main`. The workflow builds with the `API_ORIGIN` repository variable and publishes to Pages.
- **API:** `cd server && npm run migrate:remote && npx wrangler deploy`.

## Free-tier notes

Workers free: 100k requests/day, 10 ms CPU per request. D1 free: 5M rows read and 100k rows written per day. Sync batches edits (a few seconds on the phone, under a second on the web), and each write is one record plus its change-log row, so a few friends training daily stay far below the limits.

## Not done yet

- UI tests in `App/UITests` compile but haven't run on this Mac: Xcode's test runner can't attach to the simulator until developer mode is enabled (`sudo DevToolsSecurity -enable`).
- Reps in reserve and training goals exist in the data model and exports but have no entry UI.
- Workout data is edited by one device at a time; simultaneous edits to the same workout become an explicit conflict to resolve in Settings.
