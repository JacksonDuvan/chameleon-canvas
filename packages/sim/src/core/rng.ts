/**
 * RNG determinista con semilla (mulberry32): estado entero de 32 bits, rápido y sin
 * asignar. Requisito de `authoritative-netcode`: nada de `Math.random` ambiente; la
 * semilla del servidor se replica al cliente para que la predicción converja.
 *
 * El estado es serializable (`getState`/`setState`) para persistirlo en el storage
 * del DO y sobrevivir a la hibernación (Paso 3).
 */
export interface Rng {
  /** Float determinista en [0, 1). */
  next(): number;
  /** Entero determinista en [0, maxExclusive). */
  nextInt(maxExclusive: number): number;
  getState(): number;
  setState(state: number): void;
}

export function makeRng(seed: number): Rng {
  let s = seed >>> 0;
  const next = (): number => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    next,
    nextInt: (maxExclusive: number): number => Math.floor(next() * maxExclusive),
    getState: (): number => s,
    setState: (state: number): void => {
      s = state >>> 0;
    },
  };
}
