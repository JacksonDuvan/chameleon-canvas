/**
 * Camuflaje (P0.2/P0.3) — cálculo DETERMINISTA y server-authoritative de "qué tan
 * camuflado está un Hider" y de cuánto debe fijar el Seeker la mira para taggearlo.
 *
 * Vive en `@mecha/sim` porque debe ser idéntico allá donde se calcule (hoy solo el
 * servidor lo consume en `step`; el cliente lo recibe ya calculado en el snapshot). El
 * cliente NUNCA decide si estás oculto (skill `authoritative-netcode`).
 *
 * Modelo (MVP): parecido de color al entorno + quietud. No mira metallic/roughness (el
 * avatar aún no los guarda; P1). Sin asignaciones.
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

/**
 * Ticks de mira sostenida ("fijación") que un Seeker debe mantener sobre un objetivo con
 * este `camoScore` para confirmar la captura. Objetivo visible (0) → mínimo (casi
 * instantáneo); camuflaje perfecto y quieto (1) → máximo. Interpolación lineal.
 *
 * Es el corazón del modelo HÍBRIDO: el bien camuflado no es inmune, pero exige que el
 * Seeker esté SEGURO (sostenga la mira) — premia la observación sin quitarle el tag.
 */
export function requiredFixationTicks(camoScore: number, cfg: SimConfig): number {
  const s = clamp01(camoScore);
  return Math.round(cfg.fixationMinTicks + (cfg.fixationMaxTicks - cfg.fixationMinTicks) * s);
}
