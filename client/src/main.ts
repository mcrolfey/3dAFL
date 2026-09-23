import * as THREE from "three";
import type { CommentatedEvent, MatchClock, MatchEvent, Team, TeamSummary } from "@3dafl/shared";
import { fetchState, startMatch } from "./net/api.js";
import { LiveMatchSocket } from "./net/wsClient.js";
import { buildField, HALF_LENGTH } from "./scene/field.js";
import { PlayersManager } from "./scene/players.js";
import { BallController } from "./scene/ball.js";
import { BroadcastCamera } from "./camera/broadcastCamera.js";
import { Hud } from "./hud/hud.js";

const canvas = document.getElementById("scene") as HTMLCanvasElement;
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(2, window.devicePixelRatio));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x87ceeb);
scene.fog = new THREE.Fog(0x87ceeb, 150, 400);
scene.add(buildField());

const ambient = new THREE.AmbientLight(0xffffff, 0.6);
const sun = new THREE.DirectionalLight(0xffffff, 1.1);
sun.position.set(60, 100, -40);
sun.castShadow = true;
sun.shadow.camera.left = -110;
sun.shadow.camera.right = 110;
sun.shadow.camera.top = 90;
sun.shadow.camera.bottom = -90;
sun.shadow.camera.far = 300;
sun.shadow.mapSize.set(2048, 2048);
scene.add(ambient, sun);

const broadcastCamera = new BroadcastCamera(window.innerWidth / window.innerHeight);
const ball = new BallController(scene);
const hud = new Hud();

let players: PlayersManager | null = null;
let currentMatchId: string | null = null;
let teams: Team[] = [];
let simSpeed = 4;

// The server only sends a clock update once per play; we count down smoothly in between
// (scaled by simSpeed) instead of letting the on-screen clock jump straight to each new value.
let clockBaseline: MatchClock = { quarter: 1, secondsRemaining: 20 * 60 };
let clockBaselineAt = performance.now();

function setClockBaseline(c: MatchClock) {
  clockBaseline = c;
  clockBaselineAt = performance.now();
}

function toTeamSummary(team: Team): TeamSummary {
  return {
    id: team.id,
    name: team.name,
    color: team.color,
    players: team.players.map((p, i) => ({ id: p.id, name: p.name, position: p.position, number: i + 1 })),
  };
}

function fieldToWorld(x: number, z: number) {
  return new THREE.Vector3(x, 0, z);
}

async function refreshLadder() {
  const state = await fetchState();
  teams = state.teams;
  simSpeed = state.simSpeed;
  hud.setLadder(state.ladder, state.teams);
  return state;
}

function handleEvent(ce: CommentatedEvent) {
  const event: MatchEvent = ce.event;

  hud.updateScore(ce.homeScore, ce.awayScore);
  setClockBaseline(ce.clock);
  if (ce.text) hud.pushCommentary(ce.text);

  if (!players) return;

  switch (event.kind) {
    case "positions": {
      players.setPositions(event.positions);
      players.setBallCarrier(event.ballCarrierId);
      if (!ball.isFlying()) ball.snapTo(fieldToWorld(event.ballPos.x, event.ballPos.y));
      break;
    }
    case "disposal": {
      const from = fieldToWorld(event.from.x, event.from.y);
      const to = fieldToWorld(event.to.x, event.to.y);
      ball.kickTo(from, to, event.type === "handball" ? 0.4 : 1.1, event.type === "handball" ? 1.5 : 6);
      break;
    }
    case "shotAtGoal": {
      const goalX = event.from.x >= 0 ? HALF_LENGTH : -HALF_LENGTH;
      if (event.result === "goal") broadcastCamera.triggerGoalReplay(goalX);
      break;
    }
    case "fullTime": {
      const home = teams.find((t) => t.id === currentMatchHomeId);
      const away = teams.find((t) => t.id === currentMatchAwayId);
      hud.showFullTime(home?.name ?? "Home", away?.name ?? "Away", event.homeScore, event.awayScore);
      break;
    }
  }
}

let currentMatchHomeId = "";
let currentMatchAwayId = "";

async function beginMatch() {
  hud.hideFullTime();
  hud.clearCommentary();
  hud.setStartEnabled(false, "Match in progress...");

  const started = await startMatch();
  if ("error" in started) {
    hud.setStartEnabled(true, "Start Match");
    return;
  }

  currentMatchId = started.matchId;
  currentMatchHomeId = started.homeTeamId;
  currentMatchAwayId = started.awayTeamId;

  const home = teams.find((t) => t.id === started.homeTeamId)!;
  const away = teams.find((t) => t.id === started.awayTeamId)!;
  hud.setTeams(toTeamSummary(home), toTeamSummary(away));

  players?.dispose();
  players = new PlayersManager(scene, toTeamSummary(home), toTeamSummary(away));
  setClockBaseline({ quarter: 1, secondsRemaining: 20 * 60 });
}

const socket = new LiveMatchSocket();
socket.onMessage((msg) => {
  if (msg.type === "commentatedEvent" && msg.matchId === currentMatchId) {
    handleEvent(msg.payload);
  }
  if (msg.type === "matchEnded" && msg.matchId === currentMatchId) {
    hud.setStartEnabled(false, "Match complete");
    refreshLadder().then((state) => {
      const nextAvailable = state.season.schedule.some((m) => !m.played);
      if (nextAvailable) {
        setTimeout(() => beginMatch(), 6000);
        hud.setStartEnabled(true, "Watch Next Match Now");
      } else {
        hud.setStartEnabled(false, "Season complete");
      }
    });
  }
});
socket.connect();

hud.onStartClick(() => beginMatch());
hud.onNextMatchClick(() => beginMatch());

window.addEventListener("resize", () => {
  renderer.setSize(window.innerWidth, window.innerHeight);
  broadcastCamera.onResize(window.innerWidth / window.innerHeight);
});

const clock = new THREE.Clock();
function animate() {
  requestAnimationFrame(animate);
  const delta = Math.min(0.1, clock.getDelta());
  players?.update(delta);
  ball.update(delta);
  broadcastCamera.update(delta, ball.mesh.position);
  renderer.render(scene, broadcastCamera.camera);

  const elapsedSim = ((performance.now() - clockBaselineAt) / 1000) * simSpeed;
  const displaySeconds = Math.max(0, clockBaseline.secondsRemaining - elapsedSim);
  hud.updateClock({ quarter: clockBaseline.quarter, secondsRemaining: Math.round(displaySeconds) });
}
animate();

refreshLadder().then(() => {
  hud.setStartEnabled(true, "Start Match");
});
