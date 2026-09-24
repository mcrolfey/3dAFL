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

export interface FieldPos {
  /** meters from center along the ground's length; home attacks +x in odd quarters */
  x: number;
  /** meters from center across the ground */
  y: number;
}

export interface MatchClock {
  quarter: 1 | 2 | 3 | 4;
  secondsRemaining: number;
}

/** A physics snapshot streamed many times per second while a match is live. */
export interface MatchFrame {
  clock: MatchClock;
  clockRunning: boolean;
  /** x, y, height */
  ball: [number, number, number];
  /** index into the matchStart roster (home players, then away players), -1 if nobody holds the ball */
  carrierIndex: number;
  /** flat [x0, y0, x1, y1, ...] in roster order */
  players: number[];
}

export type StoppageType = "centerBounce" | "ballUp" | "throwIn";
export type TackleOutcome = "holdingTheBall" | "ballUp" | "dispossessed" | "handballOut" | "broken";
export type ShotResult = "goal" | "behind" | "miss";

export type MatchEvent =
  | { kind: "matchStart"; matchId: string; home: TeamSummary; away: TeamSummary; simSpeed: number; frameInterval: number }
  | { kind: "frame"; frame: MatchFrame }
  | { kind: "stoppage"; type: StoppageType; at: FieldPos }
  | { kind: "hitout"; playerId: string; teamId: string }
  | { kind: "gather"; playerId: string; teamId: string; fromOpposition: boolean }
  | { kind: "disposal"; playerId: string; teamId: string; type: "kick" | "handball"; intent: DisposalChoice; targetPlayerId: string | null; quality: number; from: FieldPos; to: FieldPos }
  | { kind: "playOn"; playerId: string }
  | { kind: "bounce"; playerId: string }
  | { kind: "mark"; playerId: string; teamId: string; contested: boolean; intercept: boolean }
  | { kind: "spoil"; playerId: string; opponentId: string }
  | { kind: "droppedMark"; playerId: string }
  | { kind: "tackle"; playerId: string; teamId: string; opponentId: string; outcome: TackleOutcome }
  | { kind: "freeKick"; playerId: string; teamId: string; reason: string }
  | { kind: "clearance"; playerId: string; teamId: string }
  | { kind: "insideFifty"; playerId: string; teamId: string }
  | { kind: "outOfBounds"; onTheFull: boolean; lastTeamId: string }
  | { kind: "shotAtGoal"; playerId: string; teamId: string; distance: number; setShot: boolean; result: ShotResult; homeScore: ScoreLine; awayScore: ScoreLine }
  | { kind: "rushedBehind"; teamId: string; homeScore: ScoreLine; awayScore: ScoreLine }
  | { kind: "kickIn"; teamId: string; playerId: string }
  | { kind: "quarterEnd"; quarter: 1 | 2 | 3 | 4; homeScore: ScoreLine; awayScore: ScoreLine }
  | { kind: "fullTime"; homeScore: ScoreLine; awayScore: ScoreLine; winnerTeamId: string | null };

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

export type DisposalChoice = "kickShort" | "kickLong" | "handball" | "shootForGoal" | "run";

export interface DisposalContext {
  playerId: string;
  attributes: Attributes;
  fieldPos: FieldPos;
  attackingDirection: 1 | -1;
  inForward50: boolean;
  underPressure: boolean;
  /** teammates within handball range who aren't closely checked */
  nearbyTeammateIds: string[];
  distanceToGoal: number;
  angleToGoalDeg: number;
  inScoringRange: boolean;
  /** mark or free kick: can't be tackled and may take their time */
  protectedPossession: boolean;
  nearestOpponentDistance: number;
  /** open teammates further downfield within kicking range */
  openTeammatesAhead: number;
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
  /** What the ball carrier does. Who they aim at is resolved spatially by the engine. */
  decideDisposal(ctx: DisposalContext): Promise<{ choice: DisposalChoice; confidence: number }>;
  decideContest(ctx: ContestContext): Promise<{ success: boolean; confidence: number }>;
  decideExecutionQuality(ctx: ExecutionContext): Promise<{ quality: number; confidence: number }>;
}
