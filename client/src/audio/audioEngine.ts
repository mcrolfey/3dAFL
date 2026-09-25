export type ImpactKind = "kick" | "handball" | "bounce" | "tackle" | "mark";

export interface Placement {
  volume: number;
  pan: number;
}

const CENTRE: Placement = { volume: 1, pan: 0 };

function makePinkNoise(ctx: AudioContext, seconds: number): AudioBuffer {
  const buffer = ctx.createBuffer(1, Math.floor(ctx.sampleRate * seconds), ctx.sampleRate);
  const data = buffer.getChannelData(0);
  let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
  for (let i = 0; i < data.length; i++) {
    const white = Math.random() * 2 - 1;
    b0 = 0.99886 * b0 + white * 0.0555179;
    b1 = 0.99332 * b1 + white * 0.0750759;
    b2 = 0.969 * b2 + white * 0.153852;
    b3 = 0.8665 * b3 + white * 0.3104856;
    b4 = 0.55 * b4 + white * 0.5329522;
    b5 = -0.7616 * b5 - white * 0.016898;
    data[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + white * 0.5362) * 0.11;
    b6 = white * 0.115926;
  }
  return buffer;
}

/** Thousands of tiny decaying noise grains at random times — reads as a crowd clapping. */
function makeApplause(ctx: AudioContext, seconds: number): AudioBuffer {
  const buffer = ctx.createBuffer(2, Math.floor(ctx.sampleRate * seconds), ctx.sampleRate);
  for (let ch = 0; ch < 2; ch++) {
    const data = buffer.getChannelData(ch);
    const claps = seconds * 900;
    for (let c = 0; c < claps; c++) {
      const start = Math.floor(Math.random() * (data.length - 2000));
      const len = 300 + Math.floor(Math.random() * 900);
      const amp = 0.15 + Math.random() * 0.35;
      for (let i = 0; i < len; i++) data[start + i] += (Math.random() * 2 - 1) * amp * Math.exp(-i / (len / 5));
    }
  }
  return buffer;
}

/**
 * All match audio is synthesised live with the Web Audio API — no sound files. A looping crowd bed with a
 * "babble" layer and a roar layer that swell with excitement, plus one-shot whistles, siren, ball impacts and crowd
 * reactions.
 */
export class AudioEngine {
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private bed!: GainNode;
  private roar!: GainNode;
  private babble: GainNode[] = [];
  private noise!: AudioBuffer;
  private applauseBuffer!: AudioBuffer;
  private excitement = 0.2;
  private enabled = true;

  get running(): boolean {
    return this.ctx?.state === "running";
  }

  /** Browsers only allow audio after a user gesture, so this must be called from a click handler. */
  async unlock() {
    if (!this.ctx) this.build();
    if (this.ctx!.state !== "running") await this.ctx!.resume();
  }

  setEnabled(on: boolean) {
    this.enabled = on;
    if (this.ctx) this.master.gain.setTargetAtTime(on ? 0.9 : 0, this.ctx.currentTime, 0.15);
  }

  /** 0 = quiet, 1 = on the edge of their seats. */
  setExcitement(level: number) {
    this.excitement = Math.max(0, Math.min(1, level));
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.bed.gain.setTargetAtTime(0.18 + 0.2 * this.excitement, t, 0.4);
    this.roar.gain.setTargetAtTime(0.02 + 0.3 * this.excitement ** 2, t, 0.4);
  }

  private build() {
    const ctx = new AudioContext();
    this.ctx = ctx;
    this.noise = makePinkNoise(ctx, 6);
    this.applauseBuffer = makeApplause(ctx, 4);

    const compressor = ctx.createDynamicsCompressor();
    compressor.threshold.value = -14;
    compressor.ratio.value = 4;
    this.master = ctx.createGain();
    this.master.gain.value = this.enabled ? 0.9 : 0;
    this.master.connect(compressor).connect(ctx.destination);

    // Crowd bed: a wash of distant noise.
    this.bed = ctx.createGain();
    this.bed.gain.value = 0.18;
    this.loop(0).connect(this.filter("bandpass", 450, 0.6)).connect(this.filter("lowpass", 2200, 0.7)).connect(this.bed).connect(this.master);

    // Babble: speech-band voices whose levels flicker at syllable rate, so the bed sounds like people, not wind.
    const babbleBus = ctx.createGain();
    babbleBus.gain.value = 0.9;
    babbleBus.connect(this.bed);
    for (let i = 0; i < 7; i++) {
      const g = ctx.createGain();
      g.gain.value = 0;
      this.loop(i * 0.7).connect(this.filter("bandpass", 350 + Math.random() * 2200, 4)).connect(g).connect(babbleBus);
      this.babble.push(g);
    }
    window.setInterval(() => {
      const t = ctx.currentTime;
      for (const g of this.babble) g.gain.setTargetAtTime(Math.random() ** 2 * (0.6 + this.excitement), t, 0.05);
    }, 110);

    // Roar: a brighter, louder crowd layer that rises with excitement and spikes on goals.
    this.roar = ctx.createGain();
    this.roar.gain.value = 0.02;
    this.loop(2.3).connect(this.filter("bandpass", 850, 0.9)).connect(this.filter("peaking", 1400, 1, 6)).connect(this.roar).connect(this.master);
  }

  private loop(offset: number): AudioBufferSourceNode {
    const src = this.ctx!.createBufferSource();
    src.buffer = this.noise;
    src.loop = true;
    src.start(0, offset % this.noise.duration);
    return src;
  }

  private filter(type: BiquadFilterType, frequency: number, q: number, gain = 0): BiquadFilterNode {
    const f = this.ctx!.createBiquadFilter();
    f.type = type;
    f.frequency.value = frequency;
    f.Q.value = q;
    f.gain.value = gain;
    return f;
  }

  private output(place: Placement): AudioNode {
    const ctx = this.ctx!;
    const gain = ctx.createGain();
    gain.gain.value = place.volume;
    const panner = ctx.createStereoPanner();
    panner.pan.value = Math.max(-1, Math.min(1, place.pan));
    gain.connect(panner).connect(this.master);
    return gain;
  }

  private noiseBurst(start: number, duration: number): AudioBufferSourceNode {
    const src = this.ctx!.createBufferSource();
    src.buffer = this.noise;
    src.start(start, Math.random() * (this.noise.duration - duration - 0.1), duration + 0.05);
    return src;
  }

  private envelope(peak: number, start: number, attack: number, decay: number): GainNode {
    const g = this.ctx!.createGain();
    g.gain.setValueAtTime(0.0001, start);
    g.gain.exponentialRampToValueAtTime(peak, start + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, start + attack + decay);
    return g;
  }

  private sweep(start: number, from: number, to: number, time: number, peak: number, decay: number, out: AudioNode) {
    const osc = this.ctx!.createOscillator();
    osc.frequency.setValueAtTime(from, start);
    osc.frequency.exponentialRampToValueAtTime(to, start + time);
    osc.connect(this.envelope(peak, start, 0.004, decay)).connect(out);
    osc.start(start);
    osc.stop(start + decay + 0.05);
  }

  /** Foot on ball, hand on ball, ball on turf, bodies colliding, ball into hands. */
  impact(kind: ImpactKind, place: Placement = CENTRE) {
    if (!this.running) return;
    const t = this.ctx!.currentTime;
    const out = this.output(place);
    switch (kind) {
      case "kick":
        this.sweep(t, 160, 52, 0.12, 0.9, 0.16, out);
        this.noiseBurst(t, 0.02).connect(this.filter("highpass", 1800, 0.7)).connect(this.envelope(0.35, t, 0.002, 0.02)).connect(out);
        break;
      case "handball":
        this.sweep(t, 260, 140, 0.05, 0.25, 0.07, out);
        this.noiseBurst(t, 0.05).connect(this.filter("bandpass", 750, 1.4)).connect(this.envelope(0.5, t, 0.003, 0.05)).connect(out);
        break;
      case "bounce":
        this.sweep(t, 120, 60, 0.09, 0.6, 0.12, out);
        break;
      case "tackle":
        this.sweep(t, 80, 40, 0.15, 0.5, 0.2, out);
        this.noiseBurst(t, 0.25).connect(this.filter("lowpass", 320, 0.7)).connect(this.envelope(0.9, t, 0.01, 0.25)).connect(out);
        break;
      case "mark":
        this.noiseBurst(t, 0.035).connect(this.filter("bandpass", 1700, 0.8)).connect(this.envelope(0.6, t, 0.002, 0.035)).connect(out);
        break;
    }
  }

  /** Pea whistle: a ~3kHz tone trilled by the pea rattling inside. Each entry is one blast's length. */
  whistle(blasts: number[] = [0.35]) {
    if (!this.running) return;
    const ctx = this.ctx!;
    let t = ctx.currentTime;
    for (const length of blasts) {
      const osc = ctx.createOscillator();
      osc.frequency.value = 2900 + Math.random() * 150;
      const trill = ctx.createOscillator();
      trill.type = "square";
      trill.frequency.value = 28 + Math.random() * 8;
      const depth = ctx.createGain();
      depth.gain.value = 160;
      trill.connect(depth).connect(osc.frequency);
      const env = ctx.createGain();
      env.gain.setValueAtTime(0.0001, t);
      env.gain.exponentialRampToValueAtTime(0.22, t + 0.02);
      env.gain.setValueAtTime(0.22, t + length - 0.04);
      env.gain.exponentialRampToValueAtTime(0.0001, t + length);
      osc.connect(env).connect(this.master);
      this.noiseBurst(t, length).connect(this.filter("highpass", 4000, 0.7)).connect(this.envelope(0.03, t, 0.02, length)).connect(this.master);
      osc.start(t);
      trill.start(t);
      osc.stop(t + length + 0.05);
      trill.stop(t + length + 0.05);
      t += length + 0.12;
    }
  }

  /** The ground siren that ends each quarter: a detuned horn that slides up to pitch. */
  siren(seconds = 3) {
    if (!this.running) return;
    const ctx = this.ctx!;
    const t = ctx.currentTime;
    const lowpass = this.filter("lowpass", 1800, 0.7);
    const env = ctx.createGain();
    env.gain.setValueAtTime(0.0001, t);
    env.gain.exponentialRampToValueAtTime(0.28, t + 0.3);
    env.gain.setValueAtTime(0.28, t + seconds - 0.6);
    env.gain.exponentialRampToValueAtTime(0.0001, t + seconds);
    lowpass.connect(env).connect(this.master);
    for (const detune of [0, 5]) {
      const osc = ctx.createOscillator();
      osc.type = "sawtooth";
      osc.frequency.setValueAtTime(330 + detune, t);
      osc.frequency.exponentialRampToValueAtTime(465 + detune, t + 0.6);
      osc.connect(lowpass);
      osc.start(t);
      osc.stop(t + seconds + 0.05);
    }
  }

  /** The crowd erupting — goals get the full thing. */
  cheer(intensity: number, seconds: number) {
    if (!this.running) return;
    const t = this.ctx!.currentTime;
    const base = 0.02 + 0.3 * this.excitement ** 2;
    this.roar.gain.cancelScheduledValues(t);
    this.roar.gain.setTargetAtTime(base + 1.1 * intensity, t, 0.12);
    this.roar.gain.setTargetAtTime(base, t + seconds * 0.45, seconds * 0.3);
    this.applause(intensity * 0.8, seconds);
  }

  applause(level: number, seconds: number) {
    if (!this.running || level <= 0) return;
    const ctx = this.ctx!;
    const t = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = this.applauseBuffer;
    src.loop = true;
    const env = ctx.createGain();
    env.gain.setValueAtTime(0.0001, t);
    env.gain.exponentialRampToValueAtTime(0.5 * level, t + 0.3);
    env.gain.setTargetAtTime(0.0001, t + seconds * 0.5, seconds * 0.25);
    src.connect(this.filter("highpass", 700, 0.7)).connect(env).connect(this.master);
    src.start(t);
    src.stop(t + seconds + 1);
  }

  /** A crowd shouting a vowel: noise shaped by two formant filters that glide between vowel positions. */
  private crowdVowel(f1: [number, number], f2: [number, number], level: number, attack: number, hold: number, release: number) {
    if (!this.running) return;
    const ctx = this.ctx!;
    const t = ctx.currentTime;
    const total = attack + hold + release;
    const env = ctx.createGain();
    env.gain.setValueAtTime(0.0001, t);
    env.gain.exponentialRampToValueAtTime(level, t + attack);
    env.gain.setValueAtTime(level, t + attack + hold);
    env.gain.exponentialRampToValueAtTime(0.0001, t + total);
    env.connect(this.master);
    for (const [from, to] of [f1, f2]) {
      const f = this.filter("bandpass", from, 5);
      f.frequency.setValueAtTime(from, t);
      f.frequency.linearRampToValueAtTime(to, t + total);
      this.noiseBurst(t, total).connect(f).connect(env);
    }
  }

  /** "Ohhh" — a behind, a dropped mark, a near miss. */
  groan(level = 0.6) {
    this.crowdVowel([520, 380], [920, 640], level, 0.25, 0.4, 1.0);
  }

  /** The crowd yelling "BALL!" when a player's caught holding it. */
  ballChant() {
    this.crowdVowel([650, 760], [1000, 1150], 0.8, 0.08, 0.45, 0.35);
  }
}
