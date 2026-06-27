/**
 * Adaptador del puerto `IPhysicsWorld` implementado con Rapier (WASM).
 *
 * Es el ÚNICO archivo del kernel que conoce Rapier. Recibe el módulo Rapier ya
 * inicializado (ver `./wasm/rapier-init.ts`); NO hace `await` por tick — el
 * `step` de Rapier es síncrono y determinista.
 *
 * Skills: `hexagonal-vertical-slicing` (adaptador detrás del puerto) +
 * `workers-memory-optimization` (reutilizar handles/colliders, no recrear por tick) +
 * `authoritative-netcode` (mismo build de Rapier en server y cliente = determinismo).
 *
 * SCAFFOLD del Paso 1 — integración real en el Paso 2/3.
 */
import type RAPIER from '@dimforge/rapier3d-compat';
import type { IPhysicsWorld } from './IPhysicsWorld';

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

  step(_dt: number): void {
    // Rapier integra con su propio timestep; se fija a dt en el setup del World.
    this.world.step();
  }

  dispose(): void {
    this.world.free();
  }
}
