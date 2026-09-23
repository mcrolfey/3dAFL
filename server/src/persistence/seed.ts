import type { Attributes, LadderEntry, Player, Position, ScheduledMatch, Season, Team } from "@3dafl/shared";

const TEAM_NAMES = [
  { name: "Coastal Sharks", color: "#1f6fb2" },
  { name: "Ironbark Crows", color: "#2c2c2c" },
  { name: "Outback Devils", color: "#c0392b" },
  { name: "Harbour Swans", color: "#e8b923" },
  { name: "Ridgeline Hawks", color: "#6a3ea1" },
  { name: "Saltwater Tigers", color: "#e07b1f" },
];

const FIRST_NAMES = [
  "Jack", "Tom", "Will", "Sam", "Ben", "Josh", "Nathan", "Liam", "Ryan", "Cody",
  "Dylan", "Ethan", "Blake", "Riley", "Connor", "Hayden", "Jarrod", "Zach", "Levi", "Marcus",
];
const LAST_NAMES = [
  "Anderson", "Bailey", "Carter", "Dawson", "Ellis", "Fraser", "Grant", "Hughes",
  "Ingram", "Jones", "Kelly", "Lawson", "Mitchell", "Nolan", "O'Brien", "Parker",
  "Quinn", "Reid", "Sinclair", "Turner",
];

function randInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function randomName(): string {
  const first = FIRST_NAMES[randInt(0, FIRST_NAMES.length - 1)];
  const last = LAST_NAMES[randInt(0, LAST_NAMES.length - 1)];
  return `${first} ${last}`;
}

const POSITION_LAYOUT: Position[] = [
  ...Array(6).fill("DEF"),
  ...Array(6).fill("MID"),
  ...Array(4).fill("FWD"),
  ...Array(2).fill("RUCK"),
] as Position[];

function baseAttributesFor(position: Position): Attributes {
  const base = () => randInt(45, 70);
  const attrs: Attributes = {
    kicking: base(),
    handballing: base(),
    marking: base(),
    tackling: base(),
    speed: base(),
    endurance: base(),
    decisionMaking: base(),
    goalKicking: base(),
  };
  switch (position) {
    case "FWD":
      attrs.goalKicking += randInt(10, 20);
      attrs.marking += randInt(5, 15);
      break;
    case "MID":
      attrs.endurance += randInt(10, 20);
      attrs.decisionMaking += randInt(10, 15);
      attrs.handballing += randInt(5, 10);
      break;
    case "DEF":
      attrs.tackling += randInt(10, 20);
      attrs.marking += randInt(5, 10);
      break;
    case "RUCK":
      attrs.marking += randInt(10, 20);
      attrs.tackling += randInt(5, 10);
      break;
  }
  for (const key of Object.keys(attrs) as (keyof Attributes)[]) {
    attrs[key] = Math.max(1, Math.min(99, attrs[key]));
  }
  return attrs;
}

function makePlayer(teamId: string, position: Position): Player {
  const attributes = baseAttributesFor(position);
  const avgAttr = Object.values(attributes).reduce((a, b) => a + b, 0) / 8;
  return {
    id: crypto.randomUUID(),
    name: randomName(),
    teamId,
    position,
    age: randInt(18, 33),
    potential: Math.min(99, Math.round(avgAttr + randInt(5, 25))),
    attributes,
    seasonStats: { matchesPlayed: 0, goals: 0, behinds: 0, disposals: 0, tackles: 0, marks: 0 },
    careerGamesPlayed: 0,
  };
}

export function seedTeams(): Team[] {
  return TEAM_NAMES.map(({ name, color }) => {
    const id = crypto.randomUUID();
    const players = POSITION_LAYOUT.map((position) => makePlayer(id, position));
    return { id, name, color, players };
  });
}

export function seedSeason(teams: Team[], year: number): Season {
  const schedule: ScheduledMatch[] = [];
  let round = 1;
  for (let i = 0; i < teams.length; i++) {
    for (let j = i + 1; j < teams.length; j++) {
      schedule.push({
        id: crypto.randomUUID(),
        round,
        homeTeamId: teams[i].id,
        awayTeamId: teams[j].id,
        played: false,
      });
      round++;
    }
  }
  const ladder: LadderEntry[] = teams.map((t) => ({
    teamId: t.id,
    played: 0,
    wins: 0,
    losses: 0,
    draws: 0,
    pointsFor: 0,
    pointsAgainst: 0,
  }));
  return { id: crypto.randomUUID(), year, schedule, ladder, currentRound: 1 };
}
