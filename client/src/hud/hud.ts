import type { LadderEntry, MatchClock, ScoreLine, Team, TeamSummary } from "@3dafl/shared";

function scoreText(score: ScoreLine): string {
  return `${score.goals}.${score.behinds}.${score.goals * 6 + score.behinds}`;
}

function clockText(clock: MatchClock): string {
  const m = Math.floor(clock.secondsRemaining / 60);
  const s = clock.secondsRemaining % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
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
  private fulltimeBanner = document.getElementById("fulltime-banner")!;
  private fulltimeText = document.getElementById("fulltime-text")!;
  private nextMatchBtn = document.getElementById("next-match-btn") as HTMLButtonElement;

  setTeams(home: TeamSummary, away: TeamSummary) {
    this.homeName.textContent = home.name;
    this.awayName.textContent = away.name;
  }

  updateScore(home: ScoreLine, away: ScoreLine) {
    this.homeScore.textContent = scoreText(home);
    this.awayScore.textContent = scoreText(away);
  }

  updateClock(clock: MatchClock) {
    this.quarterEl.textContent = `Q${clock.quarter}`;
    this.timeEl.textContent = clockText(clock);
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
    this.feed.innerHTML = "";
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

  setLadder(ladder: LadderEntry[], teams: Team[]) {
    const rows = ladder
      .map((entry) => {
        const team = teams.find((t) => t.id === entry.teamId);
        return `<tr><td>${team?.name ?? "?"}</td><td>${entry.wins}-${entry.losses}-${entry.draws}</td><td>${entry.pointsFor}</td></tr>`;
      })
      .join("");
    this.ladderTable.innerHTML = rows;
  }
}
