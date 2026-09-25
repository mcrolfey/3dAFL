import type { LadderEntry, MatchClock, ScoreLine, Team } from "@3dafl/shared";

function scoreText(score: ScoreLine): string {
  return `${score.goals}.${score.behinds}.${score.goals * 6 + score.behinds}`;
}

function clockText(clock: MatchClock): string {
  const secs = Math.floor(clock.secondsRemaining);
  return `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, "0")}`;
}

export class Hud {
  private homeName = document.getElementById("home-name")!;
  private awayName = document.getElementById("away-name")!;
  private homeScore = document.getElementById("home-score")!;
  private awayScore = document.getElementById("away-score")!;
  private quarterEl = document.getElementById("quarter")!;
  private timeEl = document.getElementById("time")!;
  private feed = document.getElementById("commentary-feed")!;
  private startBtn = document.getElementById("start-btn") as HTMLButtonElement;
  private ladderTable = document.getElementById("ladder-table")!;
  private ladderTitle = document.getElementById("ladder-title")!;
  private fulltimeBanner = document.getElementById("fulltime-banner")!;
  private fulltimeText = document.getElementById("fulltime-text")!;
  private nextMatchBtn = document.getElementById("next-match-btn") as HTMLButtonElement;
  private soundBtn = document.getElementById("sound-btn") as HTMLButtonElement;
  private carrierTag = document.getElementById("carrier-tag")!;
  private carrierNumber = document.getElementById("carrier-number")!;
  private carrierName = document.getElementById("carrier-name")!;
  private carrierTeam = document.getElementById("carrier-team")!;
  private shownCarrier = "";

  setTeams(homeName: string, awayName: string) {
    this.homeName.textContent = homeName;
    this.awayName.textContent = awayName;
  }

  updateScore(home: ScoreLine, away: ScoreLine) {
    this.homeScore.textContent = scoreText(home);
    this.awayScore.textContent = scoreText(away);
  }

  updateClock(clock: MatchClock, running: boolean) {
    this.quarterEl.textContent = `Q${clock.quarter}`;
    this.timeEl.textContent = clockText(clock);
    this.timeEl.classList.toggle("stopped", !running);
  }

  /** TV-style lower third naming whoever has the ball. */
  setCarrier(carrier: { number: number; name: string; team: string; color: string } | null) {
    const key = carrier ? `${carrier.team}#${carrier.number}` : "";
    if (key === this.shownCarrier) return;
    this.shownCarrier = key;
    this.carrierTag.classList.toggle("hidden", !carrier);
    if (!carrier) return;
    this.carrierNumber.textContent = String(carrier.number);
    this.carrierNumber.style.background = carrier.color;
    this.carrierName.textContent = carrier.name;
    this.carrierTeam.textContent = carrier.team;
  }

  pushCommentary(text: string) {
    if (!text) return;
    const line = document.createElement("div");
    line.className = "line";
    line.textContent = text;
    this.feed.prepend(line);
    while (this.feed.childElementCount > 8) {
      this.feed.removeChild(this.feed.lastChild!);
    }
  }

  clearCommentary() {
    this.feed.replaceChildren();
  }

  setStartEnabled(enabled: boolean, label?: string) {
    this.startBtn.disabled = !enabled;
    if (label) this.startBtn.textContent = label;
  }

  onStartClick(handler: () => void) {
    this.startBtn.addEventListener("click", handler);
  }

  onNextMatchClick(handler: () => void) {
    this.nextMatchBtn.addEventListener("click", handler);
  }

  onSoundClick(handler: () => void) {
    this.soundBtn.addEventListener("click", handler);
  }

  setSoundState(state: "locked" | "on" | "off") {
    this.soundBtn.textContent = state === "locked" ? "Enable sound" : state === "on" ? "Sound: On" : "Sound: Off";
    this.soundBtn.classList.toggle("off", state !== "on");
  }

  showFullTime(homeName: string, awayName: string, home: ScoreLine, away: ScoreLine) {
    const homePts = home.goals * 6 + home.behinds;
    const awayPts = away.goals * 6 + away.behinds;
    const winner = homePts === awayPts ? "Draw!" : homePts > awayPts ? `${homeName} win!` : `${awayName} win!`;
    this.fulltimeText.textContent = `${homeName} ${scoreText(home)} — ${awayName} ${scoreText(away)}  ·  ${winner}`;
    this.fulltimeBanner.classList.remove("hidden");
  }

  hideFullTime() {
    this.fulltimeBanner.classList.add("hidden");
  }

  setLadder(ladder: LadderEntry[], teams: Team[], year: number) {
    this.ladderTitle.textContent = `${year} Ladder`;
    const rows = ladder.map((entry) => {
      const team = teams.find((t) => t.id === entry.teamId);
      const tr = document.createElement("tr");
      for (const text of [team?.name ?? "?", `${entry.wins}-${entry.losses}-${entry.draws}`, String(entry.pointsFor)]) {
        const td = document.createElement("td");
        td.textContent = text;
        tr.appendChild(td);
      }
      return tr;
    });
    this.ladderTable.replaceChildren(...rows);
  }
}
