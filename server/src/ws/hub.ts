import { WebSocketServer, WebSocket } from "ws";
import type { Server } from "node:http";

export type ServerMessage =
  | { type: "commentatedEvent"; matchId: string; payload: unknown }
  | { type: "matchStarted"; matchId: string; homeTeamId: string; awayTeamId: string }
  | { type: "matchEnded"; matchId: string; result: unknown };

export class Hub {
  private wss: WebSocketServer;

  constructor(server: Server) {
    this.wss = new WebSocketServer({ server, path: "/ws" });
  }

  broadcast(message: ServerMessage) {
    const data = JSON.stringify(message);
    for (const client of this.wss.clients) {
      if (client.readyState === WebSocket.OPEN) client.send(data);
    }
  }
}
