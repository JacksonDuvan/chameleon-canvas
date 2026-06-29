/**
 * Adaptador del puerto `IPhysicsWorld` implementado con Rapier (WASM).
 *
 * Es el ÚNICO archivo del kernel que conoce Rapier. Recibe el módulo Rapier ya
 * inicializado (ver `./wasm/rapier-init.ts`); NO hace `await` por tick.
 *
 * Skills: `hexagonal-vertical-slicing` (adaptador detrás del puerto) +
 * `workers-memory-optimization` (reutilizar handles/colliders, no recrear por tick) +
 * `authoritative-netcode` (mismo build de Rapier en server y cliente = determinismo).
 *
 * SCAFFOLD: implementa la firma del puerto pero la integración real (rigid bodies,
 * raycast contra colliders) llega cuando se necesite colisión rica contra geometría
 * compleja. Hoy el MVP usa `KinematicPhysicsWorld` (mismo puerto).
 */
import type RAPIER from '@dimforge/rapier3d-compat';
import type { WorldState } from '../core/entities/WorldState';
import type { IPhysicsWorld, RaycastHit } from './IPhysicsWorld';

export class RapierPhysicsWorld implements IPhysicsWorld {
  private readonly world: RAPIER.World;

  /**
   * @param rapier  módulo Rapier YA inicializado (de `getRapier()`)
   * @param gravity gravedad del mundo
   */
  constructor(
    rapier: typeof RAPIER,
    gravity: { x: number; y: number; z: number } = { x: 0, y: -9.81, z: 0 },
  ) {
    this.world = new rapier.World(gravity);
  }

  syncBodies(_world: WorldState): void {
    // TODO: crear/actualizar rigid bodies + colliders desde world.players,
    // reutilizando handles (sin recrear por tick); this.world.step() si se integran físicas.
  }

  raycastClosest(
    _ox: number,
    _oy: number,
    _oz: number,
    _dx: number,
    _dy: number,
    _dz: number,
    _maxDist: number,
    _excludePlayerId: string,
  ): RaycastHit | null {
    // TODO: this.world.castRay(...) contra los colliders de jugadores y mapear el handle a playerId.
    return null;
  }

  dispose(): void {
    this.world.free();
  }
}
