export type Position = "FWD" | "MID" | "DEF" | "RUCK";

export interface Attributes {
  kicking: number;
  handballing: number;
  marking: number;
  tackling: number;
  speed: number;
  endurance: number;
  decisionMaking: number;
  goalKicking: number;
}

export type AttributeKey = keyof Attributes;

export interface SeasonStats {
  matchesPlayed: number;
  goals: number;
  behinds: number;
  disposals: number;
  tackles: number;
  marks: number;
}

export interface Player {
  id: string;
  name: string;
  teamId: string;
  position: Position;
  age: number;
  potential: number; // 1-99 ceiling that attributes trend toward
  attributes: Attributes;
  seasonStats: SeasonStats;
  careerGamesPlayed: number;
}

export interface Team {
  id: string;
  name: string;
  color: string; // hex
  players: Player[];
}

export interface LadderEntry {
  teamId: string;
  played: number;
  wins: number;
  losses: number;
  draws: number;
  pointsFor: number;
  pointsAgainst: number;
}

export interface ScheduledMatch {
  id: string;
  round: number;
  homeTeamId: string;
  awayTeamId: string;
  played: boolean;
  result?: MatchResult;
}

export interface MatchResult {
  homeScore: ScoreLine;
  awayScore: ScoreLine;
}

export interface ScoreLine {
  goals: number;
  behinds: number;
}

export function points(score: ScoreLine): number {
  return score.goals * 6 + score.behinds;
}

export interface Season {
  id: string;
  year: number;
  schedule: ScheduledMatch[];
  ladder: LadderEntry[];
  currentRound: number;
}

// --- Match simulation ---

export type MatchPhase =
  | "CENTER_BOUNCE"
  | "IN_PLAY"
  | "KICK_IN"
  | "THROW_IN"
  | "QUARTER_BREAK"
  | "FULL_TIME";

export interface FieldPos {
  /** meters from center; negative = toward home team's defensive goal, positive = toward away team's defensive goal */
  x: number;
  /** meters from center line, -65..65 */
  y: number;
}

export interface PlayerFieldState {
  playerId: string;
  pos: FieldPos;
}

export interface MatchClock {
  quarter: 1 | 2 | 3 | 4;
  secondsRemaining: number;
}

export interface MatchState {
  matchId: string;
  home: Team;
  away: Team;
  phase: MatchPhase;
  clock: MatchClock;
  ballPos: FieldPos;
  ballCarrierId: string | null;
  homeScore: ScoreLine;
  awayScore: ScoreLine;
  possessionTeamId: string | null;
  playerPositions: PlayerFieldState[];
  finished: boolean;
}

export type MatchEvent =
  | { kind: "matchStart"; matchId: string; home: TeamSummary; away: TeamSummary }
  | { kind: "centerBounce"; wonByTeamId: string; wonByPlayerId: string }
  | { kind: "disposal"; playerId: string; teamId: string; type: "kick" | "handball"; targetPlayerId: string | null; from: FieldPos; to: FieldPos; effective: boolean }
  | { kind: "contest"; playerId: string; opponentId: string | null; type: "tackle" | "mark" | "spoil" | "groundBall"; success: boolean }
  | { kind: "turnover"; fromTeamId: string; toTeamId: string; reason: string }
  | { kind: "outOfBounds"; teamId: string }
  | { kind: "throwIn"; wonByTeamId: string; wonByPlayerId: string }
  | { kind: "shotAtGoal"; playerId: string; teamId: string; from: FieldPos; result: "goal" | "behind" | "miss" }
  | { kind: "kickIn"; teamId: string; playerId: string }
  | { kind: "quarterEnd"; quarter: 1 | 2 | 3 | 4; homeScore: ScoreLine; awayScore: ScoreLine }
  | { kind: "fullTime"; homeScore: ScoreLine; awayScore: ScoreLine; winnerTeamId: string | null }
  | { kind: "clockSync"; clock: MatchClock }
  | { kind: "positions"; positions: PlayerFieldState[]; ballPos: FieldPos; ballCarrierId: string | null };

export interface CommentatedEvent {
  event: MatchEvent;
  text: string;
  homeScore: ScoreLine;
  awayScore: ScoreLine;
  clock: MatchClock;
}

export interface TeamSummary {
  id: string;
  name: string;
  color: string;
  players: { id: string; name: string; position: Position; number: number }[];
}

// --- Decision engine (Jev-backed or heuristic fallback) ---

export type DisposalChoice = "kickShort" | "kickLong" | "handball" | "shootForGoal";

export interface DisposalContext {
  playerId: string;
  attributes: Attributes;
  fieldPos: FieldPos;
  attackingDirection: 1 | -1;
  inForward50: boolean;
  underPressure: boolean;
  nearbyTeammateIds: string[];
}

export interface ContestContext {
  kind: "tackle" | "mark" | "spoil" | "groundBall" | "ruck" | "throwIn";
  attackerAttributes: Attributes;
  defenderAttributes: Attributes | null;
}

export interface ExecutionContext {
  playerId: string;
  attributes: Attributes;
  disposal: DisposalChoice;
  pressure: number; // 0-1
}

export interface DecisionEngine {
  name: string;
  decideDisposal(ctx: DisposalContext): Promise<{ choice: DisposalChoice; targetPlayerId: string | null; confidence: number }>;
  decideContest(ctx: ContestContext): Promise<{ success: boolean; confidence: number }>;
  decideExecutionQuality(ctx: ExecutionContext): Promise<{ quality: number; confidence: number }>;
}
