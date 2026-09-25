export type Speaker = "caller" | "expert";

export interface CallOptions {
  /** 0..1 */
  volume: number;
  pitch?: number;
  rate?: number;
}

interface PendingLine {
  text: string;
  priority: number;
  speaker: Speaker;
  at: number;
}

/** Oldest a queued commentary line can be before it's no longer worth saying. */
const STALE_MS = 3000;
/** Routine lines only get said if the booth has been quiet this long, so there's room to breathe. */
const ROUTINE_GAP_MS = 1200;

function rank(v: SpeechSynthesisVoice): number {
  const lang = v.lang.toLowerCase();
  const region = lang.startsWith("en-au") ? 0 : lang.startsWith("en-gb") ? 1 : lang.startsWith("en") ? 2 : 9;
  return region * 2 + (v.localService ? 0 : 1);
}

/** Caller gets the best (ideally Australian, local) voice; the expert a different one so they sound like two people. */
function pickVoices(voices: SpeechSynthesisVoice[]): { caller: SpeechSynthesisVoice | null; expert: SpeechSynthesisVoice | null } {
  const english = voices.filter((v) => v.lang.toLowerCase().startsWith("en")).sort((a, b) => rank(a) - rank(b));
  const caller = english[0] ?? null;
  const expert = english.find((v) => v !== caller && v.lang === caller?.lang) ?? english.find((v) => v !== caller) ?? caller;
  return { caller, expert };
}

/**
 * Everything spoken, sharing the one speech channel browsers give us: the commentary team (a play-by-play caller
 * and an expert) and short on-field calls from players and the umpire. Big moments cut in, routine chatter waits
 * its turn, and anything that's gone stale is dropped rather than read out late.
 */
export class Voices {
  private caller: SpeechSynthesisVoice | null = null;
  private expert: SpeechSynthesisVoice | null = null;
  private readonly supported = typeof window !== "undefined" && "speechSynthesis" in window;
  private currentPriority = 0;
  private utteranceId = 0;
  private pending: PendingLine | null = null;
  private quietSince = 0;
  enabled = false;
  commentaryOn = true;

  constructor() {
    if (!this.supported) return;
    const load = () => Object.assign(this, pickVoices(speechSynthesis.getVoices()));
    load();
    speechSynthesis.addEventListener("voiceschanged", load);
  }

  private get busy(): boolean {
    return this.supported && (speechSynthesis.speaking || speechSynthesis.pending);
  }

  private utter(text: string, voice: SpeechSynthesisVoice | null, opts: CallOptions, priority: number) {
    const id = ++this.utteranceId;
    const u = new SpeechSynthesisUtterance(text);
    if (voice) u.voice = voice;
    u.volume = Math.max(0, Math.min(1, opts.volume));
    u.pitch = opts.pitch ?? 1;
    u.rate = opts.rate ?? 1.2;
    const finished = () => {
      // Ignore the end of an utterance that was cut off by a newer one.
      if (id !== this.utteranceId) return;
      this.currentPriority = 0;
      this.quietSince = performance.now();
      const next = this.pending;
      this.pending = null;
      if (next && performance.now() - next.at < STALE_MS) this.speakLine(next);
    };
    u.onend = finished;
    u.onerror = finished;
    this.currentPriority = priority;
    speechSynthesis.speak(u);
  }

  private speakLine(line: PendingLine) {
    const bigMoment = line.priority >= 3;
    const opts =
      line.speaker === "expert"
        ? { volume: 0.95, pitch: 0.95, rate: 1.05 }
        : { volume: 1, pitch: bigMoment ? 1.12 : 1, rate: bigMoment ? 1.25 : 1.15 };
    this.utter(line.text, line.speaker === "expert" ? this.expert : this.caller, opts, line.priority);
  }

  /** A commentary line. priority: 1 routine, 2 notable, 3 big moment (0 is feed-only and never spoken). */
  commentate(text: string, priority: number, speaker: Speaker) {
    if (!this.supported || !this.enabled || !this.commentaryOn || !text || priority <= 0) return;
    const line = { text, priority, speaker, at: performance.now() };

    if (!this.busy) {
      if (priority >= 2 || performance.now() - this.quietSince > ROUTINE_GAP_MS) this.speakLine(line);
      return;
    }
    if (priority >= 3 && this.currentPriority < 3) {
      speechSynthesis.cancel();
      this.pending = null;
      this.speakLine(line);
      return;
    }
    if (!this.pending || priority >= this.pending.priority) this.pending = line;
  }

  /** A quick on-field call ("Man on!", "Play on!") — only when the commentary team isn't talking. */
  call(text: string, opts: CallOptions) {
    if (!this.supported || !this.enabled || this.busy || this.pending) return;
    this.utter(text, this.caller, opts, 0);
  }

  silence() {
    this.pending = null;
    if (this.supported) speechSynthesis.cancel();
  }
}
