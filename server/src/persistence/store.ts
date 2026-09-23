import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Season, Team } from "@3dafl/shared";
import { seedSeason, seedTeams } from "./seed.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const dataDir = path.resolve(here, "../../data");
const teamsPath = path.join(dataDir, "teams.json");
const seasonPath = path.join(dataDir, "season.json");

function ensureDataDir() {
  if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
}

function readJson<T>(filePath: string): T | null {
  if (!fs.existsSync(filePath)) return null;
  return JSON.parse(fs.readFileSync(filePath, "utf-8")) as T;
}

function writeJson(filePath: string, data: unknown) {
  ensureDataDir();
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), "utf-8");
}

export function loadTeams(): Team[] {
  const existing = readJson<Team[]>(teamsPath);
  if (existing) return existing;
  const teams = seedTeams();
  writeJson(teamsPath, teams);
  return teams;
}

export function saveTeams(teams: Team[]) {
  writeJson(teamsPath, teams);
}

export function loadSeason(teams: Team[]): Season {
  const existing = readJson<Season>(seasonPath);
  if (existing) return existing;
  const season = seedSeason(teams, new Date().getFullYear());
  writeJson(seasonPath, season);
  return season;
}

export function saveSeason(season: Season) {
  writeJson(seasonPath, season);
}

export function resetAll() {
  const teams = seedTeams();
  writeJson(teamsPath, teams);
  const season = seedSeason(teams, new Date().getFullYear());
  writeJson(seasonPath, season);
  return { teams, season };
}
