import type { CommentatedEvent, DecisionEngine, MatchClock, MatchEvent, MatchResult, ScoreLine, Team } from "@3dafl/shared";
import { simulateMatch } from "./sim/engine.js";
import { buildPlayerLookup, commentate } from "./commentary/commentary.js";

export interface MatchRunResult {
  result: MatchResult;
  events: MatchEvent[];
}

/** Runs a full match start-to-finish, streaming commentated events via onEvent, with zero manual input required. */
export async function runMatch(
  matchId: string,
  home: Team,
  away: Team,
  decisionEngine: DecisionEngine,
  onEvent?: (event: CommentatedEvent) => void | Promise<void>,
  simSpeed?: number,
): Promise<MatchRunResult> {
  const lookup = buildPlayerLookup(home, away);
  const events: MatchEvent[] = [];

  let homeScore: ScoreLine = { goals: 0, behinds: 0 };
  let awayScore: ScoreLine = { goals: 0, behinds: 0 };
  let clock: MatchClock = { quarter: 1, secondsRemaining: 20 * 60 };

  for await (const event of simulateMatch({ matchId, home, away, decisionEngine, simSpeed })) {
    events.push(event);

    if (event.kind === "shotAtGoal" || event.kind === "quarterEnd" || event.kind === "fullTime") {
      if ("homeScore" in event) {
        homeScore = event.homeScore;
        awayScore = event.awayScore;
      } else if (event.kind === "shotAtGoal") {
        const isHome = event.teamId === home.id;
        if (event.result === "goal") {
          if (isHome) homeScore = { ...homeScore, goals: homeScore.goals + 1 };
          else awayScore = { ...awayScore, goals: awayScore.goals + 1 };
        } else if (event.result === "behind") {
          if (isHome) homeScore = { ...homeScore, behinds: homeScore.behinds + 1 };
          else awayScore = { ...awayScore, behinds: awayScore.behinds + 1 };
        }
      }
    }
    if (event.kind === "clockSync") clock = event.clock;

    if (onEvent) {
      const text = commentate(event, lookup);
      await onEvent({ event, text: text ?? "", homeScore, awayScore, clock });
    }
  }

  return { result: { homeScore, awayScore }, events };
}
