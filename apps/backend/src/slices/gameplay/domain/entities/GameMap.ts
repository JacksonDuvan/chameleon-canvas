/**
 * GameMap — definición estática del escenario en coordenadas puras (x,y,z): puntos
 * de spawn, geometría de colisión y metadatos de materiales (ladrillo, madera…) de
 * los que el Hider absorbe color/textura.
 *
 * "Netcode primero" (skill `authoritative-netcode`): el MVP del Paso 2 modela esto
 * como datos planos/numéricos, SIN nada visual de Three.js (eso vive en el front).
 *
 * SCAFFOLD del Paso 1 — Paso 2.
 */
export interface SpawnPoint {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

export class GameMap {
  readonly id: string;
  readonly spawns: readonly SpawnPoint[];

  constructor(id: string, spawns: readonly SpawnPoint[] = []) {
    this.id = id;
    this.spawns = spawns;
  }
}
