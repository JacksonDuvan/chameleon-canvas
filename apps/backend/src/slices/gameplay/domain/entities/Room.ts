/**
 * Room — AGREGADO de sesión del backend (server-authoritative). Modela lo que el
 * cliente NO predice: fase de ronda (Lobby→Prep→Hunt), roster, temporizadores,
 * regla de silbidos, condición de victoria.
 *
 * Distinto de `WorldState` de `@mecha/sim` (estado de movimiento/física compartido
 * y predicho). Ver packages/sim/README.md para la separación "sim compartida" vs
 * "reglas server-only". Skill `hexagonal-vertical-slicing`.
 *
 * SCAFFOLD del Paso 1 — invariantes y transiciones de fase en el Paso 2.
 */
import type { GamePhase } from '@shared/protocol';
import type { Player } from './Player';

export class Room {
  readonly id: string;
  phase: GamePhase = 'lobby';
  whistling = false; // regla opcional del host (pista sonora a los Seekers)
  prepEndsAtTick = 0;
  huntEndsAtTick = 0;
  readonly players = new Map<string, Player>();

  constructor(id: string) {
    this.id = id;
  }

  // TODO(Paso 2): startPrep(), startHunt(), onSeekerCatch(hiderId) -> convierte a
  // Seeker, checkWinCondition() -> Hiders ganan si sobrevive >=1 al acabar el tiempo.
}
