/**
 * V1-H · Whistling — cadencia de los silbidos de los Hiders (regla opcional del
 * host; pista sonora que delata, biblia de gameplay).
 *
 * REGLA de dominio (pura): cada silbido llega tras un delay de
 * `base·(1 ± jitter)` alrededor de la cadencia configurada — ni metrónomo
 * predecible ni silencio injusto. El jitter se INYECTA como `rand01` (el
 * dominio no toca Math.random); el DO lo llama con entropía real porque un
 * silbido es una PISTA de presentación, no estado de simulación (no afecta al
 * determinismo del juego ni al desenlace).
 */
export const WHISTLE_JITTER = 0.25;

/** Delay (s) hasta el próximo silbido de un Hider. */
export function whistleDelaySec(baseSec: number, rand01: number): number {
  const base = Math.max(1, baseSec);
  return base * (1 - WHISTLE_JITTER + 2 * WHISTLE_JITTER * rand01);
}
