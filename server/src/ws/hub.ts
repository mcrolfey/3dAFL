import { WebSocketServer, WebSocket } from "ws";
import type { Server } from "node:http";

export type ServerMessage =
  | { type: "commentatedEvent"; matchId: string; payload: unknown }
  | { type: "frame"; matchId: string; frame: unknown }
  | { type: "matchStarted"; matchId: string; homeTeamId: string; awayTeamId: string }
  | { type: "matchEnded"; matchId: string; result: unknown };

export class Hub {
  private wss: WebSocketServer;
  /** Sent to anyone who connects mid-match (e.g. a page reload) so they can build the scene and keep watching. */
  private welcome: ServerMessage | null = null;

  constructor(server: Server) {
    this.wss = new WebSocketServer({ server, path: "/ws" });
    this.wss.on("connection", (client) => {
      if (this.welcome) client.send(JSON.stringify(this.welcome));
    });
  }

  setWelcome(message: ServerMessage | null) {
    this.welcome = message;
  }

  broadcast(message: ServerMessage) {
    const data = JSON.stringify(message);
    for (const client of this.wss.clients) {
      if (client.readyState === WebSocket.OPEN) client.send(data);
    }
  }
}
