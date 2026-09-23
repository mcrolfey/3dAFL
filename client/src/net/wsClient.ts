import type { CommentatedEvent } from "@3dafl/shared";

export type IncomingMessage =
  | { type: "commentatedEvent"; matchId: string; payload: CommentatedEvent }
  | { type: "matchStarted"; matchId: string; homeTeamId: string; awayTeamId: string }
  | { type: "matchEnded"; matchId: string; result: unknown };

export class LiveMatchSocket {
  private ws: WebSocket | null = null;
  private handlers = new Set<(msg: IncomingMessage) => void>();

  connect() {
    const protocol = location.protocol === "https:" ? "wss" : "ws";
    this.ws = new WebSocket(`${protocol}://${location.host}/ws`);
    this.ws.onmessage = (ev) => {
      try {
        const msg = JSON.parse(ev.data) as IncomingMessage;
        for (const handler of this.handlers) handler(msg);
      } catch {
        // ignore malformed frames
      }
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
