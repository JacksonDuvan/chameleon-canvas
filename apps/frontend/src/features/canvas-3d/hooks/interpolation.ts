/**
 * Interpolación de entidades remotas (lógica PURA, fuera de React). Skill
 * `authoritative-netcode`: los remotos se renderizan en el PASADO por un retardo de
 * interpolación fijo (~2 intervalos de snapshot), interpolando linealmente entre los
 * dos snapshots que rodean `renderTime = now - INTERP_DELAY_MS`. Suaviza el jitter de
 * red y permite 60+ FPS entre ticks de 20–30 Hz.
 *
 * `sampleRemote` muta un `Vec3` de salida (sin asignar) para encajar con `useFrame`.
 */
import type { Vec3 } from '@mecha/sim';
import type { RemoteSnapshot } from '../store/worldStore';

export const INTERP_DELAY_MS = 100;
export const MAX_REMOTE_BUFFER = 16;

/** Inserta un snapshot manteniendo el orden por `recvAt` y podando el buffer. */
export function pushRemoteSnapshot(buffer: RemoteSnapshot[], snap: RemoteSnapshot): void {
  buffer.push(snap);
  if (buffer.length > MAX_REMOTE_BUFFER) buffer.shift();
}

/**
 * Escribe en `out` la posición interpolada del remoto en `renderTime`. El buffer está
 * ordenado por `recvAt` ascendente. Si `renderTime` cae fuera del buffer, hace clamp al
 * extremo más cercano (sin extrapolar). No asigna.
 */
export function sampleRemote(buffer: RemoteSnapshot[], renderTime: number, out: Vec3): void {
  const n = buffer.length;
  if (n === 0) return;
  const first = buffer[0]!;
  const last = buffer[n - 1]!;
  if (n === 1 || renderTime <= first.recvAt) {
    out.setMut(first.x, first.y, first.z);
    return;
  }
  if (renderTime >= last.recvAt) {
    out.setMut(last.x, last.y, last.z);
    return;
  }
  // Buscar el par (a, b) que rodea renderTime.
  for (let i = 1; i < n; i++) {
    const b = buffer[i]!;
    if (renderTime <= b.recvAt) {
      const a = buffer[i - 1]!;
      const span = b.recvAt - a.recvAt;
      const t = span > 0 ? (renderTime - a.recvAt) / span : 0;
      out.setMut(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t, a.z + (b.z - a.z) * t);
      return;
    }
  }
}

/**
 * Suavizado visual del jugador LOCAL. La predicción escribe `pos` a tick rate (30 Hz);
 * dibujarla cruda a 60–144 fps hace que el avatar "tiemble" al caminar en 3ª persona
 * (bug del playtest; el Seeker no lo nota porque en FPP no se ve a sí mismo).
 * Interpola linealmente prev→curr según el tiempo desde la última predicción
 * (`predAt`), con clamp a [0,1]: NUNCA extrapola (un input tardío solo retiene el
 * avatar donde está). Muta `out` (sin asignar; se llama por frame).
 */
export function sampleLocalMut(
  prev: Readonly<{ x: number; y: number; z: number }>,
  curr: Readonly<{ x: number; y: number; z: number }>,
  predAt: number,
  now: number,
  tickMs: number,
  out: { x: number; y: number; z: number }, // estructural: vale Vec3 del sim o THREE.Vector3
): void {
  const raw = tickMs > 0 ? (now - predAt) / tickMs : 1;
  const t = raw < 0 ? 0 : raw > 1 ? 1 : raw;
  out.x = prev.x + (curr.x - prev.x) * t;
  out.y = prev.y + (curr.y - prev.y) * t;
  out.z = prev.z + (curr.z - prev.z) * t;
}
