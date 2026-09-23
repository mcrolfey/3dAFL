import type {
  Attributes,
  ContestContext,
  DecisionEngine,
  DisposalChoice,
  DisposalContext,
  ExecutionContext,
} from "@3dafl/shared";
import { callJev, JevError, type JevQuestion } from "./client.js";

function norm(v: number): number {
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

const EXECUTION_LEVELS = ["Poor", "Below average", "Good", "Elite"];

/** Real Jev-backed decision engine: every decision is a POST to TypeSafe AI's /v1/systemone. */
export class JevDecisionEngine implements DecisionEngine {
  name = "jev";

  async decideDisposal(ctx: DisposalContext): Promise<{ choice: DisposalChoice; targetPlayerId: string | null; confidence: number }> {
    const criteria: Record<string, string> = {
      handball: "Short, low-risk handball to a nearby teammate",
      kickShort: "Short-to-medium kick to a teammate in space",
      kickLong: "Long kick down the field toward the attacking end",
    };
    if (ctx.inForward50) {
      criteria.shootForGoal = "Kick directly at goal to score";
    }

    const questions: Record<string, JevQuestion> = {
      disposal: {
        type: "choice",
        instructions: "You are an AFL player with the ball. Given the game situation, which disposal do you make?",
        criteria,
      },
    };

    const state = {
      fieldPositionMeters: ctx.fieldPos,
      attackingDirection: ctx.attackingDirection,
      inForward50: ctx.inForward50,
      underPressure: ctx.underPressure,
      nearbyTeammateCount: ctx.nearbyTeammateIds.length,
      playerAttributes: {
        kicking: norm(ctx.attributes.kicking),
        handballing: norm(ctx.attributes.handballing),
        decisionMaking: norm(ctx.attributes.decisionMaking),
        goalKicking: norm(ctx.attributes.goalKicking),
      },
    };

    const answers = await callJev(state, questions);
    const answer = answers.disposal;
    if (answer?.type !== "choice") throw new JevError("Unexpected answer shape for disposal");

    const choice = answer.choice as DisposalChoice;
    const targetPlayerId =
      choice === "handball" || choice === "kickShort"
        ? ctx.nearbyTeammateIds[Math.floor(Math.random() * ctx.nearbyTeammateIds.length)] ?? null
        : null;

    return { choice, targetPlayerId, confidence: answer.confidence };
  }

  async decideContest(ctx: ContestContext): Promise<{ success: boolean; confidence: number }> {
    const attackerSkill = attackerSkillFor(ctx);
    const defenderSkill = ctx.defenderAttributes ? defenderSkillFor(ctx) : 0.4;

    const questions: Record<string, JevQuestion> = {
      contest: {
        type: "noul",
        instructions: `In an AFL ${ctx.kind} contest, does the attacking player win possession/the contest?`,
        criteria: {
          true: "Attacker's relevant skill clearly outweighs the defender's, or there is no defender",
          false: "Defender's relevant skill matches or outweighs the attacker's",
        },
      },
    };

    const state = {
      contestType: ctx.kind,
      attackerSkill,
      defenderSkill,
      hasDefender: ctx.defenderAttributes !== null,
    };

    const answers = await callJev(state, questions);
    const answer = answers.contest;
    if (answer?.type !== "noul") throw new JevError("Unexpected answer shape for contest");

    return { success: answer.noul >= 0.5, confidence: answer.noul };
  }

  async decideExecutionQuality(ctx: ExecutionContext): Promise<{ quality: number; confidence: number }> {
    const skill =
      ctx.disposal === "handball"
        ? norm(ctx.attributes.handballing)
        : ctx.disposal === "shootForGoal"
          ? norm(ctx.attributes.goalKicking)
          : norm(ctx.attributes.kicking);

    const questions: Record<string, JevQuestion> = {
      execution: {
        type: "score",
        instructions: "Rate the execution quality of this AFL disposal attempt.",
        criteria: EXECUTION_LEVELS,
      },
    };

    const state = {
      disposal: ctx.disposal,
      relevantSkill: skill,
      pressure: ctx.pressure,
    };

    const answers = await callJev(state, questions);
    const answer = answers.execution;
    if (answer?.type !== "score") throw new JevError("Unexpected answer shape for execution");

    return { quality: answer.score / (EXECUTION_LEVELS.length - 1), confidence: answer.confidence };
  }
}

function attackerSkillFor(ctx: ContestContext): number {
  const a = ctx.attackerAttributes;
  switch (ctx.kind) {
    case "tackle":
      return norm(a.tackling);
    case "mark":
      return norm(a.marking);
    case "spoil":
      return norm(a.marking);
    case "groundBall":
    case "ruck":
    case "throwIn":
      return norm(a.speed);
    default:
      return 0.5;
  }
}

function defenderSkillFor(ctx: ContestContext): number {
  const d = ctx.defenderAttributes!;
  switch (ctx.kind) {
    case "tackle":
      return norm(d.speed);
    case "mark":
    case "spoil":
      return norm(d.marking);
    default:
      return norm(d.speed);
  }
}

/** Pure local fallback used when no TypeSafe API key is configured, or Jev is unavailable. */
export class LocalHeuristicDecisionEngine implements DecisionEngine {
  name = "local-heuristic";

  async decideDisposal(ctx: DisposalContext): Promise<{ choice: DisposalChoice; targetPlayerId: string | null; confidence: number }> {
    const weights: Record<DisposalChoice, number> = {
      handball: ctx.underPressure ? 3 : 1,
      kickShort: 2,
      kickLong: ctx.inForward50 ? 0.5 : 2,
      shootForGoal: ctx.inForward50 ? 2 + norm(ctx.attributes.goalKicking) * 3 : 0,
    };
    const choice = weightedPick(weights);
    const targetPlayerId =
      choice === "handball" || choice === "kickShort"
        ? ctx.nearbyTeammateIds[Math.floor(Math.random() * ctx.nearbyTeammateIds.length)] ?? null
        : null;
    return { choice, targetPlayerId, confidence: 0.6 };
  }

  async decideContest(ctx: ContestContext): Promise<{ success: boolean; confidence: number }> {
    const attackerSkill = attackerSkillFor(ctx);
    const defenderSkill = ctx.defenderAttributes ? defenderSkillFor(ctx) : 0.35;
    const p = attackerSkill / (attackerSkill + defenderSkill);
    return { success: Math.random() < p, confidence: p };
  }

  async decideExecutionQuality(ctx: ExecutionContext): Promise<{ quality: number; confidence: number }> {
    const skill =
      ctx.disposal === "handball"
        ? norm(ctx.attributes.handballing)
        : ctx.disposal === "shootForGoal"
          ? norm(ctx.attributes.goalKicking)
          : norm(ctx.attributes.kicking);
    const noise = (Math.random() - 0.5) * 0.3;
    const quality = Math.max(0, Math.min(1, skill - ctx.pressure * 0.2 + noise));
    return { quality, confidence: 0.5 };
  }
}
