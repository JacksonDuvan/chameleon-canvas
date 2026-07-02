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
  readonly catchRange: number; // alcance del DISPARO del Seeker (rayo)
  readonly playerRadius: number; // radio de la cápsula del jugador (raycast)
  readonly eyeHeight: number; // altura del origen del rayo de captura
  readonly prepDurationTicks: number; // duración de la Prep Phase
  readonly huntDurationTicks: number; // duración de la Hunt Phase
  readonly colorLockTicks: number; // bloqueo tras absorber color (anti-spam)
  readonly bounds: ArenaBounds;
  // ── Camuflaje (P0.2) ──
  readonly camoMovePenalty: number; // 0..1: cuánto reduce el camuflaje moverse a tope
  // ── Disparos del Seeker (modelo del original: tag por impacto) ──
  // Por defecto la munición es ILIMITADA (como el juego base). `ammoLimitEnabled`
  // activa el modo del update 2.3.0 del original (opción del host): fallar cuesta 1,
  // acertar es gratis, y si TODOS los Seekers llegan a 0 ganan los Hiders al instante.
  readonly ammoLimitEnabled: boolean;
  readonly shotAmmo: number; // munición inicial por Seeker (solo en modo limitado)
  readonly shotCooldownTicks: number; // ticks mínimos entre disparos (anti-spray, siempre)
}

const HZ = 30;

export const DEFAULT_SIM_CONFIG: SimConfig = {
  tickHz: HZ,
  maxSpeed: 6,
  // Alcance de ARMA (no de "toque"): cruza la sala (30×30). Con 3 m el disparo en FPP
  // "no funcionaba" — había que estar casi pegado (feedback del playtest).
  catchRange: 30,
  playerRadius: 0.5,
  eyeHeight: 1.5,
  prepDurationTicks: HZ * 30, // 30 s
  huntDurationTicks: HZ * 90, // 90 s
  colorLockTicks: HZ * 1, // 1 s
  bounds: { minX: -20, maxX: 20, minY: 0, maxY: 5, minZ: -20, maxZ: 20 },
  camoMovePenalty: 0.85, // moverse a máxima velocidad te delata casi por completo
  ammoLimitEnabled: false, // base fiel al original: sin límite (el modo estricto es opt-in)
  shotAmmo: 10, // munición inicial del modo limitado
  shotCooldownTicks: Math.round(HZ * 0.6), // ~0.6 s entre disparos
};
