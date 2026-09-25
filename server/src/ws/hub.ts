import { WebSocketServer, WebSocket } from "ws";
import type { Server } from "node:http";

export type ServerMessage =
  | { type: "commentatedEvent"; matchId: string; payload: unknown }
  | { type: "frame"; matchId: string; frame: unknown }
  | { type: "stats"; matchId: string; players: Record<string, unknown> }
  | { type: "matchStarted"; matchId: string; homeTeamId: string; awayTeamId: string }
  | { type: "matchEnded"; matchId: string; result: unknown }
  | { type: "speed"; simSpeed: number; normalSpeed: number; frameInterval: number };

export class Hub {
  private wss: WebSocketServer;
  /** Sent to anyone who connects mid-match (e.g. a page reload) so they can build the scene and keep watching. */
  private welcome: ServerMessage | null = null;
  /** The current match pace, sent after the welcome so late joiners play frames back at the right rate. */
  private speed: ServerMessage | null = null;

  constructor(server: Server) {
    this.wss = new WebSocketServer({ server, path: "/ws" });
    this.wss.on("connection", (client) => {
      if (this.welcome) client.send(JSON.stringify(this.welcome));
      if (this.speed) client.send(JSON.stringify(this.speed));
    });
  }

  setWelcome(message: ServerMessage | null) {
    this.welcome = message;
  }

  setSpeed(simSpeed: number, normalSpeed: number, frameInterval: number) {
    this.speed = { type: "speed", simSpeed, normalSpeed, frameInterval };
    this.broadcast(this.speed);
  }

  broadcast(message: ServerMessage) {
    const data = JSON.stringify(message);
    for (const client of this.wss.clients) {
      if (client.readyState === WebSocket.OPEN) client.send(data);
    }
  }
}
