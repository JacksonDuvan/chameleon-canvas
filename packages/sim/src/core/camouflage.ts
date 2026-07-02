/**
 * Camuflaje (P0.2) — cálculo DETERMINISTA y server-authoritative de "qué tan
 * camuflado está un Hider". Alimenta la BARRA del HUD (auto-inspección del Hider).
 *
 * Tras el playtest de V1 la captura volvió al modelo del ORIGINAL (disparo instantáneo
 * con munición limitada): el camuflaje ya NO modula la resolución del impacto — engaña
 * al OJO del Seeker humano (percepción), como en el juego real. Este score queda como
 * feedback para el Hider. Decisión documentada en docs/07.
 *
 * Vive en `@mecha/sim` porque debe ser idéntico allá donde se calcule (hoy solo el
 * servidor lo consume en `step`; el cliente lo recibe ya calculado en el snapshot).
 *
 * Modelo (MVP): parecido de color al entorno + quietud. Sin asignaciones.
 */
import type { ColorRGBA } from './value-objects/ColorRGBA';
import type { SimConfig } from './config';

/** Distancia euclídea RGB máxima (negro↔blanco): sqrt(3·255²). */
const MAX_COLOR_DIST = Math.sqrt(3 * 255 * 255);

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

/**
 * Score de camuflaje 0..1 (0 = totalmente visible; 1 = fundido con el entorno).
 * Combina el parecido de color del avatar con el color de referencia del entorno
 * (`ref`, de `MapData.referenceColorAt`) y una penalización por movimiento: moverte te
 * delata. Determinista.
 */
export function computeCamouflage(
  color: ColorRGBA,
  ref: ColorRGBA,
  speed: number,
  cfg: SimConfig,
): number {
  const dr = color.r - ref.r;
  const dg = color.g - ref.g;
  const db = color.b - ref.b;
  const dist = Math.sqrt(dr * dr + dg * dg + db * db);
  const colorMatch = 1 - clamp01(dist / MAX_COLOR_DIST);
  const speedFrac = cfg.maxSpeed > 0 ? clamp01(speed / cfg.maxSpeed) : 0;
  const movement = 1 - speedFrac * cfg.camoMovePenalty;
  return clamp01(colorMatch * movement);
}
