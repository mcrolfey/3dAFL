import express from "express";
import cors from "cors";
import http from "node:http";
import { config } from "./config.js";
import { loadTeams, loadSeason, saveTeams, saveSeason, resetAll } from "./persistence/store.js";
import { nextScheduledMatch, recordMatchResult, sortedLadder, startNextSeason } from "./progression/season.js";
import { applyProgressionToTeam } from "./progression/progression.js";
import { aggregateMatchStats } from "./progression/stats.js";
import { createDecisionEngine } from "./jev/index.js";
import { runMatch } from "./matchRunner.js";
import { Hub } from "./ws/hub.js";

const app = express();
app.use(cors());
app.use(express.json());

let teams = loadTeams();
let season = loadSeason(teams);
const decisionEngine = createDecisionEngine();

const server = http.createServer(app);
const hub = new Hub(server);

let runningMatchId: string | null = null;

app.get("/api/state", (_req, res) => {
  res.json({ teams, season, ladder: sortedLadder(season), decisionEngine: decisionEngine.name });
});

app.get("/api/season", (_req, res) => {
  res.json({ season, ladder: sortedLadder(season) });
});

app.post("/api/reset", (_req, res) => {
  const fresh = resetAll();
  teams = fresh.teams;
  season = fresh.season;
  runningMatchId = null;
  res.json({ teams, season });
});

app.post("/api/season/next", (_req, res) => {
  if (nextScheduledMatch(season)) {
    res.status(409).json({ error: "The current season still has matches to play" });
    return;
  }
  season = startNextSeason(teams, season);
  saveTeams(teams);
  saveSeason(season);
  res.json({ season, ladder: sortedLadder(season) });
});

app.post("/api/match/start", (req, res) => {
  if (runningMatchId) {
    res.status(409).json({ error: "A match is already in progress", matchId: runningMatchId });
    return;
  }

  const requestedId = req.body?.matchId as string | undefined;
  const scheduled = requestedId
    ? season.schedule.find((m) => m.id === requestedId && !m.played)
    : nextScheduledMatch(season);

  if (!scheduled) {
    res.status(404).json({ error: "No unplayed scheduled match available" });
    return;
  }

  const home = teams.find((t) => t.id === scheduled.homeTeamId)!;
  const away = teams.find((t) => t.id === scheduled.awayTeamId)!;

  runningMatchId = scheduled.id;
  res.status(202).json({ matchId: scheduled.id, homeTeamId: home.id, awayTeamId: away.id });
  hub.broadcast({ type: "matchStarted", matchId: scheduled.id, homeTeamId: home.id, awayTeamId: away.id });

  runMatch({
    matchId: scheduled.id,
    home,
    away,
    decisionEngine,
    onEvent: (commentatedEvent) => {
      const message = { type: "commentatedEvent" as const, matchId: scheduled.id, payload: commentatedEvent };
      if (commentatedEvent.event.kind === "matchStart") hub.setWelcome(message);
      hub.broadcast(message);
    },
    onFrame: (frame) => hub.broadcast({ type: "frame", matchId: scheduled.id, frame }),
  })
    .then(({ result, events }) => {
      const matchStats = aggregateMatchStats(events);
      applyProgressionToTeam(home, matchStats);
      applyProgressionToTeam(away, matchStats);
      recordMatchResult(season, scheduled.id, result);
      saveTeams(teams);
      saveSeason(season);
      hub.broadcast({ type: "matchEnded", matchId: scheduled.id, result });
    })
    .catch((err) => {
      console.error("[match] simulation failed", err);
    })
    .finally(() => {
      runningMatchId = null;
      hub.setWelcome(null);
    });
});

server.listen(config.port, () => {
  console.log(`3dAFL server listening on http://localhost:${config.port} (decision engine: ${decisionEngine.name})`);
});
