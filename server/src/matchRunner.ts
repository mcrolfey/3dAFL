import type { CommentatedEvent, DecisionEngine, MatchClock, MatchEvent, MatchFrame, MatchResult, ScoreLine, Team } from "@3dafl/shared";
import { simulateMatch } from "./sim/engine.js";
import { Commentator } from "./commentary/commentary.js";

export interface MatchRunResult {
  result: MatchResult;
  /** every event except the high-frequency physics frames */
  events: MatchEvent[];
}

export interface RunMatchOptions {
  matchId: string;
  home: Team;
  away: Team;
  decisionEngine: DecisionEngine;
  /** sim seconds per real second; omit for the configured live pace */
  simSpeed?: number;
  /** the live pace, when it can be changed mid-match */
  liveSpeed?: () => number;
  onEvent?: (event: CommentatedEvent) => void | Promise<void>;
  onFrame?: (frame: MatchFrame) => void;
}

/** Runs a full match start-to-finish, streaming commentated events and physics frames, with zero manual input required. */
export async function runMatch(opts: RunMatchOptions): Promise<MatchRunResult> {
  const { matchId, home, away, decisionEngine, simSpeed, liveSpeed, onEvent, onFrame } = opts;
  const commentator = new Commentator(home, away);
  const events: MatchEvent[] = [];

  let homeScore: ScoreLine = { goals: 0, behinds: 0 };
  let awayScore: ScoreLine = { goals: 0, behinds: 0 };
  let clock: MatchClock = { quarter: 1, secondsRemaining: 20 * 60 };

  for await (const event of simulateMatch({ matchId, home, away, decisionEngine, simSpeed, liveSpeed })) {
    if (event.kind === "frame") {
      clock = event.frame.clock;
      onFrame?.(event.frame);
      // Lulls in play are when the expert gets a word in.
      const remark = event.frame.clockRunning ? commentator.remark(clock) : null;
      if (remark && onEvent) await onEvent({ event: { kind: "remark" }, ...remark, homeScore, awayScore, clock });
      continue;
    }

    events.push(event);
    if ("homeScore" in event) {
      homeScore = event.homeScore;
      awayScore = event.awayScore;
    }

    if (onEvent) {
      const line = commentator.describe(event, clock);
      await onEvent({ event, text: line?.text ?? "", priority: line?.priority ?? 0, homeScore, awayScore, clock });
    }
  }

  return { result: { homeScore, awayScore }, events };
}
