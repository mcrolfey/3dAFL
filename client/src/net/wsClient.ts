import type { CommentatedEvent, MatchFrame, MatchResult, PlayerStatLine } from "@3dafl/shared";

export type IncomingMessage =
  | { type: "commentatedEvent"; matchId: string; payload: CommentatedEvent }
  | { type: "frame"; matchId: string; frame: MatchFrame }
  | { type: "stats"; matchId: string; players: Record<string, PlayerStatLine> }
  | { type: "matchStarted"; matchId: string; homeTeamId: string; awayTeamId: string }
  | { type: "matchEnded"; matchId: string; result: MatchResult }
  | { type: "speed"; simSpeed: number; normalSpeed: number; frameInterval: number };

export class LiveMatchSocket {
  private ws: WebSocket | null = null;
  private handlers = new Set<(msg: IncomingMessage) => void>();

  connect() {
    const protocol = location.protocol === "https:" ? "wss" : "ws";
    this.ws = new WebSocket(`${protocol}://${location.host}/ws`);
    this.ws.onmessage = (ev) => {
      let msg: IncomingMessage;
      try {
        msg = JSON.parse(ev.data) as IncomingMessage;
      } catch {
        return;
      }
      for (const handler of this.handlers) handler(msg);
    };
    this.ws.onclose = () => {
      setTimeout(() => this.connect(), 1500);
    };
  }

  onMessage(handler: (msg: IncomingMessage) => void) {
    this.handlers.add(handler);
    return () => this.handlers.delete(handler);
  }
}
