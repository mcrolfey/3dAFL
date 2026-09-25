export interface CallOptions {
  /** 0..1 */
  volume: number;
  pitch?: number;
  rate?: number;
  /** umpire calls cut off whatever's being said; player calls wait their turn */
  priority?: boolean;
}

/** Pick an Australian voice if the system has one, then British, then any English voice; local voices first for low latency. */
function pickVoice(voices: SpeechSynthesisVoice[]): SpeechSynthesisVoice | null {
  const rank = (v: SpeechSynthesisVoice) => {
    const lang = v.lang.toLowerCase();
    const region = lang.startsWith("en-au") ? 0 : lang.startsWith("en-gb") ? 1 : lang.startsWith("en") ? 2 : 9;
    return region * 2 + (v.localService ? 0 : 1);
  };
  const english = voices.filter((v) => v.lang.toLowerCase().startsWith("en"));
  return english.sort((a, b) => rank(a) - rank(b))[0] ?? null;
}

/** Short on-field calls ("Here!", "Man on!", "Play on!") spoken with the system's speech synthesiser. */
export class Voices {
  private voice: SpeechSynthesisVoice | null = null;
  private lastCallAt = 0;
  private readonly supported = typeof window !== "undefined" && "speechSynthesis" in window;
  enabled = false;

  constructor() {
    if (!this.supported) return;
    const load = () => (this.voice = pickVoice(speechSynthesis.getVoices()));
    load();
    speechSynthesis.addEventListener("voiceschanged", load);
  }

  call(text: string, opts: CallOptions) {
    if (!this.supported || !this.enabled) return;
    const now = performance.now();
    if (opts.priority) speechSynthesis.cancel();
    else if (speechSynthesis.speaking || now - this.lastCallAt < 1200) return;

    const u = new SpeechSynthesisUtterance(text);
    if (this.voice) u.voice = this.voice;
    u.volume = Math.max(0, Math.min(1, opts.volume));
    u.pitch = opts.pitch ?? 1;
    u.rate = opts.rate ?? 1.25;
    speechSynthesis.speak(u);
    this.lastCallAt = now;
  }

  silence() {
    if (this.supported) speechSynthesis.cancel();
  }
}
