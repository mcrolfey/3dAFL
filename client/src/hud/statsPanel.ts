import { fantasyPoints, type PlayerStatLine, type TeamSummary } from "@3dafl/shared";

interface Column {
  label: string;
  title: string;
  value: (s: PlayerStatLine) => number;
  display?: (s: PlayerStatLine) => string;
}

const COLUMNS: Column[] = [
  { label: "AF", title: "AFL Fantasy points (kick 3, handball 2, mark 3, tackle 4, hitout 1, goal 6, behind 1, free +1 / -3)", value: fantasyPoints },
  { label: "D", title: "Disposals", value: (s) => s.disposals },
  { label: "K", title: "Kicks", value: (s) => s.kicks },
  { label: "H", title: "Handballs", value: (s) => s.handballs },
  { label: "M", title: "Marks", value: (s) => s.marks },
  { label: "T", title: "Tackles", value: (s) => s.tackles },
  { label: "G.B", title: "Goals.Behinds", value: (s) => s.goals * 6 + s.behinds, display: (s) => `${s.goals}.${s.behinds}` },
  { label: "CL", title: "Clearances", value: (s) => s.clearances },
  { label: "I50", title: "Inside 50s", value: (s) => s.insideFifties },
  { label: "HO", title: "Hitouts", value: (s) => s.hitouts },
];

const TEAM_TOTALS: { label: string; value: (s: PlayerStatLine) => number }[] = [
  { label: "Disposals", value: (s) => s.disposals },
  { label: "Marks", value: (s) => s.marks },
  { label: "Tackles", value: (s) => s.tackles },
  { label: "Inside 50s", value: (s) => s.insideFifties },
  { label: "Clearances", value: (s) => s.clearances },
];

const EMPTY: PlayerStatLine = {
  kicks: 0,
  handballs: 0,
  disposals: 0,
  marks: 0,
  contestedMarks: 0,
  tackles: 0,
  goals: 0,
  behinds: 0,
  hitouts: 0,
  clearances: 0,
  insideFifties: 0,
  freesFor: 0,
  freesAgainst: 0,
};

const PREF_KEY = "3dafl.stats";

function cell(tag: "td" | "th", text: string, className?: string, title?: string): HTMLElement {
  const el = document.createElement(tag);
  el.textContent = text;
  if (className) el.className = className;
  if (title) el.title = title;
  return el;
}

/** Live box score, broadcast-style: one team at a time, sorted by disposals, with the ball carrier highlighted. */
export class StatsPanel {
  private readonly root = document.getElementById("stats-panel")!;
  private readonly tabs = Array.from(this.root.querySelectorAll<HTMLButtonElement>(".stats-tab"));
  private readonly summary = document.getElementById("stats-summary")!;
  private readonly body = this.root.querySelector("tbody")!;
  private readonly button = document.getElementById("stats-btn") as HTMLButtonElement;
  private teams: TeamSummary[] = [];
  private activeTeam = 0;
  private stats: Record<string, PlayerStatLine> = {};
  private carrierId: string | null = null;
  private rowsById = new Map<string, HTMLTableRowElement>();
  /** which column the table is sorted by — fantasy points by default */
  private sortColumn = 0;
  private readonly headers: HTMLElement[];

  constructor() {
    const head = this.root.querySelector("thead tr")!;
    this.headers = COLUMNS.map((c, i) => {
      const th = cell("th", c.label, "sortable", `${c.title} — click to sort`);
      th.addEventListener("click", () => {
        this.sortColumn = i;
        this.render();
      });
      return th;
    });
    head.replaceChildren(cell("th", "#"), cell("th", "Pos", undefined, "Named position"), cell("th", "Player", "name"), ...this.headers);

    this.tabs.forEach((tab, i) => tab.addEventListener("click", () => this.showTeam(i)));
    this.button.addEventListener("click", () => this.setOpen(this.root.classList.contains("hidden")));
    window.addEventListener("keydown", (e) => {
      if (e.key.toLowerCase() === "s" && !e.ctrlKey && !e.metaKey && !e.altKey) this.setOpen(this.root.classList.contains("hidden"));
    });

    let open = false;
    try {
      open = localStorage.getItem(PREF_KEY) === "open";
    } catch {
      // storage unavailable — start closed
    }
    this.setOpen(open);
  }

  private setOpen(open: boolean) {
    this.root.classList.toggle("hidden", !open);
    this.button.classList.toggle("off", !open);
    this.button.textContent = open ? "Stats: On" : "Stats: Off";
    try {
      localStorage.setItem(PREF_KEY, open ? "open" : "closed");
    } catch {
      // not persisted; fine
    }
  }

  setTeams(home: TeamSummary, away: TeamSummary) {
    this.teams = [home, away];
    this.stats = {};
    this.tabs.forEach((tab, i) => {
      tab.textContent = this.teams[i].name;
      tab.style.setProperty("--team-color", this.teams[i].color);
    });
    this.showTeam(this.activeTeam);
  }

  update(stats: Record<string, PlayerStatLine>) {
    this.stats = stats;
    this.render();
  }

  highlight(playerId: string | null) {
    if (playerId === this.carrierId) return;
    this.rowsById.get(this.carrierId ?? "")?.classList.remove("carrier");
    this.carrierId = playerId;
    this.rowsById.get(playerId ?? "")?.classList.add("carrier");
  }

  private showTeam(index: number) {
    this.activeTeam = index;
    this.tabs.forEach((tab, i) => tab.classList.toggle("active", i === index));
    this.render();
  }

  private render() {
    const team = this.teams[this.activeTeam];
    if (!team) return;
    const lines = team.players.map((p) => ({ player: p, s: this.stats[p.id] ?? EMPTY }));
    const sortBy = COLUMNS[this.sortColumn];
    lines.sort((a, b) => sortBy.value(b.s) - sortBy.value(a.s) || a.player.number - b.player.number);
    this.headers.forEach((th, i) => th.classList.toggle("sorted", i === this.sortColumn));

    const totals = TEAM_TOTALS.map((t) => ({ label: t.label, total: lines.reduce((sum, l) => sum + t.value(l.s), 0) }));
    this.summary.replaceChildren(
      ...totals.map((t) => {
        const item = document.createElement("div");
        const value = document.createElement("span");
        value.className = "total";
        value.textContent = String(t.total);
        item.append(value, t.label);
        return item;
      }),
    );

    const leaders = COLUMNS.map((c) => Math.max(0, ...lines.map((l) => c.value(l.s))));
    this.rowsById.clear();
    this.body.replaceChildren(
      ...lines.map(({ player, s }) => {
        const row = document.createElement("tr");
        row.append(cell("td", String(player.number), "num"), cell("td", player.role, "pos"), cell("td", player.name, "name"));
        COLUMNS.forEach((c, i) => {
          const v = c.value(s);
          row.append(cell("td", c.display ? c.display(s) : String(v), v > 0 && v === leaders[i] ? "leader" : undefined));
        });
        if (player.id === this.carrierId) row.classList.add("carrier");
        this.rowsById.set(player.id, row);
        return row;
      }),
    );
  }
}
