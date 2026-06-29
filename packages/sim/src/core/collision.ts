/**
 * Colisión y geometría DETERMINISTA pura (sin asignaciones, sin trigonometría).
 *
 * `raySphere` resuelve "el Seeker dispara y registra impacto" matemáticamente
 * (la intención de Step 2). `clampToBoundsMut` es la línea base anti-trampas:
 * el servidor hace clamp de la posición a los límites del escenario.
 *
 * Skills `authoritative-netcode` (impactos en el servidor) +
 * `workers-memory-optimization` (todo por valor, cero asignaciones).
 */
import type { Vec3 } from './value-objects/Vec3';

export interface ArenaBounds {
  readonly minX: number;
  readonly maxX: number;
  readonly minY: number;
  readonly maxY: number;
  readonly minZ: number;
  readonly maxZ: number;
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

/** Restringe la posición al volumen del escenario, in situ. */
export function clampToBoundsMut(pos: Vec3, b: ArenaBounds): void {
  pos.x = clamp(pos.x, b.minX, b.maxX);
  pos.y = clamp(pos.y, b.minY, b.maxY);
  pos.z = clamp(pos.z, b.minZ, b.maxZ);
}

/**
 * Primer impacto de un rayo contra una esfera. La dirección DEBE venir normalizada.
 * Devuelve la distancia `t >= 0` del impacto, o `null` si no hay impacto.
 * Si el origen está dentro de la esfera, devuelve 0.
 */
export function raySphere(
  ox: number,
  oy: number,
  oz: number,
  dx: number,
  dy: number,
  dz: number,
  cx: number,
  cy: number,
  cz: number,
  r: number,
): number | null {
  const mx = ox - cx;
  const my = oy - cy;
  const mz = oz - cz;
  const b = mx * dx + my * dy + mz * dz;
  const c = mx * mx + my * my + mz * mz - r * r;
  // Origen fuera de la esfera (c > 0) y rayo apuntando en contra (b > 0): no hay impacto.
  if (c > 0 && b > 0) return null;
  const disc = b * b - c;
  if (disc < 0) return null;
  const t = -b - Math.sqrt(disc);
  return t < 0 ? 0 : t;
}
