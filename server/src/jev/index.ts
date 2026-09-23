import type { ContestContext, DecisionEngine, DisposalContext, ExecutionContext } from "@3dafl/shared";
import { jevEnabled } from "../config.js";
import { JevDecisionEngine, LocalHeuristicDecisionEngine } from "./decisionEngine.js";

/** Wraps Jev calls with a per-call fallback to the local heuristic engine on error/rate-limit. */
class FallbackDecisionEngine implements DecisionEngine {
  name = "jev+fallback";
  private jev = new JevDecisionEngine();
  private local = new LocalHeuristicDecisionEngine();

  async decideDisposal(ctx: DisposalContext) {
    try {
      return await this.jev.decideDisposal(ctx);
    } catch (err) {
      logFallback("decideDisposal", err);
      return this.local.decideDisposal(ctx);
    }
  }

  async decideContest(ctx: ContestContext) {
    try {
      return await this.jev.decideContest(ctx);
    } catch (err) {
      logFallback("decideContest", err);
      return this.local.decideContest(ctx);
    }
  }

  async decideExecutionQuality(ctx: ExecutionContext) {
    try {
      return await this.jev.decideExecutionQuality(ctx);
    } catch (err) {
      logFallback("decideExecutionQuality", err);
      return this.local.decideExecutionQuality(ctx);
    }
  }
}

function logFallback(method: string, err: unknown) {
  const message = err instanceof Error ? err.message : String(err);
  console.warn(`[jev] ${method} failed, falling back to local heuristic: ${message}`);
}

export function createDecisionEngine(): DecisionEngine {
  if (!jevEnabled) {
    console.warn("[jev] TYPESAFE_API_KEY not set — using local heuristic decision engine only.");
    return new LocalHeuristicDecisionEngine();
  }
  return new FallbackDecisionEngine();
}
