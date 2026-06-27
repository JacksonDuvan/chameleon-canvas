/**
 * useInterpolation — suaviza el movimiento de los rivales entre ticks de red
 * (20–30 Hz) para renderizar a 60+ FPS. Renderiza a los remotos en el PASADO
 * (~100 ms = ~2 intervalos de snapshot) interpolando (Lerp) entre los dos
 * snapshots que rodean `now - interpDelay`.
 *
 * Skill `authoritative-netcode` (interpolación de entidades) + `r3f-rendering`:
 * el Lerp ocurre en useFrame mutando el ref/posición de render; usa un Vector3
 * scratch reutilizado (cero asignaciones por frame).
 *
 * SCAFFOLD del Paso 1 — Paso 4.
 */
export const INTERP_DELAY_MS = 100;

export function useInterpolation(): void {
  // TODO(Paso 4): en useFrame, por cada RemoteEntity, hallar los 2 snapshots que
  // rodean renderTime y lerp(render, a, b, t) mutando render in situ.
}
