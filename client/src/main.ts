import * as THREE from "three";
import type { CommentatedEvent, TeamSummary } from "@3dafl/shared";
import { fetchState, startMatch, startNextSeason, type StateResponse } from "./net/api.js";
import { LiveMatchSocket } from "./net/wsClient.js";
import { FrameBuffer } from "./net/frameBuffer.js";
import { buildField, HALF_LENGTH } from "./scene/field.js";
import { PlayersManager } from "./scene/players.js";
import { BallView } from "./scene/ball.js";
import { BroadcastCamera } from "./camera/broadcastCamera.js";
import { Hud } from "./hud/hud.js";

const canvas = document.getElementById("scene") as HTMLCanvasElement;
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(2, window.devicePixelRatio));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x87ceeb);
scene.fog = new THREE.Fog(0x87ceeb, 180, 450);
scene.add(buildField());

const sun = new THREE.DirectionalLight(0xffffff, 1.1);
sun.position.set(60, 100, -40);
sun.castShadow = true;
sun.shadow.camera.left = -110;
sun.shadow.camera.right = 110;
sun.shadow.camera.top = 90;
sun.shadow.camera.bottom = -90;
sun.shadow.camera.far = 300;
sun.shadow.mapSize.set(2048, 2048);
scene.add(new THREE.AmbientLight(0xffffff, 0.6), sun);

const broadcastCamera = new BroadcastCamera(window.innerWidth / window.innerHeight);
const ball = new BallView(scene);
const hud = new Hud();
const frames = new FrameBuffer();

interface RosterEntry {
  number: number;
  name: string;
  team: string;
  color: string;
}

let players: PlayersManager | null = null;
let roster: RosterEntry[] = [];
let teamNames = { home: "Home", away: "Away" };
let currentMatchId: string | null = null;
let nextMatchTimer: number | null = null;
let seasonComplete = false;

function rosterFrom(home: TeamSummary, away: TeamSummary): RosterEntry[] {
  return [home, away].flatMap((team) => team.players.map((p) => ({ number: p.number, name: p.name, team: team.name, color: team.color })));
}

async function refreshLadder(): Promise<StateResponse> {
  const state = await fetchState();
  hud.setLadder(state.ladder, state.teams, state.season.year);
  seasonComplete = !state.season.schedule.some((m) => !m.played);
  return state;
}

/** Offers what comes next — the next match, or rolling into a new season — optionally continuing on its own. */
function offerNext(state: StateResponse, autoContinue: boolean) {
  const label = seasonComplete ? `Start ${state.season.year + 1} Season` : autoContinue ? "Watch Next Match Now" : "Start Match";
  hud.setStartEnabled(true, label);
  if (autoContinue) nextMatchTimer = window.setTimeout(() => advance(), 8000);
}

async function advance() {
  if (seasonComplete) {
    await startNextSeason();
    await refreshLadder();
  }
  await beginMatch();
}

function setUpMatch(matchId: string, ce: CommentatedEvent) {
  if (ce.event.kind !== "matchStart") return;
  const { home, away, frameInterval, simSpeed } = ce.event;
  currentMatchId = matchId;
  teamNames = { home: home.name, away: away.name };
  roster = rosterFrom(home, away);
  players?.dispose();
  players = new PlayersManager(scene, home, away);
  frames.reset();
  frames.configure(frameInterval, simSpeed);
  hud.setTeams(home.name, away.name);
  hud.clearCommentary();
  hud.hideFullTime();
  hud.setStartEnabled(false, "Match in progress...");
}

function handleEvent(ce: CommentatedEvent) {
  hud.updateScore(ce.homeScore, ce.awayScore);
  if (ce.text) hud.pushCommentary(ce.text);

  const event = ce.event;
  if (event.kind === "shotAtGoal" && event.result === "goal") {
    broadcastCamera.triggerGoalReplay(ball.mesh.position.x >= 0 ? HALF_LENGTH : -HALF_LENGTH);
  }
  if (event.kind === "fullTime") {
    hud.showFullTime(teamNames.home, teamNames.away, event.homeScore, event.awayScore);
  }
}

async function beginMatch() {
  if (nextMatchTimer !== null) {
    clearTimeout(nextMatchTimer);
    nextMatchTimer = null;
  }
  hud.hideFullTime();
  hud.setStartEnabled(false, "Starting...");
  const started = await startMatch();
  // A 409 means a match is already running; its events are on their way over the socket.
  if ("error" in started && !started.error.includes("already in progress")) {
    offerNext(await refreshLadder(), false);
  }
}

const socket = new LiveMatchSocket();
socket.onMessage((msg) => {
  switch (msg.type) {
    case "commentatedEvent":
      if (msg.payload.event.kind === "matchStart") setUpMatch(msg.matchId, msg.payload);
      if (msg.matchId === currentMatchId) handleEvent(msg.payload);
      break;
    case "frame":
      if (msg.matchId === currentMatchId) frames.push(msg.frame);
      break;
    case "matchEnded":
      if (msg.matchId !== currentMatchId) break;
      hud.setCarrier(null);
      // Keep rolling on its own — next match, or next season — the button lets you skip the wait.
      refreshLadder().then((state) => offerNext(state, true));
      break;
  }
});
socket.connect();

hud.onStartClick(() => advance());
hud.onNextMatchClick(() => advance());

window.addEventListener("resize", () => {
  renderer.setSize(window.innerWidth, window.innerHeight);
  broadcastCamera.onResize(window.innerWidth / window.innerHeight);
});

const clock = new THREE.Clock();
function animate() {
  requestAnimationFrame(animate);
  const delta = Math.min(0.1, clock.getDelta());

  const sample = frames.sample(performance.now());
  if (sample && players) {
    players.update(sample.players, sample.frame.carrierIndex, delta);
    ball.update(sample.ball[0], sample.ball[1], sample.ball[2], delta);
    hud.updateClock(sample.frame.clock, sample.frame.clockRunning);
    hud.setCarrier(roster[sample.frame.carrierIndex] ?? null);
  }

  broadcastCamera.update(delta, ball.mesh.position);
  renderer.render(scene, broadcastCamera.camera);
}
animate();

refreshLadder().then((state) => {
  if (!currentMatchId) offerNext(state, false);
});
