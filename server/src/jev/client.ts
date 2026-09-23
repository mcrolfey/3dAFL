import { config } from "../config.js";

export type JevQuestion =
  | { type: "noul"; instructions: string; criteria?: { true: string; false: string } }
  | { type: "choice"; instructions: string; criteria: Record<string, string> }
  | { type: "score"; instructions: string; criteria: string[] };

export type JevAnswer =
  | { type: "noul"; noul: number }
  | { type: "choice"; choice: string; probabilities: Record<string, number>; confidence: number }
  | { type: "score"; score: number; legend: Record<string, string>; probabilities: Record<string, number>; confidence: number };

interface SystemOneRequest {
  state: unknown;
  model: string;
  questions: Record<string, JevQuestion>;
}

interface SystemOneResponse {
  model: string;
  answers: Record<string, JevAnswer>;
  usage: { input_tokens: number; output_tokens: number };
}

const ENDPOINT = "https://api.typesafe.ai/v1/systemone";
const MAX_RETRIES = 3;

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export class JevError extends Error {
  constructor(message: string, public status?: number) {
    super(message);
    this.name = "JevError";
  }
}

export async function callJev(
  state: unknown,
  questions: Record<string, JevQuestion>,
): Promise<Record<string, JevAnswer>> {
  const body: SystemOneRequest = { state, model: config.typesafeModel, questions };

  let lastError: unknown;
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      const res = await fetch(ENDPOINT, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${config.typesafeApiKey}`,
        },
        body: JSON.stringify(body),
      });

      if (res.status === 429 || res.status === 529) {
        const backoff = 300 * 2 ** attempt;
        await sleep(backoff);
        continue;
      }

      if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new JevError(`Jev API error ${res.status}: ${text}`, res.status);
      }

      const json = (await res.json()) as SystemOneResponse;
      return json.answers;
    } catch (err) {
      lastError = err;
      // Auth/validation errors are not transient — retrying with the same key/body can't help.
      if (err instanceof JevError && err.status !== undefined && err.status !== 429 && err.status !== 529) break;
      if (attempt === MAX_RETRIES - 1) break;
      await sleep(200 * 2 ** attempt);
    }
  }

  throw lastError instanceof Error ? lastError : new JevError("Jev call failed after retries");
}
