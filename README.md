# 3dAFL

A 3D AFL match simulator that runs automatically from start to finish, broadcast-style. Every player and the ball are physically simulated on the ground; player decisions (handball, kick short, go long, run and bounce, shoot, play on) are made by [Jev](https://typesafe.ai), TypeSafe AI's structured-decision model, with a local heuristic fallback so it always runs even without API access. Player attributes accumulate across a season.

## Stack

- **`shared/`** — TypeScript types shared by server and client (Player, Team, MatchEvent, DecisionEngine, ...)
- **`server/`** — Node/Express + WebSocket. Runs the match simulation, calls Jev for decisions, persists teams/season/ladder as JSON, streams events live.
- **`client/`** — Vite + Three.js. Renders the match in 3D with a broadcast-style camera, scoreboard, and live commentary feed.

## Setup

```bash
npm install
```

Put your TypeSafe AI key in `.env` at the repo root (copy `.env.example`):

```
TYPESAFE_API_KEY=your_key_here
```

No key? The server automatically falls back to a local, attribute-weighted heuristic decision engine — everything still runs, it just isn't Jev-driven. Swapping in a working key later requires no code changes.

`SIM_SPEED` controls playback pace: how many sim-clock seconds pass per real second while a match is being watched live (default `4`, so a 20-minute quarter plays out over ~5 real minutes). Lower it for a slower, more realistic pace; raise it to blitz through a match faster.

## Running it

```bash
npm run dev
```

Starts the server on `:8787` and the client on `:5173`. Open `http://localhost:5173`, click **Start Match**, and watch — the match runs unattended through all four quarters, and the app auto-advances to the next scheduled match once the previous one finishes, progressing the season automatically.

Headless (no browser: plays the next scheduled match instantly, prints play-by-play plus a team stats table, and saves the result):

```bash
npm run headless
```

Calibration (simulates N matches on throwaway copies of the teams with the local engine — nothing is saved and no API calls are made — and compares average team stats to real AFL):

```bash
npm run calibrate -- 20
```

## How it works

- **Physics** (`server/src/sim/`): a fixed 0.1s tick moves all 36 players and the ball. Players have acceleration, a top speed from their `speed` attribute, and fatigue that builds when sprinting (slower to build with high `endurance`) and recovers at quarter time. Kicks fly on real trajectories (a 50m kick hangs about 3s); loose balls roll and take odd bounces.
- **Team shape** (`movement.ts`, `formation.ts`): each player has a named position (full back, pockets, wings, rover, centre half-forward, ...) and a mirrored direct opponent. Teams shift and compress with the ball; defenders play on their opponent goal-side when the ball is near and zone off when it's away, with a spare dropping into the hole when defending deep. Forwards lead toward the ball carrier (their defender is caught flat-footed for a moment), midfielders run past for handball receives, and the nearest opponent closes down the carrier.
- **Rules emerge from positions**, not dice: whoever physically reaches the ball contests it. Marks need a 15m kick; contested marks are hard to hold and packs usually spill; tackles pay holding the ball only with prior opportunity, otherwise it's a ball-up, a handball out, or a dispossession. Ball-ups, throw-ins, out on the full, kick-ins after behinds, 50m arcs, the centre square, 6-6-6 at centre bounces, time-on, and after-the-siren kicks are all modelled.
- **Shooting** (`kicking.ts`): goals, behinds, posters and out-on-the-fulls come from where the ball actually crosses the line, driven by distance, angle, pressure, set shot vs snap, and execution quality.
- **Decisions**: when a player gets the ball, Jev chooses what they do (and rates how well they execute it, and who wins ruck and marking contests). Calls run in the background while play continues, so network latency never freezes the match; if Jev is slow or the key is rejected, the local engine answers instead.
- **Progression** (`server/src/progression/`): after each match, players get a chance to improve the attributes behind what they did a lot of (e.g. 4+ tackles → tackling, 15+ hitouts → marking), capped at their `potential`. Stats and results persist to `server/data/*.json`.
- **Commentary** is templated, not AI-generated text — Jev only returns structured probabilities, so broadcast lines are built from events and player names.
- **Rendering**: the server streams physics frames (~16 per second at the default pace) plus match events over WebSocket. The client plays frames back slightly delayed and interpolates between them, so motion stays smooth. Players have numbered jumpers, lean into their runs, and a lower third names the ball carrier. Reloading mid-match rejoins it live.

## How realistic are the numbers?

Average per team over 18 simulated matches (`npm run calibrate -- 18`) vs approximate recent AFL averages:

| Stat | Sim | AFL | | Stat | Sim | AFL |
|---|---|---|---|---|---|---|
| Points | 68 | 85 | | Handballs | 150 | 150 |
| Goals | 10.1 | 12.5 | | Hitouts | 45 | 38 |
| Accuracy | 58% | 53% | | Clearances | 38 | 37 |
| Inside 50s | 46 | 52 | | Free kicks | 15 | 18 |
| Kicks | 267 | 205 | | Marks | 121 | 88 |
| Tackles | 95 | 57 | | Contested marks | 22 | 11 |

Scoring, accuracy, handballs, stoppages, clearances and free kicks are close. Play still runs a bit fast, with more kicks, marks and tackles than a real game.

## Known limitations / next steps

- Squad size is fixed at 18 on-field players per team, no interchange/bench rotation (so fatigue only recovers at quarter time).
- Players are capsules — there's no skeletal animation for kicking, marking or tackling motions.
- Player aging/career decline across seasons isn't modeled yet — attributes only ever grow toward `potential`.
- `npm audit` flags a moderate advisory in Vite's bundled esbuild (dev-server only, not exploitable outside local dev); fixing it requires a Vite major-version bump.
- Only one match renders live at a time; the rest of a season's matches simulate the same way when you click through to them.
