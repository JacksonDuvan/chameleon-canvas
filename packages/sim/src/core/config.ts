/**
 * Parámetros DETERMINISTAS de la simulación. Viven en el estado del mundo
 * (`WorldState.config`) para que servidor y cliente usen valores idénticos y la
 * predicción converja. No confundir con `RoomConfig` (maxPlayers, whistling), que
 * es config de sala server-only.
 */
import type { ArenaBounds } from './collision';

export interface SimConfig {
  readonly tickHz: number;
  readonly maxSpeed: number; // unidades/segundo (clamp anti-trampas del servidor)
  readonly catchRange: number; // alcance del rayo de captura del Seeker
  readonly playerRadius: number; // radio de la cápsula del jugador (raycast)
  readonly eyeHeight: number; // altura del origen del rayo de captura
  readonly prepDurationTicks: number; // duración de la Prep Phase
  readonly huntDurationTicks: number; // duración de la Hunt Phase
  readonly colorLockTicks: number; // bloqueo tras absorber color (anti-spam)
  readonly bounds: ArenaBounds;
  // ── Camuflaje (P0.2) ──
  readonly camoMovePenalty: number; // 0..1: cuánto reduce el camuflaje moverse a tope
  // ── Detección por fijación (P0.3, modelo híbrido) ──
  readonly fixationMinTicks: number; // ticks de mira sostenida para taggear a un objetivo VISIBLE
  readonly fixationMaxTicks: number; // ticks para taggear a uno con camuflaje PERFECTO y quieto
}

const HZ = 30;

export const DEFAULT_SIM_CONFIG: SimConfig = {
  tickHz: HZ,
  maxSpeed: 6,
  catchRange: 3,
  playerRadius: 0.5,
  eyeHeight: 1.5,
  prepDurationTicks: HZ * 30, // 30 s
  huntDurationTicks: HZ * 90, // 90 s
  colorLockTicks: HZ * 1, // 1 s
  bounds: { minX: -20, maxX: 20, minY: 0, maxY: 5, minZ: -20, maxZ: 20 },
  camoMovePenalty: 0.85, // moverse a máxima velocidad te delata casi por completo
  fixationMinTicks: 2, // objetivo visible: casi instantáneo (~66 ms)
  fixationMaxTicks: HZ * 2.5, // camuflaje perfecto + quieto: hay que sostener la mira 2.5 s
};
