/**
 * GameAudio — motor de audio PROCEDURAL de V1-H (WebAudio, CERO assets: nada que
 * descargar ni licenciar). Sintetiza todo: silbidos (seno+vibrato), capturas
 * (chime), disparo (ruido+thump), ambiente (viento filtrado + pajaritos).
 *
 * Reglas del repo aplicadas:
 *  - `r3f-rendering`: presentación PURA, fuera del ciclo React; nada de esto es
 *    estado de juego. Singleton de módulo (client-only: solo lo importan hooks
 *    que se montan dentro de <ClientOnly>).
 *  - `workers-memory-optimization` (espíritu): los eventos son CAMINO FRÍO
 *    (un silbido cada ~14 s por Hider, un chime por captura); el ambiente es un
 *    bucle con nodos estables — sin asignaciones por frame.
 *  - NUNCA rompe el juego: sin AudioContext disponible (SSR, bloqueado, sin
 *    gesto del usuario) todos los métodos son no-ops seguros; todo lo que toca
 *    el grafo de audio va con guarda.
 *
 * Autoplay: el navegador exige un gesto; `unlock()` se llama en el primer
 * pointerdown/keydown (el click de pointer lock del juego) y la preferencia de
 * mute se recuerda en localStorage.
 */
import type { Spatial } from './spatial';

const MUTE_KEY = 'mecha.muted';

export class GameAudio {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private noiseBuffer: AudioBuffer | null = null;
  private ambient: { gain: GainNode; sources: AudioScheduledSourceNode[]; chirpTimer: ReturnType<typeof setTimeout> | null } | null = null;
  private muted = false;

  constructor() {
    try {
      this.muted = window.localStorage.getItem(MUTE_KEY) === '1';
    } catch {
      this.muted = false; /* storage bloqueado: sin memoria, sin drama */
    }
  }

  /** Crea/reanuda el AudioContext (llamar en el primer gesto del usuario). */
  unlock(): void {
    const ctx = this.ensureCtx();
    if (ctx && ctx.state === 'suspended') void ctx.resume();
  }

  isMuted(): boolean {
    return this.muted;
  }

  setMuted(muted: boolean): void {
    this.muted = muted;
    if (this.master) this.master.gain.value = muted ? 0 : 1;
    try {
      window.localStorage.setItem(MUTE_KEY, muted ? '1' : '0');
    } catch {
      /* modo privado */
    }
  }

  /** Ambiente de fondo: viento suave + pajaritos esporádicos (solo en ronda). */
  startAmbience(): void {
    const ctx = this.ensureCtx();
    if (!ctx || this.ambient) return;

    const gain = ctx.createGain();
    gain.gain.value = 0.035;
    gain.connect(this.master!);

    // Viento: ruido blanco → bandpass con LFO lento (la frecuencia "respira").
    const wind = ctx.createBufferSource();
    wind.buffer = this.ensureNoise(ctx);
    wind.loop = true;
    const band = ctx.createBiquadFilter();
    band.type = 'bandpass';
    band.frequency.value = 480;
    band.Q.value = 0.6;
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 0.13;
    const lfoGain = ctx.createGain();
    lfoGain.gain.value = 220;
    lfo.connect(lfoGain).connect(band.frequency);
    wind.connect(band).connect(gain);
    wind.start();
    lfo.start();

    // Pajaritos: chirp aleatorio cada 3–8 s (frío; pan aleatorio).
    const chirp = (): void => {
      this.playChirp();
      this.ambient!.chirpTimer = setTimeout(chirp, 3000 + Math.random() * 5000);
    };
    this.ambient = { gain, sources: [wind, lfo], chirpTimer: setTimeout(chirp, 2500) };
  }

  stopAmbience(): void {
    const amb = this.ambient;
    if (!amb) return;
    this.ambient = null;
    if (amb.chirpTimer) clearTimeout(amb.chirpTimer);
    // Fade-out corto para no "cortar" el aire de golpe.
    const ctx = this.ctx;
    if (ctx) {
      try {
        amb.gain.gain.setValueAtTime(amb.gain.gain.value, ctx.currentTime);
        amb.gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.4);
      } catch {
        /* nodo ya desconectado */
      }
    }
    for (const s of amb.sources) {
      try {
        s.stop(ctx ? ctx.currentTime + 0.5 : 0);
      } catch {
        /* ya parado */
      }
    }
  }

  /** Silbido de un Hider (evento del servidor): seno + vibrato, posicionado. */
  playWhistle(sp: Spatial): void {
    const ctx = this.playable();
    if (!ctx) return;
    const t0 = ctx.currentTime;

    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.value = 1720 + Math.random() * 160; // cada "voz" es distinta

    // Vibrato: 6 Hz de profundidad ~28 Hz (el trino del silbido humano).
    const vibrato = ctx.createOscillator();
    vibrato.frequency.value = 6;
    const vibratoGain = ctx.createGain();
    vibratoGain.gain.value = 28;
    vibrato.connect(vibratoGain).connect(osc.frequency);

    const env = ctx.createGain();
    env.gain.setValueAtTime(0.0001, t0);
    env.gain.exponentialRampToValueAtTime(0.22 * sp.gain + 0.0001, t0 + 0.06);
    env.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.75);

    const pan = ctx.createStereoPanner();
    pan.pan.value = Math.max(-1, Math.min(1, sp.pan));

    osc.connect(env).connect(pan).connect(this.master!);
    osc.start(t0);
    vibrato.start(t0);
    osc.stop(t0 + 0.8);
    vibrato.stop(t0 + 0.8);
  }

  /** Hit confirm: el servidor confirmó una captura del Seeker local. */
  playHit(): void {
    const ctx = this.playable();
    if (!ctx) return;
    this.blip(ctx, 880, 0, 0.09, 0.14, 'triangle');
    this.blip(ctx, 1318, 0.07, 0.1, 0.12, 'triangle'); // quinta arriba = "¡sí!"
  }

  /** El jugador local fue atrapado: "womp" descendente. */
  playCaught(): void {
    const ctx = this.playable();
    if (!ctx) return;
    const t0 = ctx.currentTime;
    const osc = ctx.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(440, t0);
    osc.frequency.exponentialRampToValueAtTime(110, t0 + 0.35);
    const env = ctx.createGain();
    env.gain.setValueAtTime(0.16, t0);
    env.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.4);
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 900;
    osc.connect(lp).connect(env).connect(this.master!);
    osc.start(t0);
    osc.stop(t0 + 0.45);
  }

  /** Disparo del Seeker local: ruido corto + thump grave (feedback inmediato). */
  playShot(): void {
    const ctx = this.playable();
    if (!ctx) return;
    const t0 = ctx.currentTime;
    // Ruido del "disparo"
    const noise = ctx.createBufferSource();
    noise.buffer = this.ensureNoise(ctx);
    const bp = ctx.createBiquadFilter();
    bp.type = 'lowpass';
    bp.frequency.value = 1400;
    const env = ctx.createGain();
    env.gain.setValueAtTime(0.18, t0);
    env.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.09);
    noise.connect(bp).connect(env).connect(this.master!);
    noise.start(t0);
    noise.stop(t0 + 0.1);
    // Thump
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(120, t0);
    osc.frequency.exponentialRampToValueAtTime(55, t0 + 0.12);
    const env2 = ctx.createGain();
    env2.gain.setValueAtTime(0.2, t0);
    env2.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.14);
    osc.connect(env2).connect(this.master!);
    osc.start(t0);
    osc.stop(t0 + 0.16);
  }

  /** Lobby → Prep: tono ascendente de "a esconderse". */
  playRoundStart(): void {
    const ctx = this.playable();
    if (!ctx) return;
    const t0 = ctx.currentTime;
    const osc = ctx.createOscillator();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(330, t0);
    osc.frequency.linearRampToValueAtTime(660, t0 + 0.22);
    const env = ctx.createGain();
    env.gain.setValueAtTime(0.14, t0);
    env.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.4);
    osc.connect(env).connect(this.master!);
    osc.start(t0);
    osc.stop(t0 + 0.45);
  }

  /** Fin de ronda: arpegio de victoria o dos notas graves de derrota. */
  playRoundEnd(win: boolean): void {
    const ctx = this.playable();
    if (!ctx) return;
    if (win) {
      // Do-Mi-Sol ascendente (C5-E5-G5).
      this.blip(ctx, 523, 0, 0.13, 0.13, 'triangle');
      this.blip(ctx, 659, 0.12, 0.13, 0.13, 'triangle');
      this.blip(ctx, 784, 0.24, 0.22, 0.13, 'triangle');
    } else {
      this.blip(ctx, 220, 0, 0.25, 0.12, 'sine');
      this.blip(ctx, 147, 0.22, 0.4, 0.12, 'sine');
    }
  }

  /** Entraste a la sala: blip amistoso. */
  playJoin(): void {
    const ctx = this.playable();
    if (!ctx) return;
    this.blip(ctx, 520, 0, 0.12, 0.1, 'sine');
    this.blip(ctx, 660, 0.09, 0.12, 0.1, 'sine');
  }

  // ── Internos ──

  private playChirp(): void {
    const ctx = this.playable();
    if (!ctx) return;
    const base = 2200 + Math.random() * 900;
    const pan = ctx.createStereoPanner();
    pan.pan.value = Math.random() * 2 - 1;
    const g = ctx.createGain();
    g.gain.value = 0.03;
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    const t0 = ctx.currentTime;
    osc.frequency.setValueAtTime(base, t0);
    osc.frequency.exponentialRampToValueAtTime(base * 0.72, t0 + 0.09);
    osc.frequency.setValueAtTime(base * 1.05, t0 + 0.12);
    osc.frequency.exponentialRampToValueAtTime(base * 0.7, t0 + 0.2);
    osc.connect(g).connect(pan).connect(this.master!);
    osc.start(t0);
    osc.stop(t0 + 0.25);
  }

  /** Nota corta con envolvente; helper de todos los chimes. */
  private blip(
    ctx: AudioContext,
    freq: number,
    delayS: number,
    durS: number,
    vol: number,
    type: OscillatorType,
  ): void {
    const t0 = ctx.currentTime + delayS;
    const osc = ctx.createOscillator();
    osc.type = type;
    osc.frequency.value = freq;
    const env = ctx.createGain();
    env.gain.setValueAtTime(0.0001, t0);
    env.gain.exponentialRampToValueAtTime(vol, t0 + 0.015);
    env.gain.exponentialRampToValueAtTime(0.0001, t0 + durS);
    osc.connect(env).connect(this.master!);
    osc.start(t0);
    osc.stop(t0 + durS + 0.02);
  }

  /** ¿Puedo reproducir? (ctx listo + no muteado). Nunca lanza. */
  private playable(): AudioContext | null {
    if (this.muted) return null;
    return this.ensureCtx();
  }

  private ensureCtx(): AudioContext | null {
    if (this.ctx) return this.ctx;
    try {
      const Ctor = window.AudioContext;
      if (!Ctor) return null;
      this.ctx = new Ctor();
      this.master = this.ctx.createGain();
      this.master.gain.value = this.muted ? 0 : 1;
      this.master.connect(this.ctx.destination);
      return this.ctx;
    } catch {
      return null; // sin audio disponible: el juego sigue MUDO pero vivo
    }
  }

  /** Buffer de ruido blanco (2 s) reutilizado por viento y disparos. */
  private ensureNoise(ctx: AudioContext): AudioBuffer {
    if (this.noiseBuffer) return this.noiseBuffer;
    const buf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = (Math.random() * 2 - 1) * 0.4;
    this.noiseBuffer = buf;
    return buf;
  }
}

/** Singleton client-only del motor de audio. */
export const audio = new GameAudio();
