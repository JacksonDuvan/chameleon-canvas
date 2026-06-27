/**
 * Estado de la simulación (lo que servidor y cliente deben calcular IDÉNTICO).
 *
 * Skills: `authoritative-netcode` (estampado con `tick` y `lastProcessedInput`
 * por jugador) + `workers-memory-optimization` (formas fijas; el estado pesado
 * vivirá en typed arrays / pools, no en arrays de objetos efímeros).
 *
 * SCAFFOLD del Paso 1 — modelado completo en el Paso 2 ("netcode primero",
 * MVP en coordenadas (x,y,z) abstractas).
 */
import { Position } from '../value-objects/Position';
import { ColorRGBA } from '../value-objects/ColorRGBA';
import type { PlayerRole } from '@shared/protocol';

export class PlayerState {
  id = '';
  role: PlayerRole = 'hider';
  readonly pos = new Position();
  readonly color = new ColorRGBA();
  frozen = false; // congelado en Hunt Phase (Hider) tras pulsar 'Espacio'
  colorLockedUntil = 0; // tick hasta el que el color no puede recambiarse
  lastProcessedInput = 0; // nº de secuencia del último input consumido (reconciliación)

  // TODO(Paso 2): velocidad, pose, alive, etc. — todo declarado aquí (forma fija).
}

export class WorldState {
  tick = 0;
  readonly players = new Map<string, PlayerState>();

  // TODO(Paso 2): fase actual, semilla, geometría estática del mapa.
}
