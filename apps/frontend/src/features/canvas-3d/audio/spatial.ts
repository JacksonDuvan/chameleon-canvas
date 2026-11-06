/**
 * Posicionamiento estéreo de eventos sonoros (V1-H). Lógica PURA (sin
 * WebAudio): dadas la posición+apunte del jugador local y el punto del evento,
 * produce la señal de audio (pan -1..1, gain 0..1).
 *
 * Sistema de coordenadas de three (y-up, mano derecha): forward horizontal del
 * apunte = (aimX, aimZ); right = forward × up = (-aimZ, aimX).
 * gain decae 1/(1 + dist/8): a 8 m la mitad, a 24 m un cuarto — un silbido se
 * oye, pero la distancia se SIENTE (regla de la biblia: pista sonora).
 */
export interface Spatial {
  readonly pan: number; // -1 izquierda … +1 derecha
  readonly gain: number; // 0..1
}

const DIST_HALF = 8; // metros a los que el volumen cae a la mitad
const EPS = 1e-6;

export function computeSpatial(
  local: { x: number; z: number; aimX: number; aimZ: number },
  event: { x: number; z: number },
): Spatial {
  const dx = event.x - local.x;
  const dz = event.z - local.z;
  const dist = Math.hypot(dx, dz);

  // Apunte horizontal (proyección y del aim es vertical): normalízala con guarda
  // (apuntar al cielo/bajo deja la horizontal ~0 ⇒ pan neutral).
  let fx = local.aimX;
  let fz = local.aimZ;
  const fl = Math.hypot(fx, fz);
  if (fl < EPS) {
    return { pan: 0, gain: gainFor(dist) };
  }
  fx /= fl;
  fz /= fl;

  if (dist < EPS) return { pan: 0, gain: gainFor(dist) };

  // right = (-fz, fx); pan = cos(ángulo entre rel y right) ⇒ proyección normalizada.
  const rx = -fz;
  const rz = fx;
  const pan = Math.max(-1, Math.min(1, (dx * rx + dz * rz) / dist));
  return { pan, gain: gainFor(dist) };
}

function gainFor(dist: number): number {
  return 1 / (1 + dist / DIST_HALF);
}
