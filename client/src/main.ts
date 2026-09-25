import * as THREE from "three";
import type { CommentatedEvent, TeamSummary } from "@3dafl/shared";
import { fetchState, setSpeed, startMatch, startNextSeason, type StateResponse } from "./net/api.js";
import { LiveMatchSocket } from "./net/wsClient.js";
import { FrameBuffer } from "./net/frameBuffer.js";
import { buildField, GOAL_LINE_X } from "./scene/field.js";
import { PlayersManager } from "./scene/players.js";
import { Stadium } from "./scene/stadium.js";
import { BallView } from "./scene/ball.js";
import { CameraDirector, type CameraMode } from "./camera/cameraDirector.js";
import { Hud } from "./hud/hud.js";
import { StatsPanel } from "./hud/statsPanel.js";
import { AudioEngine } from "./audio/audioEngine.js";
import { Voices } from "./audio/voices.js";
import { MatchAudio } from "./audio/matchAudio.js";

const canvas = document.getElementById("scene") as HTMLCanvasElement;
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(2, window.devicePixelRatio));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x87ceeb);
scene.fog = new THREE.Fog(0x87ceeb, 220, 520);
scene.add(buildField());
const stadium = new Stadium();
scene.add(stadium.group);

const sun = new THREE.DirectionalLight(0xffffff, 1.1);
sun.position.set(60, 100, -40);
sun.castShadow = true;
sun.shadow.camera.left = -110;
sun.shadow.camera.right = 110;
sun.shadow.camera.top = 90;
sun.shadow.camera.bottom = -90;
sun.shadow.camera.far = 300;
sun.shadow.mapSize.set(2048, 2048);
scene.add(new THREE.AmbientLight(0xffffff, 0.35), new THREE.HemisphereLight(0xcfe8ff, 0x3d5a2a, 0.5), sun);

const director = new CameraDirector(window.innerWidth / window.innerHeight);
const ball = new BallView(scene);
const hud = new Hud();
const frames = new FrameBuffer();
const statsPanel = new StatsPanel();
const sfx = new AudioEngine();
const voices = new Voices();
const matchAudio = new MatchAudio(sfx, voices, director.camera, () => ball.mesh.position);

// --- camera: Auto mixes the sideline camera with drone shots; TV and Drone lock to one style ---

const CAMERA_PREF_KEY = "3dafl.camera";
const CAMERA_MODES: CameraMode[] = ["auto", "tv", "drone"];
const cameraBtn = document.getElementById("camera-btn") as HTMLButtonElement;
function setCameraMode(mode: CameraMode) {
  director.setMode(mode);
  cameraBtn.textContent = `Camera: ${mode === "auto" ? "Auto" : mode === "tv" ? "TV" : "Drone"}`;
  try {
    localStorage.setItem(CAMERA_PREF_KEY, mode);
  } catch {
    // not persisted; fine
  }
}
function cycleCameraMode() {
  setCameraMode(CAMERA_MODES[(CAMERA_MODES.indexOf(director.mode) + 1) % CAMERA_MODES.length]);
}
cameraBtn.addEventListener("click", cycleCameraMode);
window.addEventListener("keydown", (e) => {
  if (e.key.toLowerCase() === "c" && !e.ctrlKey && !e.metaKey && !e.altKey) cycleCameraMode();
});
let savedCameraMode: string | null = null;
try {
  savedCameraMode = localStorage.getItem(CAMERA_PREF_KEY);
} catch {
  // storage unavailable — default to auto
}
setCameraMode(CAMERA_MODES.includes(savedCameraMode as CameraMode) ? (savedCameraMode as CameraMode) : "auto");

// --- pace: real time (a 20-minute quarter takes 20 minutes plus time-on) or the normal quicker pace ---

const paceBtn = document.getElementById("pace-btn") as HTMLButtonElement;
let pace = { simSpeed: 4, normalSpeed: 4 };
let frameInterval = 0.25;
function showPace() {
  paceBtn.textContent = pace.simSpeed === 1 ? "Pace: Real time" : `Pace: ${pace.simSpeed}×`;
}
function applyPace(simSpeed: number, normalSpeed: number, interval = frameInterval) {
  const changed = simSpeed !== pace.simSpeed || interval !== frameInterval;
  pace = { simSpeed, normalSpeed };
  frameInterval = interval;
  if (changed) frames.configure(frameInterval, simSpeed, false);
  showPace();
}
paceBtn.addEventListener("click", () => {
  void setSpeed(pace.simSpeed === 1 ? pace.normalSpeed : 1);
});
showPace();

// --- sound: browsers only allow audio after a click, so it switches on at the first one ---

const SOUND_PREF_KEY = "3dafl.sound";
let soundWanted = true;
try {
  soundWanted = localStorage.getItem(SOUND_PREF_KEY) !== "off";
} catch {
  // storage unavailable (private window etc.) — default to on
}

function applySound() {
  sfx.setEnabled(soundWanted);
  voices.enabled = soundWanted && sfx.running;
  if (!soundWanted) voices.silence();
  hud.setSoundState(!sfx.running ? (soundWanted ? "locked" : "off") : soundWanted ? "on" : "off");
  try {
    localStorage.setItem(SOUND_PREF_KEY, soundWanted ? "on" : "off");
  } catch {
    // not persisted; fine
  }
}

async function unlockSound() {
  if (soundWanted && !sfx.running) {
    await sfx.unlock();
    applySound();
  }
}

hud.onSoundClick(async () => {
  if (!sfx.running) {
    soundWanted = true;
    await sfx.unlock();
  } else {
    soundWanted = !soundWanted;
  }
  applySound();
});
document.addEventListener("pointerdown", (e) => {
  // The sound button handles its own click; unlocking here first would make that click toggle sound straight back off.
  if ((e.target as Element | null)?.closest("#sound-btn")) return;
  void unlockSound();
});
applySound();

const COMMENTARY_PREF_KEY = "3dafl.commentary";
try {
  voices.commentaryOn = localStorage.getItem(COMMENTARY_PREF_KEY) !== "off";
} catch {
  // storage unavailable — default to on
}
hud.setCommentaryState(voices.commentaryOn);
hud.onCommentaryClick(() => {
  voices.commentaryOn = !voices.commentaryOn;
  if (!voices.commentaryOn) voices.silence();
  hud.setCommentaryState(voices.commentaryOn);
  try {
    localStorage.setItem(COMMENTARY_PREF_KEY, voices.commentaryOn ? "on" : "off");
  } catch {
    // not persisted; fine
  }
});

interface RosterEntry {
  number: number;
  name: string;
  team: string;
  color: string;
}

let players: PlayersManager | null = null;
let roster: RosterEntry[] = [];
let rosterIds: string[] = [];
let teamNames = { home: "Home", away: "Away" };
let homeTeamId = "";
let homeCount = 18;
let currentQuarter = 1;
let lastAttackDir: 1 | -1 = 1;
const lastBallPos = new THREE.Vector3();

/** Home attacks toward +x in odd quarters; the teams swap ends each quarter. */
function attackDirOfTeam(teamId: string): 1 | -1 {
  const homeDir: 1 | -1 = currentQuarter % 2 === 1 ? 1 : -1;
  return teamId === homeTeamId ? homeDir : ((-homeDir) as 1 | -1);
}
let currentMatchId: string | null = null;
let nextMatchTimer: number | null = null;
let seasonComplete = false;

function rosterFrom(home: TeamSummary, away: TeamSummary): RosterEntry[] {
  return [home, away].flatMap((team) => team.players.map((p) => ({ number: p.number, name: p.name, team: team.name, color: team.color })));
}

async function refreshLadder(): Promise<StateResponse> {
  const state = await fetchState();
  hud.setLadder(state.ladder, state.teams, state.season.year);
  applyPace(state.simSpeed, state.normalSpeed);
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
  const { home, away, simSpeed } = ce.event;
  frameInterval = ce.event.frameInterval;
  currentMatchId = matchId;
  teamNames = { home: home.name, away: away.name };
  roster = rosterFrom(home, away);
  rosterIds = [...home.players, ...away.players].map((p) => p.id);
  homeTeamId = home.id;
  homeCount = home.players.length;
  statsPanel.setTeams(home, away);
  stadium.setTeams(home, away);
  players?.dispose();
  players = new PlayersManager(scene, home, away);
  frames.reset();
  frames.configure(frameInterval, simSpeed);
  pace.simSpeed = simSpeed;
  showPace();
  matchAudio.setRoster(home.players.length);
  hud.setTeams(home.name, away.name);
  hud.clearCommentary();
  hud.hideFullTime();
  hud.setStartEnabled(false, "Match in progress...");
}

/** Tells the camera director about the moments it has special shots for. */
function directCamera(event: CommentatedEvent["event"]) {
  switch (event.kind) {
    case "stoppage":
      if (event.type === "centerBounce") director.onCentreBounce();
      else director.onStoppage(new THREE.Vector3(event.at.x, 0, event.at.y));
      break;
    case "mark": {
      const kicker = event.inScoringRange ? players?.positionOf(event.playerId) : null;
      if (kicker) director.onSetShot(kicker, new THREE.Vector3(attackDirOfTeam(event.teamId) * GOAL_LINE_X, 0, 0));
      break;
    }
    case "disposal":
      director.onDisposal();
      break;
    case "shotAtGoal":
      if (event.result === "goal") director.onGoal(ball.mesh.position.x >= 0 ? GOAL_LINE_X : -GOAL_LINE_X);
      break;
  }
}

function handleEvent(ce: CommentatedEvent) {
  const event = ce.event;
  // Events arrive a beat before the frames showing them are played back; hold everything until then so the
  // scoreboard, commentary, sounds and animations all land on the moment you see.
  window.setTimeout(() => {
    hud.updateScore(ce.homeScore, ce.awayScore);
    stadium.setScore(ce.homeScore, ce.awayScore);
    if (event.kind === "shotAtGoal") stadium.cheer(event.result === "goal" ? 1 : event.result === "behind" ? 0.3 : 0);
    if (event.kind === "mark" && event.contested) stadium.cheer(0.35);
    const remark = event.kind === "remark";
    if (ce.text) hud.pushCommentary(ce.text, remark);
    voices.commentate(ce.text, ce.priority, remark ? "expert" : "caller");
    matchAudio.onEvent(event);
    if (event.kind === "disposal") players?.playDisposal(event.playerId, event.type, event.from, event.to);
    if (event.kind === "tackle") players?.playTackle(event.playerId, event.opponentId, event.outcome === "broken");
    if (event.kind === "spoil") players?.playSpoil(event.playerId);
    if (event.kind === "hitout") players?.playRuckLeap(event.playerId);
    directCamera(event);
    if (event.kind === "fullTime") {
      hud.showFullTime(teamNames.home, teamNames.away, event.homeScore, event.awayScore);
    }
  }, frames.delay);
}

async function beginMatch() {
  if (nextMatchTimer !== null) {
    clearTimeout(nextMatchTimer);
    nextMatchTimer = null;
  }
  hud.hideFullTime();
  hud.setStartEnabled(false, "Starting...");
  try {
    const started = await startMatch();
    // A 409 means a match is already running; its events are on their way over the socket.
    if ("error" in started && !started.error.includes("already in progress")) {
      offerNext(await refreshLadder(), false);
    }
  } catch {
    hud.setStartEnabled(true, "Server offline — retry");
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
    case "stats":
      if (msg.matchId === currentMatchId) statsPanel.update(msg.players);
      break;
    case "speed":
      applyPace(msg.simSpeed, msg.normalSpeed, msg.frameInterval);
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
  director.onResize(window.innerWidth / window.innerHeight);
});

const clock = new THREE.Clock();
function animate() {
  requestAnimationFrame(animate);
  const delta = Math.min(0.1, clock.getDelta());

  const sample = frames.sample(performance.now());
  if (sample && players) {
    players.update(sample.players, sample.frame.carrierIndex, sample.ball, sample.frame.clock.quarter, delta);
    ball.update(sample.ball[0], sample.ball[1], sample.ball[2], delta);
    hud.updateClock(sample.frame.clock, sample.frame.clockRunning);
    stadium.setClock(sample.frame.clock.quarter, sample.frame.clock.secondsRemaining);
    hud.setCarrier(roster[sample.frame.carrierIndex] ?? null);
    statsPanel.highlight(rosterIds[sample.frame.carrierIndex] ?? null);
    matchAudio.onFrame(sample, delta);

    currentQuarter = sample.frame.clock.quarter;
    const carrier = sample.frame.carrierIndex;
    if (carrier >= 0) {
      const homeDir: 1 | -1 = currentQuarter % 2 === 1 ? 1 : -1;
      lastAttackDir = carrier < homeCount ? homeDir : ((-homeDir) as 1 | -1);
    }
  }

  const ballVelocity = delta > 0 ? ball.mesh.position.clone().sub(lastBallPos).divideScalar(delta) : new THREE.Vector3();
  lastBallPos.copy(ball.mesh.position);
  stadium.update(delta);
  director.update(delta, { ball: ball.mesh.position, ballVelocity, attackDir: lastAttackDir });
  renderer.render(scene, director.camera);
}
animate();

refreshLadder().then((state) => {
  if (!currentMatchId) offerNext(state, false);
});
