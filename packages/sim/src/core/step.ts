/**
 * `step` — UN tick determinista de la simulación. Es el corazón compartido del
 * netcode: lo ejecuta el servidor (autoritativo, `ProcessTick`) y lo re-ejecuta
 * el cliente (predicción/reconciliación) con EL MISMO código.
 *
 * Skills: `authoritative-netcode` (timestep fijo, servidor autoritativo) +
 * `workers-memory-optimization` (sin asignaciones en el bucle: muta el estado,
 * usa scratch reutilizable) + `hexagonal-vertical-slicing` (puro; recibe la
 * física por el PUERTO `IPhysicsWorld`, no importa Rapier).
 *
 * SCAFFOLD del Paso 1 — la lógica llega en el Paso 2.
 *
 * @param state  estado del mundo (se MUTA in situ; no se devuelve uno nuevo)
 * @param commands  comandos de usuario validados para este tick
 * @param dt  delta FIJO en segundos (1/30); nunca un delta de reloj variable
 * @param rng  fuente determinista con semilla
 * @param physics  adaptador de físicas tras el puerto (Rapier por debajo)
 */
import type { WorldState } from './entities/WorldState';
import type { Rng } from './rng';
import type { IPhysicsWorld } from '../physics/IPhysicsWorld';

// TODO(Paso 2): tipar UserCommand desde @shared/protocol.
export type UserCommand = { readonly seq: number; readonly playerId: string };

export function step(
  state: WorldState,
  _commands: readonly UserCommand[],
  _dt: number,
  _rng: Rng,
  _physics: IPhysicsWorld,
): void {
  // 1) aplicar cada comando al mundo autoritativo (validado en el use-case)
  // 2) avanzar física exactamente dt vía physics.step(dt)
  // 3) state.tick++ y estampar lastProcessedInput por jugador
  state.tick++;
}
