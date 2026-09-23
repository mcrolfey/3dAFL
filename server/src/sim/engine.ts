import type {
  DecisionEngine,
  FieldPos,
  MatchClock,
  MatchEvent,
  Player,
  ScoreLine,
  Team,
  TeamSummary,
} from "@3dafl/shared";
import { clampField, isInForward50, goalSquare, randomJitter, FIELD_HALF_WIDTH } from "./field.js";
import { computeFormation } from "./formation.js";
import { config } from "../config.js";

const QUARTER_SECONDS = 20 * 60; // 20 simulated minutes per quarter

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function teamSummary(team: Team): TeamSummary {
  return {
    id: team.id,
    name: team.name,
    color: team.color,
    players: team.players.map((p, i) => ({ id: p.id, name: p.name, position: p.position, number: i + 1 })),
  };
}

function randomOf<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

function playersByRole(team: Team, roles: string[]): Player[] {
  const filtered = team.players.filter((p) => roles.includes(p.position));
  return filtered.length > 0 ? filtered : team.players;
}

function findPlayer(home: Team, away: Team, id: string): Player {
  return home.players.find((p) => p.id === id) ?? away.players.find((p) => p.id === id)!;
}

function otherTeam(home: Team, away: Team, teamId: string): Team {
  return teamId === home.id ? away : home;
}

function teamOf(home: Team, away: Team, teamId: string): Team {
  return teamId === home.id ? home : away;
}

function idealDisposalDistance(choice: string): number {
  switch (choice) {
    case "handball":
      return 8;
    case "kickShort":
      return 22;
    case "kickLong":
      return 55;
    default:
      return 0;
  }
}

/** Picks a real teammate to aim at: prefers whoever is further downfield and close to the disposal's typical range, so the ball always has a genuine intended receiver rather than an arbitrary point in space. */
function pickTarget(
  candidates: Player[],
  formationPos: Map<string, FieldPos>,
  ballPos: FieldPos,
  attackDir: 1 | -1,
  idealDistance: number,
): Player {
  const scored = candidates.map((p) => {
    const pos = formationPos.get(p.id) ?? ballPos;
    const dist = Math.hypot(pos.x - ballPos.x, pos.y - ballPos.y);
    const aheadness = (pos.x - ballPos.x) * attackDir;
    return { player: p, score: aheadness - Math.abs(dist - idealDistance) };
  });
  scored.sort((a, b) => b.score - a.score);
  const top = scored.slice(0, Math.min(3, scored.length));
  return top[Math.floor(Math.random() * top.length)].player;
}

/** Picks whichever candidate is physically closest to a reference spot (e.g. a defender near the ball's landing point). */
function pickNearest(candidates: Player[], formationPos: Map<string, FieldPos>, referencePos: FieldPos): Player {
  let best = candidates[0];
  let bestDist = Infinity;
  for (const p of candidates) {
    const pos = formationPos.get(p.id) ?? referencePos;
    const dist = Math.hypot(pos.x - referencePos.x, pos.y - referencePos.y);
    if (dist < bestDist) {
      bestDist = dist;
      best = p;
    }
  }
  return best;
}

export interface MatchSimOptions {
  matchId: string;
  home: Team;
  away: Team;
  decisionEngine: DecisionEngine;
  /** Sim-clock seconds per real second. Defaults to config.simSpeed; pass a very large number (e.g. 1e6) to run unpaced/instant. */
  simSpeed?: number;
}

/** Runs an entire AFL match start-to-finish, yielding MatchEvents as the game unfolds. No manual input required. */
export async function* simulateMatch(opts: MatchSimOptions): AsyncGenerator<MatchEvent, void, void> {
  const { home, away, decisionEngine } = opts;
  const simSpeed = opts.simSpeed ?? config.simSpeed;
  let quarter: 1 | 2 | 3 | 4 = 1;
  let secondsRemaining = QUARTER_SECONDS;
  let homeScore: ScoreLine = { goals: 0, behinds: 0 };
  let awayScore: ScoreLine = { goals: 0, behinds: 0 };
  let ballPos: FieldPos = { x: 0, y: 0 };
  let ballCarrierId: string | null = null;
  let possessionTeamId: string | null = null;

  yield { kind: "matchStart", matchId: opts.matchId, home: teamSummary(home), away: teamSummary(away) };

  function homeAttackDir(): 1 | -1 {
    return quarter % 2 === 1 ? 1 : -1;
  }
  function attackDirFor(teamId: string): 1 | -1 {
    const hd = homeAttackDir();
    return teamId === home.id ? hd : ((hd * -1) as 1 | -1);
  }

  function clockSnapshot(): MatchClock {
    return { quarter, secondsRemaining: Math.max(0, Math.round(secondsRemaining)) };
  }

  async function tickClock(seconds: number) {
    secondsRemaining -= seconds;
    const realMs = (seconds / simSpeed) * 1000;
    if (realMs > 0) await sleep(realMs);
  }

  async function emitPositions() {
    const positions = computeFormation(home, away, ballPos, homeAttackDir(), ballCarrierId);
    yield_buffer.push({ kind: "positions", positions, ballPos, ballCarrierId });
  }

  // Small buffer so we can emit auxiliary events (positions/clockSync) alongside the primary event each loop.
  let yield_buffer: MatchEvent[] = [];

  async function centerBounce(): Promise<void> {
    ballPos = { x: 0, y: 0 };
    const homeRuck = randomOf(playersByRole(home, ["RUCK"]));
    const awayRuck = randomOf(playersByRole(away, ["RUCK"]));
    const result = await decisionEngine.decideContest({
      kind: "ruck",
      attackerAttributes: homeRuck.attributes,
      defenderAttributes: awayRuck.attributes,
    });
    const winningTeam = result.success ? home : away;
    const winningRuck = result.success ? homeRuck : awayRuck;
    const nominatedMid = randomOf(playersByRole(winningTeam, ["MID"]));
    ballCarrierId = nominatedMid.id;
    possessionTeamId = winningTeam.id;
    yield_buffer.push({ kind: "centerBounce", wonByTeamId: winningTeam.id, wonByPlayerId: winningRuck.id });
    await emitPositions();
    await tickClock(4 + Math.random() * 4);
  }

  async function kickIn(scoringAgainstTeamId: string): Promise<void> {
    // The team that conceded the score kicks back into play from their own goal square.
    const defTeam = otherTeam(home, away, scoringAgainstTeamId);
    const dir = attackDirFor(defTeam.id);
    ballPos = goalSquare((dir * -1) as 1 | -1);
    const kicker = randomOf(playersByRole(defTeam, ["DEF"]));
    ballCarrierId = kicker.id;
    possessionTeamId = defTeam.id;
    yield_buffer.push({ kind: "kickIn", teamId: defTeam.id, playerId: kicker.id });
    await emitPositions();
    await tickClock(6 + Math.random() * 6);
  }

  async function throwIn(): Promise<void> {
    const homeMid = randomOf(playersByRole(home, ["MID", "DEF", "FWD"]));
    const awayMid = randomOf(playersByRole(away, ["MID", "DEF", "FWD"]));
    const result = await decisionEngine.decideContest({
      kind: "throwIn",
      attackerAttributes: homeMid.attributes,
      defenderAttributes: awayMid.attributes,
    });
    const winningTeam = result.success ? home : away;
    const winner = result.success ? homeMid : awayMid;
    ballCarrierId = winner.id;
    possessionTeamId = winningTeam.id;
    yield_buffer.push({ kind: "throwIn", wonByTeamId: winningTeam.id, wonByPlayerId: winner.id });
    await emitPositions();
    await tickClock(5 + Math.random() * 5);
  }

  async function resolveShot(playerId: string, teamId: string): Promise<void> {
    const player = findPlayer(home, away, playerId);
    const pressure = 0.3 + Math.random() * 0.3;
    const exec = await decisionEngine.decideExecutionQuality({
      playerId,
      attributes: player.attributes,
      disposal: "shootForGoal",
      pressure,
    });

    let result: "goal" | "behind" | "miss";
    if (exec.quality >= 0.65) result = "goal";
    else if (exec.quality >= 0.35) result = "behind";
    else result = "miss";

    if (result === "goal") {
      if (teamId === home.id) homeScore = { ...homeScore, goals: homeScore.goals + 1 };
      else awayScore = { ...awayScore, goals: awayScore.goals + 1 };
    } else if (result === "behind") {
      if (teamId === home.id) homeScore = { ...homeScore, behinds: homeScore.behinds + 1 };
      else awayScore = { ...awayScore, behinds: awayScore.behinds + 1 };
    }

    yield_buffer.push({ kind: "shotAtGoal", playerId, teamId, from: ballPos, result });
    await tickClock(8 + Math.random() * 4);

    if (result === "goal") {
      await centerBounce();
    } else {
      await kickIn(teamId);
    }
  }

  async function playOnEvent(): Promise<void> {
    if (!ballCarrierId || !possessionTeamId) return;
    const carrierTeam = teamOf(home, away, possessionTeamId);
    const defTeam = otherTeam(home, away, possessionTeamId);
    const carrier = findPlayer(home, away, ballCarrierId);
    const attackDir = attackDirFor(possessionTeamId);
    const inFwd50 = isInForward50(ballPos, attackDir);

    const underPressure = Math.random() < (inFwd50 ? 0.35 : 0.45);

    if (underPressure) {
      const tackler = randomOf(playersByRole(defTeam, ["MID", "DEF"]));
      const tackleResult = await decisionEngine.decideContest({
        kind: "tackle",
        attackerAttributes: tackler.attributes,
        defenderAttributes: carrier.attributes,
      });
      yield_buffer.push({ kind: "contest", playerId: tackler.id, opponentId: carrier.id, type: "tackle", success: tackleResult.success });
      if (tackleResult.success) {
        yield_buffer.push({ kind: "turnover", fromTeamId: possessionTeamId, toTeamId: defTeam.id, reason: "tackled" });
        ballCarrierId = tackler.id;
        possessionTeamId = defTeam.id;
        await emitPositions();
        await tickClock(4 + Math.random() * 4);
        return;
      }
    }

    // Resolve real teammate positions up front so every disposal aims at an actual player, not an arbitrary point.
    const formationPos = new Map(
      computeFormation(home, away, ballPos, homeAttackDir(), ballCarrierId).map((p) => [p.playerId, p.pos]),
    );

    const nearbyIds = carrierTeam.players
      .filter((p) => p.id !== carrier.id)
      .filter((p) => {
        const pos = formationPos.get(p.id) ?? ballPos;
        return Math.hypot(pos.x - ballPos.x, pos.y - ballPos.y) < 25;
      })
      .map((p) => p.id);

    const disposal = await decisionEngine.decideDisposal({
      playerId: carrier.id,
      attributes: carrier.attributes,
      fieldPos: ballPos,
      attackingDirection: attackDir,
      inForward50: inFwd50,
      underPressure,
      nearbyTeammateIds: nearbyIds,
    });

    if (disposal.choice === "shootForGoal") {
      await resolveShot(carrier.id, possessionTeamId);
      return;
    }

    const exec = await decisionEngine.decideExecutionQuality({
      playerId: carrier.id,
      attributes: carrier.attributes,
      disposal: disposal.choice,
      pressure: underPressure ? 0.5 : 0.15,
    });

    const idealDistance = idealDisposalDistance(disposal.choice);
    const candidateRoles = disposal.choice === "handball" ? ["MID", "DEF", "FWD", "RUCK"] : ["FWD", "MID"];
    const targetPlayer = pickTarget(
      playersByRole(carrierTeam, candidateRoles).filter((p) => p.id !== carrier.id),
      formationPos,
      ballPos,
      attackDir,
      idealDistance,
    );

    const outOfBoundsChance = disposal.choice === "kickLong" ? 0.12 : disposal.choice === "kickShort" ? 0.05 : 0;
    const wentOutOfBounds = Math.random() < outOfBoundsChance;

    const targetPos = formationPos.get(targetPlayer.id) ?? ballPos;
    const to = wentOutOfBounds
      ? clampField({
          x: ballPos.x + attackDir * idealDistance,
          y: (ballPos.y >= 0 ? 1 : -1) * (FIELD_HALF_WIDTH - 1),
        })
      : clampField({ x: targetPos.x + randomJitter(2), y: targetPos.y + randomJitter(2) });

    const effective = exec.quality >= (disposal.choice === "handball" ? 0.3 : 0.4);

    yield_buffer.push({
      kind: "disposal",
      playerId: carrier.id,
      teamId: possessionTeamId,
      type: disposal.choice === "handball" ? "handball" : "kick",
      targetPlayerId: wentOutOfBounds ? null : targetPlayer.id,
      from: ballPos,
      to,
      effective,
    });
    await tickClock(3 + Math.random() * 5);

    if (wentOutOfBounds) {
      ballPos = to;
      yield_buffer.push({ kind: "outOfBounds", teamId: possessionTeamId });
      await throwIn();
      return;
    }

    ballPos = to;

    if (disposal.choice === "handball") {
      if (effective) {
        ballCarrierId = targetPlayer.id;
      } else {
        // fumbled handball -> loose ball contest, contested by whoever from the opposition is nearest to where it landed
        const contender = pickNearest(playersByRole(defTeam, ["MID", "DEF", "FWD"]), formationPos, to);
        const groundResult = await decisionEngine.decideContest({
          kind: "groundBall",
          attackerAttributes: contender.attributes,
          defenderAttributes: carrier.attributes,
        });
        if (groundResult.success) {
          ballCarrierId = contender.id;
          possessionTeamId = defTeam.id;
          yield_buffer.push({ kind: "turnover", fromTeamId: carrierTeam.id, toTeamId: defTeam.id, reason: "fumble" });
        } else {
          ballCarrierId = carrier.id;
        }
      }
      await emitPositions();
      return;
    }

    // Kick: contest a mark between the intended target and the nearest defender to where it lands.
    const defender = pickNearest(playersByRole(defTeam, ["DEF", "RUCK"]), formationPos, to);

    if (effective) {
      const markResult = await decisionEngine.decideContest({
        kind: "mark",
        attackerAttributes: targetPlayer.attributes,
        defenderAttributes: defender.attributes,
      });
      yield_buffer.push({ kind: "contest", playerId: targetPlayer.id, opponentId: defender.id, type: "mark", success: markResult.success });
      if (markResult.success) {
        ballCarrierId = targetPlayer.id;
        possessionTeamId = carrierTeam.id;
      } else {
        const spoilResult = await decisionEngine.decideContest({
          kind: "groundBall",
          attackerAttributes: defender.attributes,
          defenderAttributes: targetPlayer.attributes,
        });
        if (spoilResult.success) {
          ballCarrierId = defender.id;
          possessionTeamId = defTeam.id;
          yield_buffer.push({ kind: "turnover", fromTeamId: carrierTeam.id, toTeamId: defTeam.id, reason: "spoiled" });
        } else {
          ballCarrierId = targetPlayer.id;
          possessionTeamId = carrierTeam.id;
        }
      }
    } else {
      // Wayward kick: contested ground ball near landing spot.
      const groundResult = await decisionEngine.decideContest({
        kind: "groundBall",
        attackerAttributes: defender.attributes,
        defenderAttributes: targetPlayer.attributes,
      });
      if (groundResult.success) {
        ballCarrierId = defender.id;
        possessionTeamId = defTeam.id;
        yield_buffer.push({ kind: "turnover", fromTeamId: carrierTeam.id, toTeamId: defTeam.id, reason: "wayward kick" });
      } else {
        ballCarrierId = targetPlayer.id;
        possessionTeamId = carrierTeam.id;
      }
    }

    await emitPositions();
  }

  await centerBounce();
  for (const ev of yield_buffer) yield ev;
  yield_buffer = [];

  while (quarter <= 4) {
    if (secondsRemaining <= 0) {
      yield { kind: "quarterEnd", quarter, homeScore, awayScore };
      if (quarter === 4) break;
      quarter = (quarter + 1) as 1 | 2 | 3 | 4;
      secondsRemaining = QUARTER_SECONDS;
      yield { kind: "clockSync", clock: clockSnapshot() };
      await centerBounce();
      for (const ev of yield_buffer) yield ev;
      yield_buffer = [];
      continue;
    }

    await playOnEvent();
    yield { kind: "clockSync", clock: clockSnapshot() };
    for (const ev of yield_buffer) yield ev;
    yield_buffer = [];
  }

  const winnerTeamId =
    homeScore.goals * 6 + homeScore.behinds > awayScore.goals * 6 + awayScore.behinds
      ? home.id
      : awayScore.goals * 6 + awayScore.behinds > homeScore.goals * 6 + homeScore.behinds
        ? away.id
        : null;

  yield { kind: "fullTime", homeScore, awayScore, winnerTeamId };
}
