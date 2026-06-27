/**
 * RNG determinista con semilla. Requisito de `authoritative-netcode`: nada de
 * `Math.random` ambiente; la semilla del servidor se replica al cliente para que
 * la predicción converja.
 *
 * SCAFFOLD del Paso 1 — implementación (p. ej. mulberry32 / sfc32) en el Paso 2.
 */
export interface Rng {
  /** Devuelve un float determinista en [0, 1). */
  next(): number;
}

export function makeRng(_seed: number): Rng {
  // TODO(Paso 2): generador determinista con estado entero (sin asignar en caliente).
  throw new Error('makeRng: pendiente de implementar (Paso 2)');
}
