import type {
  ContestContext,
  DecisionEngine,
  DisposalChoice,
  DisposalContext,
  ExecutionContext,
} from "@3dafl/shared";
import { callJev, JevError, type JevQuestion } from "./client.js";

export function norm(v: number): number {
  return Math.max(0, Math.min(1, v / 99));
}

function weightedPick<T extends string>(weights: Record<T, number>): T {
  const entries = Object.entries(weights) as [T, number][];
  const total = entries.reduce((sum, [, w]) => sum + Math.max(0, w), 0);
  let roll = Math.random() * total;
  for (const [key, w] of entries) {
    roll -= Math.max(0, w);
    if (roll <= 0) return key;
  }
  return entries[entries.length - 1][0];
}

function gaussian(): number {
  const u = 1 - Math.random();
  const v = Math.random();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

/** Rough chance a shot from here goes through for a goal — used by the local engine to judge whether to shoot. */
export function expectedGoalChance(distance: number, angleDeg: number, goalKicking: number, setShot: boolean): number {
  const base = 1.05 - distance / 55 - Math.max(0, angleDeg - 20) / 90;
  const skill = 0.75 + 0.5 * norm(goalKicking);
  return Math.max(0, Math.min(0.95, base * skill * (setShot ? 1.1 : 0.85)));
}

const EXECUTION_LEVELS = ["Poor", "Below average", "Good", "Elite"];

function disposalSkill(ctx: ExecutionContext): number {
  if (ctx.disposal === "handball") return norm(ctx.attributes.handballing);
  if (ctx.disposal === "shootForGoal") return norm(ctx.attributes.goalKicking);
  return norm(ctx.attributes.kicking);
}

function attackerSkillFor(ctx: ContestContext): number {
  const a = ctx.attackerAttributes;
  switch (ctx.kind) {
    case "tackle":
      return norm(a.tackling);
    case "mark":
    case "spoil":
    case "ruck":
    case "throwIn":
      return norm(a.marking);
    case "groundBall":
      return (norm(a.speed) + norm(a.handballing)) / 2;
  }
}

function defenderSkillFor(ctx: ContestContext): number {
  const d = ctx.defenderAttributes!;
  switch (ctx.kind) {
    case "tackle":
      return (norm(d.speed) + norm(d.decisionMaking)) / 2;
    case "mark":
    case "spoil":
    case "ruck":
    case "throwIn":
      return norm(d.marking);
    case "groundBall":
      return (norm(d.speed) + norm(d.handballing)) / 2;
  }
}

/** Real Jev-backed decision engine: every decision is a POST to TypeSafe AI's /v1/systemone. */
export class JevDecisionEngine implements DecisionEngine {
  name = "jev";

  async decideDisposal(ctx: DisposalContext): Promise<{ choice: DisposalChoice; confidence: number }> {
    const criteria: Record<string, string> = {
      handball: "Quick handball to a nearby teammate — safest under immediate pressure",
      kickShort: "Short-to-medium kick to an open or leading teammate",
      kickLong: "Long kick down the ground toward the forward line, even into a contest",
      run: ctx.protectedPossession
        ? "Play on: run off the mark to open up the angle or gain ground"
        : "Keep running with the ball, taking a bounce, to break the lines",
    };
    if (ctx.inScoringRange) {
      criteria.shootForGoal = ctx.protectedPossession
        ? "Take the set shot at goal"
        : "Snap or kick at goal on the run";
    }

    const questions: Record<string, JevQuestion> = {
      disposal: {
        type: "choice",
        instructions:
          "You are an AFL player with the ball. Choose the disposal an experienced player would make in this situation, weighing pressure, distance and angle to goal, and teammate options.",
        criteria,
      },
    };

    const state = {
      fieldPositionMeters: ctx.fieldPos,
      attackingDirection: ctx.attackingDirection,
      distanceToGoalMeters: Math.round(ctx.distanceToGoal),
      angleToGoalDegrees: Math.round(ctx.angleToGoalDeg),
      inForward50: ctx.inForward50,
      inScoringRange: ctx.inScoringRange,
      protectedPossession: ctx.protectedPossession,
      nearestOpponentMeters: Math.round(ctx.nearestOpponentDistance * 10) / 10,
      underPressure: ctx.underPressure,
      teammatesInHandballRange: ctx.nearbyTeammateIds.length,
      openTeammatesAhead: ctx.openTeammatesAhead,
      playerAttributes: {
        kicking: norm(ctx.attributes.kicking),
        handballing: norm(ctx.attributes.handballing),
        speed: norm(ctx.attributes.speed),
        decisionMaking: norm(ctx.attributes.decisionMaking),
        goalKicking: norm(ctx.attributes.goalKicking),
      },
    };

    const answers = await callJev(state, questions);
    const answer = answers.disposal;
    if (answer?.type !== "choice") throw new JevError("Unexpected answer shape for disposal");
    return { choice: answer.choice as DisposalChoice, confidence: answer.confidence };
  }

  async decideContest(ctx: ContestContext): Promise<{ success: boolean; confidence: number }> {
    const questions: Record<string, JevQuestion> = {
      contest: {
        type: "noul",
        instructions: `In an AFL ${ctx.kind} contest, does the attacking player win it?`,
        criteria: {
          true: "Attacker's relevant skill clearly outweighs the defender's, or there is no defender",
          false: "Defender's relevant skill matches or outweighs the attacker's",
        },
      },
    };

    const state = {
      contestType: ctx.kind,
      attackerSkill: attackerSkillFor(ctx),
      defenderSkill: ctx.defenderAttributes ? defenderSkillFor(ctx) : null,
      hasDefender: ctx.defenderAttributes !== null,
    };

    const answers = await callJev(state, questions);
    const answer = answers.contest;
    if (answer?.type !== "noul") throw new JevError("Unexpected answer shape for contest");
    // Sample from Jev's calibrated probability rather than thresholding, so evenly matched contests stay a coin flip.
    return { success: Math.random() < answer.noul, confidence: answer.noul };
  }

  async decideExecutionQuality(ctx: ExecutionContext): Promise<{ quality: number; confidence: number }> {
    const questions: Record<string, JevQuestion> = {
      execution: {
        type: "score",
        instructions: "Rate the execution quality of this AFL disposal attempt given the player's skill and the pressure on them.",
        criteria: EXECUTION_LEVELS,
      },
    };

    const state = {
      disposal: ctx.disposal,
      relevantSkill: disposalSkill(ctx),
      pressure: ctx.pressure,
    };

    const answers = await callJev(state, questions);
    const answer = answers.execution;
    if (answer?.type !== "score") throw new JevError("Unexpected answer shape for execution");
    return { quality: answer.score / (EXECUTION_LEVELS.length - 1), confidence: answer.confidence };
  }
}

/** Pure local fallback used when no TypeSafe API key is configured, or Jev is unavailable. */
export class LocalHeuristicDecisionEngine implements DecisionEngine {
  name = "local-heuristic";

  async decideDisposal(ctx: DisposalContext): Promise<{ choice: DisposalChoice; confidence: number }> {
    const a = ctx.attributes;
    const pressured = ctx.underPressure;
    const hasHandballOption = ctx.nearbyTeammateIds.length > 0;
    const goalChance = ctx.inScoringRange
      ? expectedGoalChance(ctx.distanceToGoal, ctx.angleToGoalDeg, a.goalKicking, ctx.protectedPossession)
      : 0;

    // Inside 50 from a poor spot, look for a teammate in a better position rather than blaze away.
    const lookingForBetter = ctx.inForward50 && goalChance < 0.3 && (hasHandballOption || ctx.openTeammatesAhead > 0);
    const weights: Record<DisposalChoice, number> = {
      shootForGoal: goalChance > 0.2 ? goalChance * (ctx.protectedPossession ? 10 : 7) : goalChance * 0.5,
      handball: ctx.protectedPossession || !hasHandballOption ? 0.05 : pressured ? 4.5 : 2.4,
      kickShort: ctx.openTeammatesAhead > 0 || lookingForBetter ? 2.4 : 0.6,
      kickLong: ctx.inForward50 ? 0.3 : ctx.distanceToGoal > 110 ? 1.8 : 1.1,
      run:
        ctx.nearestOpponentDistance > 10 && !ctx.inForward50
          ? 1.0 + 1.5 * norm(a.speed)
          : ctx.nearestOpponentDistance > 6
            ? 0.3
            : 0.05,
    };

    // Better decision-makers lean harder toward the best option instead of spreading their choices.
    const sharpness = 1 + 0.6 * norm(a.decisionMaking);
    for (const key of Object.keys(weights) as DisposalChoice[]) weights[key] = Math.pow(Math.max(0, weights[key]), sharpness);

    return { choice: weightedPick(weights), confidence: 0.6 };
  }

  async decideContest(ctx: ContestContext): Promise<{ success: boolean; confidence: number }> {
    const attackerSkill = attackerSkillFor(ctx) + 0.2;
    const defenderSkill = ctx.defenderAttributes ? defenderSkillFor(ctx) + 0.2 : 0.2;
    const p = attackerSkill / (attackerSkill + defenderSkill);
    return { success: Math.random() < p, confidence: p };
  }

  async decideExecutionQuality(ctx: ExecutionContext): Promise<{ quality: number; confidence: number }> {
    const quality = disposalSkill(ctx) - ctx.pressure * 0.25 + gaussian() * 0.12;
    return { quality: Math.max(0, Math.min(1, quality)), confidence: 0.5 };
  }
}
