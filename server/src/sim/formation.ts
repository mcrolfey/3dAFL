import type { FieldPos, PlayerFieldState, Team } from "@3dafl/shared";
import { clampField, randomJitter } from "./field.js";

function baseZoneX(position: string, attackingDirection: 1 | -1): number {
  switch (position) {
    case "DEF":
      return attackingDirection > 0 ? -55 : 55;
    case "FWD":
      return attackingDirection > 0 ? 55 : -55;
    case "RUCK":
      return 0;
    case "MID":
    default:
      return attackingDirection > 0 ? -5 : 5;
  }
}

function pullFactorFor(position: string): number {
  switch (position) {
    case "MID":
      return 0.55;
    case "RUCK":
      return 0.45;
    default:
      return 0.2;
  }
}

export function computeFormation(
  home: Team,
  away: Team,
  ballPos: FieldPos,
  homeAttackDir: 1 | -1,
  ballCarrierId: string | null = null,
): PlayerFieldState[] {
  const result: PlayerFieldState[] = [];
  const teams: [Team, 1 | -1][] = [
    [home, homeAttackDir],
    [away, (homeAttackDir * -1) as 1 | -1],
  ];

  for (const [team, attackDir] of teams) {
    let laneIndex = 0;
    for (const player of team.players) {
      if (player.id === ballCarrierId) {
        // The player actually holding the ball is always rendered right at it, not just pulled toward it.
        result.push({ playerId: player.id, pos: clampField({ x: ballPos.x - attackDir * 1.2, y: ballPos.y }) });
        continue;
      }

      const baseX = baseZoneX(player.position, attackDir);
      const lane = (laneIndex % 6) - 2.5;
      laneIndex++;
      const baseY = lane * 20;
      const pull = pullFactorFor(player.position);

      const x = baseX * (1 - pull) + ballPos.x * pull + randomJitter(4);
      const y = baseY * (1 - pull) + ballPos.y * pull + randomJitter(4);

      result.push({ playerId: player.id, pos: clampField({ x, y }) });
    }
  }

  return result;
}
