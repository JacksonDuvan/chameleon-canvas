/**
 * PUERTO de físicas/consulta espacial. El núcleo de simulación (`core/step`) depende
 * de ESTA interfaz, nunca de Rapier directamente — así `core/` sigue siendo puro y
 * testeable con un adaptador ligero (skills `hexagonal-vertical-slicing` + `tdd-testing`).
 *
 * Implementaciones:
 *   - `KinematicPhysicsWorld` (ligero, puro TS, determinista) — usado en el MVP/tests.
 *   - `RapierPhysicsWorld` (WASM) — para colisión rica contra geometría estática (futuro).
 */
import type { WorldState } from '../core/entities/WorldState';
import type { MapData } from '../core/map/MapData';

export interface RaycastHit {
  readonly playerId: string;
  readonly distance: number;
}

export interface IPhysicsWorld {
  /** Refleja las posiciones actuales de los jugadores en los cuerpos (in situ). */
  syncBodies(world: WorldState): void;

  /**
   * Reemplaza los OBSTÁCULOS estáticos por los del mapa dado (para el mapa aleatorio
   * por ronda: cuando cambia `world.mapSeed`, el servidor regenera el mapa y llama a
   * esto para que la oclusión del rayo use los sólidos correctos). Reasigna arrays;
   * no es camino caliente (ocurre una vez por ronda).
   */
  setMap(map: MapData): void;

  /**
   * Rayo contra los cuerpos de jugadores; devuelve el impacto más cercano dentro de
   * `maxDist`, excluyendo a quien dispara. La dirección DEBE venir normalizada.
   * Es como el Seeker "dispara y registra impacto" (skill `authoritative-netcode`).
   */
  raycastClosest(
    ox: number,
    oy: number,
    oz: number,
    dx: number,
    dy: number,
    dz: number,
    maxDist: number,
    excludePlayerId: string,
  ): RaycastHit | null;

  /** Libera recursos (no-op en el adaptador ligero; libera el World en Rapier). */
  dispose(): void;
}
