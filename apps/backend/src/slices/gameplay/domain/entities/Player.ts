/**
 * Player — agregado de jugador del lado backend (rol, estado de sesión, marcador).
 * Complementa al `PlayerState` cinemático de `@mecha/sim` (posición/color predichos).
 *
 * SCAFFOLD del Paso 1 — Paso 2.
 */
import type { PlayerRole } from '@shared/protocol';

export class Player {
  readonly id: string;
  role: PlayerRole = 'hider';
  caught = false; // un Hider atrapado pasa a Seeker (role) y queda marcado
  colorLockedUntil = 0; // tick; bloqueo tras absorber color (anti-spam)

  constructor(id: string, role: PlayerRole = 'hider') {
    this.id = id;
    this.role = role;
  }
}
