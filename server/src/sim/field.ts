import type { FieldPos } from "@3dafl/shared";

export const FIELD_HALF_LENGTH = 90;
export const FIELD_HALF_WIDTH = 65;
export const FORWARD_50_LINE = 40; // distance from center where forward-50 arc effectively begins

export function clampField(pos: FieldPos): FieldPos {
  return {
    x: Math.max(-FIELD_HALF_LENGTH, Math.min(FIELD_HALF_LENGTH, pos.x)),
    y: Math.max(-FIELD_HALF_WIDTH, Math.min(FIELD_HALF_WIDTH, pos.y)),
  };
}

export function isInForward50(pos: FieldPos, attackingDirection: 1 | -1): boolean {
  return attackingDirection > 0 ? pos.x > FORWARD_50_LINE : pos.x < -FORWARD_50_LINE;
}

export function isOutOfField(pos: FieldPos): boolean {
  return Math.abs(pos.x) > FIELD_HALF_LENGTH || Math.abs(pos.y) > FIELD_HALF_WIDTH;
}

export function goalSquare(attackingDirection: 1 | -1): FieldPos {
  return { x: attackingDirection > 0 ? FIELD_HALF_LENGTH - 5 : -(FIELD_HALF_LENGTH - 5), y: 0 };
}

export function randomJitter(range: number): number {
  return (Math.random() - 0.5) * 2 * range;
}
