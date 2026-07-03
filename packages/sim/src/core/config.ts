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
  // Alcance de ARMA (no de "toque"): con 3 m el disparo en FPP "no funcionaba"
  // (feedback del playtest). En el pueblo 48×48 NO cruza el mapa entero a propósito:
  // el Seeker tiene que acercarse a los barrios para barrerlos.
  catchRange: 30,
  playerRadius: 0.5,
  eyeHeight: 1.5,
  // Pueblo 48×48 (mapa v2): más terreno que recorrer para esconderse y para barrer.
  // Prep 60 s: feedback del playtest ("agrega más tiempo a los Hiders para esconderse").
  prepDurationTicks: HZ * 60, // 60 s
  huntDurationTicks: HZ * 120, // 120 s
  colorLockTicks: HZ * 1, // 1 s
  // DEBE coincidir con DEFAULT_MAP.bounds (una sola verdad efectiva; test lo fuerza).
  bounds: { minX: -24, maxX: 24, minY: 0, maxY: 5, minZ: -24, maxZ: 24 },
  camoMovePenalty: 0.85, // moverse a máxima velocidad te delata casi por completo
  ammoLimitEnabled: false, // base fiel al original: sin límite (el modo estricto es opt-in)
  shotAmmo: 10, // munición inicial del modo limitado
  shotCooldownTicks: Math.round(HZ * 0.6), // ~0.6 s entre disparos
};
