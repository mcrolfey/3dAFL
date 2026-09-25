# 3dAFL

A 3D AFL match simulator that runs automatically from start to finish, broadcast-style. Every player and the ball are physically simulated on the ground; player decisions (handball, kick short, go long, run and bounce, shoot, play on) . Player attributes accumulate across a season.

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

`SIM_SPEED` controls playback pace: how many sim-clock seconds pass per real second while a match is being watched live (default `4`, so a 20-minute quarter plays out over ~5 real minutes). Lower it for a slower, more realistic pace; raise it to blitz through a match faster. While watching, the **Pace** button (top left) switches between real time (1x, so a quarter takes a real 20 minutes plus time-on) and the `SIM_SPEED` pace; it takes effect immediately, even mid-match.

## Running it

```bash
npm run dev
```

Starts the server on `:8787` and the client on `:5173`. Open `http://localhost:5173`, click **Start Match**, and watch — the match runs unattended through all four quarters, and the app auto-advances to the next scheduled match once the previous one finishes, progressing the season automatically. When every fixture is played it rolls into the next season: same players with the attributes they've built up, a year older, fresh season stats, and a reshuffled fixture.

Headless (no browser: plays the next scheduled match instantly, prints play-by-play plus a team stats table, and saves the result):

```bash
npm run headless
```

Calibration (simulates N matches on throwaway copies of the teams with the local engine — nothing is saved and no API calls are made — and compares average team stats to real AFL):

```bash
npm run calibrate -- 20
```

## How it works

- **Physics** (`server/src/sim/`): a fixed 0.1s tick moves all 36 players and the ball. Players have acceleration, a top speed from their `speed` attribute, and fatigue that builds when sprinting (slower to build with high `endurance`) and recovers at quarter time. Kicks fly on real trajectories under real gravity (a flat 20m pass is in the air ~1.1s, a lofted 50m bomb ~3.3s); spills pop off bodies, and loose balls roll and take odd bounces.
- **Team shape** (`movement.ts`, `formation.ts`): each player has a named position (full back, pockets, wings, rover, centre half-forward, ...) and a mirrored direct opponent. Teams shift and compress with the ball; defenders play on their opponent goal-side when the ball is near and zone off when it's away, with a spare dropping into the hole when defending deep. Forwards lead toward the ball carrier (their defender is caught flat-footed for a moment), midfielders run past for handball receives, and the nearest opponent closes down the carrier.
- **Rules emerge from positions**, not dice: whoever physically reaches the ball contests it. Marks need a 15m kick; contested marks are hard to hold and packs usually spill; tackles pay holding the ball only with prior opportunity, otherwise it's a ball-up, a handball out, or a dispossession. Ball-ups, throw-ins, out on the full, kick-ins after behinds (opponents clear of the goal square, the man on the mark at its top), 50m arcs, the centre square, 6-6-6 at centre bounces, time-on (the clock stops for scores, out of bounds and every ball-up), and after-the-siren kicks are all modelled. Restarts keep to AFL time limits: set shots take 15-25s (limit 30s), marks and frees around the ground 3-8s (limit 8s).
- **Shooting** (`kicking.ts`): goals, behinds, posters and out-on-the-fulls come from where the ball actually crosses the line, driven by distance, angle, pressure, set shot vs snap, and execution quality.
- **Decisions**: when a player gets the ball, Jev chooses what they do (and rates how well they execute it, and who wins ruck and marking contests). Calls run in the background while play continues, so network latency never freezes the match; if Jev is slow or the key is rejected, the local engine answers instead.
- **Progression** (`server/src/progression/`): after each match, players get a chance to improve the attributes behind what they did a lot of (e.g. 4+ tackles → tackling, 15+ hitouts → marking), capped at their `potential`. Stats and results persist to `server/data/*.json`.
- **Commentary** (`server/src/commentary/`) is templated, not AI-generated — Jev only returns structured probabilities. A stateful commentator tracks goals, disposals, tackles, the margin and scoring runs so lines carry context, and gives each line a priority. In the browser, a play-by-play caller and an expert speak them through the system's speech voices (an Australian voice if installed): big moments cut in, routine lines wait their turn, stale ones are dropped.
- **Sound** is synthesised live with the Web Audio API (no audio files): crowd, umpire whistle and siren, ball impacts, player calls. Browsers allow sound only after a click; the top-left buttons toggle sound and spoken commentary.
- **Rendering**: the server streams physics frames (~16 per second at the default pace) plus match events over WebSocket. The client plays frames back slightly delayed and interpolates between them, so motion stays smooth. Players have numbered jumpers, lean into their runs, and a lower third names the ball carrier. Reloading mid-match rejoins it live.

## How realistic are the numbers?

Average per team over 16 simulated matches (`npm run calibrate -- 16`) vs approximate recent AFL averages:

| Stat | Sim | AFL | | Stat | Sim | AFL |
|---|---|---|---|---|---|---|
| Points | 75 | 85 | | Disposals | 431 | 355 |
| Goals | 10.7 | 12.5 | | Hitouts | 46 | 38 |
| Accuracy | 51% | 53% | | Clearances | 39 | 37 |
| Shots | 23 | 25 | | Free kicks | 16 | 18 |
| Inside 50s | 49 | 52 | | Handballs | 145 | 150 |
| Kicks | 287 | 205 | | Marks | 99 | 88 |
| Tackles | 60 | 57 | | Contested marks | 18 | 11 |

**AFL Fantasy spread** (the stats panel's AF column uses the official formula). Real teams spread their points over 22 players with interchange; the sim plays 18 with no bench, so real per-player figures are scaled by 22/18 for a fair comparison:

| Per team | Sim | Real (18-player) |
|---|---|---|
| Median player AF | 98 | 98 |
| Top AF | 165 | 153 |
| Top disposals | 40 | 36 |
| Midfield avg AF | 124 | 116 |
| Ruck avg AF | 128 | 110 |
| Backs avg AF | 74 | 92 |
| Forwards avg AF | 97 | 76 |

Scoring, shots, tackles, handballs, clearances, frees and the median fantasy score are close. Play still has too many kicks (and so too many disposals) — the ball goes kick-to-kick more than in a real game — forwards get a little too much of the ball and backs not enough, and the best player on each team scores ~8% high.

## Known limitations / next steps

- Squad size is fixed at 18 on-field players per team, no interchange/bench rotation (so fatigue only recovers at quarter time).
- Players are capsules — there's no skeletal animation for kicking, marking or tackling motions.
- Player aging/career decline across seasons isn't modeled yet — attributes only ever grow toward `potential`.
- `npm audit` flags a moderate advisory in Vite's bundled esbuild (dev-server only, not exploitable outside local dev); fixing it requires a Vite major-version bump.
- Only one match renders live at a time; the rest of a season's matches simulate the same way when you click through to them.
