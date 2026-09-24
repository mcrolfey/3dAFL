import type { ContestContext, DecisionEngine, DisposalContext, ExecutionContext } from "@3dafl/shared";
import { jevEnabled } from "../config.js";
import { JevError } from "./client.js";
import { JevDecisionEngine, LocalHeuristicDecisionEngine } from "./decisionEngine.js";

/** Wraps Jev calls with a per-call fallback to the local heuristic engine on error/rate-limit. */
class FallbackDecisionEngine implements DecisionEngine {
  name = "jev+fallback";
  private jev = new JevDecisionEngine();
  private local = new LocalHeuristicDecisionEngine();
  private authFailed = false;

  private async attempt<T>(method: string, jevCall: () => Promise<T>, localCall: () => Promise<T>): Promise<T> {
    if (this.authFailed) return localCall();
    try {
      return await jevCall();
    } catch (err) {
      if (err instanceof JevError && err.status === 401) {
        // A bad key won't fix itself mid-session; stop paying a network round-trip per decision.
        this.authFailed = true;
        console.warn("[jev] API key rejected (401) — using the local heuristic engine for the rest of this session.");
      } else {
        const message = err instanceof Error ? err.message : String(err);
        console.warn(`[jev] ${method} failed, falling back to local heuristic: ${message}`);
      }
      return localCall();
    }
  }

  decideDisposal(ctx: DisposalContext) {
    return this.attempt("decideDisposal", () => this.jev.decideDisposal(ctx), () => this.local.decideDisposal(ctx));
  }

  decideContest(ctx: ContestContext) {
    return this.attempt("decideContest", () => this.jev.decideContest(ctx), () => this.local.decideContest(ctx));
  }

  decideExecutionQuality(ctx: ExecutionContext) {
    return this.attempt(
      "decideExecutionQuality",
      () => this.jev.decideExecutionQuality(ctx),
      () => this.local.decideExecutionQuality(ctx),
    );
  }
}

export function createDecisionEngine(): DecisionEngine {
  if (!jevEnabled) {
    console.warn("[jev] TYPESAFE_API_KEY not set — using local heuristic decision engine only.");
    return new LocalHeuristicDecisionEngine();
  }
  return new FallbackDecisionEngine();
}
