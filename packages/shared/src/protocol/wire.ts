/**
 * Formato de red BINARIO del camino caliente.
 *
 * Skill `authoritative-netcode` (ref. `wire-format.md`) + `workers-memory-optimization`:
 *   - INPUT (cliente→servidor) y SNAPSHOT (servidor→cliente) van en binario compacto;
 *     el control raro (JOIN/START/CHANGE_COLOR/CHAT) va en JSON string (otra familia
 *     de frame). Así el camino caliente nunca toca JSON.
 *   - Cuantización: posiciones a punto fijo int16 (cm), apunte/movimiento a int16,
 *     color a uint32, flags en un bitfield.
 *   - Buffers de encode POOLEADOS (vista sobre un ArrayBuffer reutilizado, no uno
 *     nuevo por tick). Snapshots DELTA (solo jugadores que cambiaron) + KEYFRAME
 *     periódico/para recién unidos.
 *
 * IMPORTANTE (sin ciclo de dependencias): este archivo vive en `@shared` y NO puede
 * importar `@mecha/sim`. Opera sobre interfaces ESTRUCTURALES (`WireWorld`/`WirePlayer`)
 * que `WorldState`/`PlayerState` satisfacen por duck-typing, así el servidor pasa el
 * mundo directo al encoder (lee al buffer sin asignar DTOs intermedios).
 */
import { ServerMsg, type GamePhase, type PlayerRole } from './messages';
import type { UserCommand } from './commands';

// v2: snapshot por jugador + camoScore (u8) y beingWatched (bit 3) — P0.2/P0.3.
// v3 (V1-B/V1-C): INPUT + aimY (i16, pitch) y pose (u8); snapshot + pose (bits 4-5 de
// roleFlags), aimY (i16) y lockProgress (u8).
// v4 (modelo de DISPAROS del original, post-playtest): fuera beingWatched y
// lockProgress; entra `ammo` (u8, munición restante del Seeker). El bit 3 de roleFlags
// queda RESERVADO. Cliente y servidor despliegan juntos (monorepo).
export const PROTOCOL_VERSION = 4;
export const MAX_SNAPSHOT_BYTES = 8192;
export const MAX_INPUT_BYTES = 64;

const POS_SCALE = 100; // punto fijo: metros → centímetros (int16: ±327 m)
const DIR_SCALE = 1000; // movimiento/apunte normalizado → int16

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}
/** Cuantiza un score 0..1 a un byte 0..255 (para el wire). */
function packScore(v: number): number {
  return Math.round(clamp01(v) * 255);
}

const PHASES: readonly GamePhase[] = ['lobby', 'prep', 'hunt', 'ended'];
const OUTCOMES = ['none', 'hiders', 'seekers'] as const;
type Outcome = (typeof OUTCOMES)[number];

// ── Interfaces estructurales (satisfechas por WorldState/PlayerState de @mecha/sim) ──
export interface WirePlayer {
  readonly id: string;
  readonly pos: { readonly x: number; readonly y: number; readonly z: number };
  readonly aimX: number;
  readonly aimY: number; // pitch del apunte (necesario para reconciliar el aim 3D)
  readonly aimZ: number;
  readonly color: { readonly r: number; readonly g: number; readonly b: number; readonly a: number };
  readonly role: PlayerRole;
  readonly frozen: boolean;
  readonly caught: boolean;
  readonly lastProcessedInput: number;
  readonly camoScore: number; // 0..1 (P0.2)
  readonly pose: number; // pose del Hider 0..3 (V1-B; viaja en bits 4-5 de roleFlags)
  readonly ammo: number; // disparos restantes del Seeker (v4; HUD de munición)
}
export interface WireWorld {
  readonly tick: number;
  readonly phase: GamePhase;
  readonly outcome: Outcome;
  readonly players: ReadonlyMap<string, WirePlayer>;
}

// ── Tipos decodificados ──
export type InputPayload = Omit<UserCommand, 'playerId'>;

export interface DecodedPlayer {
  id: string;
  lastProcessedInput: number;
  role: PlayerRole;
  frozen: boolean;
  caught: boolean;
  x: number;
  y: number;
  z: number;
  aimX: number;
  aimY: number;
  aimZ: number;
  colorPacked: number;
  camoScore: number; // 0..1 (P0.2)
  pose: number; // pose del Hider 0..3 (V1-B)
  ammo: number; // disparos restantes del Seeker (v4)
}
export interface DecodedSnapshot {
  type: 'keyframe' | 'delta';
  tick: number;
  phase: GamePhase;
  outcome: Outcome;
  players: DecodedPlayer[];
}

// ── ByteWriter: cursor sobre un ArrayBuffer reutilizado (cero asignaciones) ──
class ByteWriter {
  private readonly view: DataView;
  private readonly u8a: Uint8Array;
  private o = 0;
  constructor(buf: ArrayBuffer) {
    this.view = new DataView(buf);
    this.u8a = new Uint8Array(buf);
  }
  reset(): this {
    this.o = 0;
    return this;
  }
  u8(v: number): void {
    this.view.setUint8(this.o, v & 0xff);
    this.o += 1;
  }
  u16(v: number): void {
    this.view.setUint16(this.o, v & 0xffff);
    this.o += 2;
  }
  i16(v: number): void {
    this.view.setInt16(this.o, v);
    this.o += 2;
  }
  u32(v: number): void {
    this.view.setUint32(this.o, v >>> 0);
    this.o += 4;
  }
  /** Escribe un string ASCII corto (≤255): u8 longitud + bytes. Sin TextEncoder (sin asignar). */
  str(s: string): void {
    const n = s.length < 255 ? s.length : 255;
    this.u8(n);
    for (let i = 0; i < n; i++) this.view.setUint8(this.o + i, s.charCodeAt(i) & 0xff);
    this.o += n;
  }
  /** Vista sobre el buffer pooleado (NO una copia). Válida hasta el próximo encode. */
  bytes(): Uint8Array {
    return this.u8a.subarray(0, this.o);
  }
}

// ── ByteReader sobre el ArrayBuffer entrante ──
class ByteReader {
  private readonly view: DataView;
  private o = 0;
  constructor(buf: ArrayBuffer) {
    this.view = new DataView(buf);
  }
  u8(): number {
    const v = this.view.getUint8(this.o);
    this.o += 1;
    return v;
  }
  u16(): number {
    const v = this.view.getUint16(this.o);
    this.o += 2;
    return v;
  }
  i16(): number {
    const v = this.view.getInt16(this.o);
    this.o += 2;
    return v;
  }
  u32(): number {
    const v = this.view.getUint32(this.o);
    this.o += 4;
    return v;
  }
  str(): string {
    const n = this.u8();
    let s = '';
    for (let i = 0; i < n; i++) s += String.fromCharCode(this.view.getUint8(this.o + i));
    this.o += n;
    return s;
  }
  get offset(): number {
    return this.o;
  }
}

// Buffers pooleados de ámbito de módulo (un isolate monohilo).
const _snapWriter = new ByteWriter(new ArrayBuffer(MAX_SNAPSHOT_BYTES));
const _inputWriter = new ByteWriter(new ArrayBuffer(MAX_INPUT_BYTES));

function packRoleFlags(p: WirePlayer): number {
  // bit 3 RESERVADO (fue beingWatched en v2/v3).
  return (
    (p.role === 'seeker' ? 1 : 0) |
    (p.frozen ? 2 : 0) |
    (p.caught ? 4 : 0) |
    ((p.pose & 3) << 4)
  );
}
function packColor(c: WirePlayer['color']): number {
  return (((c.r & 0xff) * 0x1000000) + ((c.g & 0xff) << 16) + ((c.b & 0xff) << 8) + (c.a & 0xff)) >>> 0;
}

// ── INPUT (cliente → servidor) ──
export function encodeInput(input: InputPayload): Uint8Array {
  const w = _inputWriter.reset();
  w.u8(PROTOCOL_VERSION);
  w.u32(input.seq);
  w.i16(Math.round(input.moveX * DIR_SCALE));
  w.i16(Math.round(input.moveZ * DIR_SCALE));
  w.i16(Math.round(input.aimX * DIR_SCALE));
  w.i16(Math.round(input.aimY * DIR_SCALE));
  w.i16(Math.round(input.aimZ * DIR_SCALE));
  w.u8(input.action);
  w.u8(input.pose & 0xff);
  return w.bytes();
}

export function decodeInput(data: ArrayBuffer): InputPayload {
  const r = new ByteReader(data);
  r.u8(); // versión (validar en el borde si se versiona el protocolo)
  const seq = r.u32();
  const moveX = r.i16() / DIR_SCALE;
  const moveZ = r.i16() / DIR_SCALE;
  const aimX = r.i16() / DIR_SCALE;
  const aimY = r.i16() / DIR_SCALE;
  const aimZ = r.i16() / DIR_SCALE;
  const action = r.u8() as InputPayload['action'];
  const pose = r.u8();
  return { seq, moveX, moveZ, aimX, aimY, aimZ, action, pose };
}

// ── SNAPSHOT (servidor → cliente) ──
function writePlayer(w: ByteWriter, p: WirePlayer): void {
  w.str(p.id);
  w.u32(p.lastProcessedInput);
  w.u8(packRoleFlags(p));
  w.i16(Math.round(p.pos.x * POS_SCALE));
  w.i16(Math.round(p.pos.y * POS_SCALE));
  w.i16(Math.round(p.pos.z * POS_SCALE));
  w.i16(Math.round(p.aimX * DIR_SCALE));
  w.i16(Math.round(p.aimY * DIR_SCALE));
  w.i16(Math.round(p.aimZ * DIR_SCALE));
  w.u32(packColor(p.color));
  w.u8(packScore(p.camoScore));
  w.u8(p.ammo > 255 ? 255 : p.ammo & 0xff);
}

function writeHeader(w: ByteWriter, world: WireWorld, type: number, count: number): void {
  w.u8(PROTOCOL_VERSION);
  w.u8(type);
  w.u32(world.tick);
  w.u8(PHASES.indexOf(world.phase));
  w.u8(OUTCOMES.indexOf(world.outcome));
  w.u16(count);
}

/** Snapshot completo (recién unidos, periódico o tras cambiar el roster). */
export function encodeKeyframe(world: WireWorld): Uint8Array {
  const w = _snapWriter.reset();
  writeHeader(w, world, ServerMsg.KEYFRAME, world.players.size);
  for (const p of world.players.values()) writePlayer(w, p);
  return w.bytes();
}

/** Estado cuantizado por jugador retenido como línea base para el delta. */
export type Baseline = Map<string, number>;

/** Captura una firma cuantizada por jugador (para detectar cambios en el delta). */
export function captureBaseline(world: WireWorld): Baseline {
  const b: Baseline = new Map();
  for (const p of world.players.values()) b.set(p.id, playerSignature(p));
  return b;
}

// Firma barata e independiente del orden de los campos cuantizados (detección de cambio).
function playerSignature(p: WirePlayer): number {
  let h = 2166136261 >>> 0;
  const mix = (n: number): void => {
    h = (h ^ (n | 0)) >>> 0;
    h = Math.imul(h, 16777619) >>> 0;
  };
  mix(Math.round(p.pos.x * POS_SCALE));
  mix(Math.round(p.pos.y * POS_SCALE));
  mix(Math.round(p.pos.z * POS_SCALE));
  mix(Math.round(p.aimX * DIR_SCALE));
  mix(Math.round(p.aimY * DIR_SCALE));
  mix(Math.round(p.aimZ * DIR_SCALE));
  mix(packColor(p.color));
  mix(packRoleFlags(p)); // incluye la pose (bits 4-5)
  mix(p.lastProcessedInput);
  mix(packScore(p.camoScore));
  mix(p.ammo);
  return h;
}

/**
 * Snapshot delta: solo los jugadores cuya firma cuantizada cambió respecto a la
 * línea base. Asume el MISMO roster que la base (los cambios de roster los maneja un
 * KEYFRAME). Devuelve la vista; el llamador debe actualizar la base tras enviar.
 */
export function encodeDelta(baseline: Baseline, world: WireWorld): Uint8Array {
  const w = _snapWriter.reset();
  // Un solo pase: calcula la firma UNA vez por jugador y acumula los cambiados (el
  // array es ≤ jugadores de la sala). Evita recomputar firmas dos veces y garantiza
  // que la cuenta del header coincide exactamente con los jugadores escritos.
  const changed: WirePlayer[] = [];
  for (const p of world.players.values()) {
    if (baseline.get(p.id) !== playerSignature(p)) changed.push(p);
  }
  writeHeader(w, world, ServerMsg.SNAPSHOT, changed.length);
  for (let i = 0; i < changed.length; i++) writePlayer(w, changed[i]!);
  return w.bytes();
}

export function decodeSnapshot(data: ArrayBuffer): DecodedSnapshot {
  const r = new ByteReader(data);
  r.u8(); // versión
  const typeByte = r.u8();
  const tick = r.u32();
  const phase = PHASES[r.u8()] ?? 'lobby';
  const outcome = OUTCOMES[r.u8()] ?? 'none';
  const count = r.u16();
  const players: DecodedPlayer[] = [];
  for (let i = 0; i < count; i++) {
    const id = r.str();
    const lastProcessedInput = r.u32();
    const flags = r.u8();
    const x = r.i16() / POS_SCALE;
    const y = r.i16() / POS_SCALE;
    const z = r.i16() / POS_SCALE;
    const aimX = r.i16() / DIR_SCALE;
    const aimY = r.i16() / DIR_SCALE;
    const aimZ = r.i16() / DIR_SCALE;
    const colorPacked = r.u32();
    const camoScore = r.u8() / 255;
    const ammo = r.u8();
    players.push({
      id,
      lastProcessedInput,
      role: (flags & 1) === 1 ? 'seeker' : 'hider',
      frozen: (flags & 2) === 2,
      caught: (flags & 4) === 4,
      pose: (flags >> 4) & 3,
      x,
      y,
      z,
      aimX,
      aimY,
      aimZ,
      colorPacked,
      camoScore,
      ammo,
    });
  }
  return {
    type: typeByte === ServerMsg.KEYFRAME ? 'keyframe' : 'delta',
    tick,
    phase,
    outcome,
    players,
  };
}
