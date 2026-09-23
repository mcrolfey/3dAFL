# 3dAFL

A 3D AFL match simulator that runs automatically from start to finish, broadcast-style. Player attributes accumulate across matches, and in-match decisions (disposals, tackles, marks, shots on goal) are made by [Jev](https://typesafe.ai), TypeSafe AI's structured-decision model, with a local heuristic fallback so it always runs even without API access.

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

Headless (no browser, console play-by-play only — useful for quickly checking the sim/Jev integration):

```bash
npm run headless
```

## How it works

- **Match engine** (`server/src/sim/engine.ts`) is a possession-chain state machine: center bounce → disposal decisions → contests (tackle/mark/spoil/ground ball) → scoring → restart, repeated until full time. Every meaningful decision goes through a `DecisionEngine` (`server/src/jev/`) — either the real Jev API or the local fallback — blended with each player's attributes.
- **Progression** (`server/src/progression/`): after each match, players who performed well in a relevant stat get a chance to nudge that attribute up (capped at their `potential`). Stats and results persist to `server/data/*.json`, so a player is measurably better next time they take the field.
- **Commentary** is templated, not AI-generated text — Jev only returns structured probabilities, so broadcast lines are built from event + player name, not prose.
- **Rendering**: the server streams a `MatchEvent` per play over WebSocket; the client replays it into a Three.js scene (players, ball, camera, HUD) as it arrives.
- **Pacing**: the engine itself waits in real time between plays (scaled by `SIM_SPEED`), so a live-watched match unfolds at a deliberate, consistent pace rather than flooding events instantly. The client also counts the on-screen clock down smoothly frame-by-frame between updates, and eases players toward each new position, instead of jumping straight to each new value. `npm run headless` bypasses this pacing (runs near-instantly) since it's meant for quick console-only checks, not for watching.

## Known limitations / next steps

- Squad size is fixed at 18 on-field players per team, no interchange/bench rotation.
- Player aging/career decline across seasons isn't modeled yet — attributes only ever grow toward `potential`.
- `npm audit` flags a moderate advisory in Vite's bundled esbuild (dev-server only, not exploitable outside local dev); fixing it requires a Vite major-version bump.
- Only one match renders live at a time; the rest of a season's matches simulate the same way when you click through to them.
