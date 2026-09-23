import { config as loadEnv } from "dotenv";
import { fileURLToPath } from "node:url";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));
loadEnv({ path: path.resolve(here, "../../.env") });

export const config = {
  port: Number(process.env.PORT ?? 8787),
  typesafeApiKey: process.env.TYPESAFE_API_KEY ?? "",
  typesafeModel: process.env.TYPESAFE_MODEL ?? "jev-latest",
  /** How many sim-clock seconds of game time pass per real second while a match is being watched live. Lower = slower/more realistic pacing. */
  simSpeed: Number(process.env.SIM_SPEED ?? 4),
};

export const jevEnabled = config.typesafeApiKey.length > 0;
