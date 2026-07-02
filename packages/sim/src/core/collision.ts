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

/**
 * Primer impacto de un rayo contra una caja alineada a los ejes (método de slabs).
 * La dirección DEBE venir normalizada. Devuelve la distancia `t >= 0` o `null`.
 * Si el origen está dentro de la caja, devuelve 0. Es la base de la OCLUSIÓN (V1-A):
 * un muro/prop entre el Seeker y el Hider bloquea el rayo de captura.
 */
export function rayAABB(
  ox: number,
  oy: number,
  oz: number,
  dx: number,
  dy: number,
  dz: number,
  minX: number,
  minY: number,
  minZ: number,
  maxX: number,
  maxY: number,
  maxZ: number,
): number | null {
  let tmin = 0;
  let tmax = Infinity;

  // Eje X
  if (dx === 0) {
    if (ox < minX || ox > maxX) return null;
  } else {
    const inv = 1 / dx;
    let t1 = (minX - ox) * inv;
    let t2 = (maxX - ox) * inv;
    if (t1 > t2) {
      const tmp = t1;
      t1 = t2;
      t2 = tmp;
    }
    if (t1 > tmin) tmin = t1;
    if (t2 < tmax) tmax = t2;
    if (tmin > tmax) return null;
  }
  // Eje Y
  if (dy === 0) {
    if (oy < minY || oy > maxY) return null;
  } else {
    const inv = 1 / dy;
    let t1 = (minY - oy) * inv;
    let t2 = (maxY - oy) * inv;
    if (t1 > t2) {
      const tmp = t1;
      t1 = t2;
      t2 = tmp;
    }
    if (t1 > tmin) tmin = t1;
    if (t2 < tmax) tmax = t2;
    if (tmin > tmax) return null;
  }
  // Eje Z
  if (dz === 0) {
    if (oz < minZ || oz > maxZ) return null;
  } else {
    const inv = 1 / dz;
    let t1 = (minZ - oz) * inv;
    let t2 = (maxZ - oz) * inv;
    if (t1 > t2) {
      const tmp = t1;
      t1 = t2;
      t2 = tmp;
    }
    if (t1 > tmin) tmin = t1;
    if (t2 < tmax) tmax = t2;
    if (tmin > tmax) return null;
  }
  return tmin; // tmin arranca en 0: origen dentro ⇒ 0
}

/**
 * Resuelve la colisión de un círculo (jugador, plano XZ) contra un rectángulo AABB
 * sólido, empujando el centro FUERA in situ (V1-A: no atravesar props/muros).
 * Determinista: empates de eje resueltos en orden fijo. Sin asignaciones.
 */
export function resolveCircleAABBMut(
  pos: Vec3,
  r: number,
  minX: number,
  minZ: number,
  maxX: number,
  maxZ: number,
): void {
  // Punto del AABB más cercano al centro.
  const cx = pos.x < minX ? minX : pos.x > maxX ? maxX : pos.x;
  const cz = pos.z < minZ ? minZ : pos.z > maxZ ? maxZ : pos.z;
  const dx = pos.x - cx;
  const dz = pos.z - cz;
  const d2 = dx * dx + dz * dz;
  if (d2 >= r * r) return; // sin solape

  if (d2 > 1e-12) {
    // Centro fuera de la caja: empuja a lo largo de la normal del punto más cercano.
    const d = Math.sqrt(d2);
    const push = (r - d) / d;
    pos.x += dx * push;
    pos.z += dz * push;
  } else {
    // Centro DENTRO de la caja: expulsa por el eje de mínima penetración (orden fijo).
    const left = pos.x - (minX - r);
    const right = maxX + r - pos.x;
    const near = pos.z - (minZ - r);
    const far = maxZ + r - pos.z;
    let m = left;
    let side = 0;
    if (right < m) {
      m = right;
      side = 1;
    }
    if (near < m) {
      m = near;
      side = 2;
    }
    if (far < m) {
      side = 3;
    }
    if (side === 0) pos.x = minX - r;
    else if (side === 1) pos.x = maxX + r;
    else if (side === 2) pos.z = minZ - r;
    else pos.z = maxZ + r;
  }
}
