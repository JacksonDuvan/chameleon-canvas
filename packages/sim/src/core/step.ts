/**
 * `step` — UN tick determinista de la simulación. Corazón compartido del netcode:
 * lo ejecuta el servidor (autoritativo, `ProcessTick`) y reutiliza las MISMAS
 * funciones de movimiento (`@sim/core/movement`) que el cliente usa para predecir.
 *
 * Responsabilidades del MVP: aplicar inputs (apunte + movimiento con clamp), reglas
 * por fase, "disparo" del Seeker que registra impacto por raycast (vía el puerto), y
 * la transición temporizada de fase.
 *
 * Skills: `authoritative-netcode` (servidor autoritativo, timestep fijo, input =
 * intención) + `workers-memory-optimization` (muta el estado, sin asignaciones
 * por-tick) + `hexagonal-vertical-slicing` (puro; la física entra por el puerto).
 *
 * El mundo se MUTA in situ (no se devuelve uno nuevo).
 */
import type { WorldState } from './entities/WorldState';
import type { Rng } from './rng';
import type { IPhysicsWorld } from '../physics/IPhysicsWorld';
import { advancePhaseIfDue } from './phases';
import { applyAim, applyMovement, canMove } from './movement';
import { ActionKind, type UserCommand } from '@shared/protocol';

export function step(
  world: WorldState,
  commands: readonly UserCommand[],
  dt: number,
  _rng: Rng,
  physics: IPhysicsWorld,
): void {
  world.tick++;
  const cfg = world.config;

  // ── Pase 1: aplicar inputs (apunte + movimiento + acciones que no son raycast) ──
  let anyCatch = false;
  for (let i = 0; i < commands.length; i++) {
    const cmd = commands[i];
    if (!cmd) continue;
    const p = world.players.get(cmd.playerId);
    if (!p) continue;

    p.lastProcessedInput = cmd.seq; // estampa para la reconciliación del cliente
    applyAim(p, cmd); // re-normaliza el apunte (mismas funciones que la predicción)
    if (canMove(world.phase, p)) applyMovement(p, cmd, cfg, dt);

    if (cmd.action === ActionKind.FREEZE && p.role === 'hider') {
      p.frozen = true; // el Hider congela su pose
    } else if (cmd.action === ActionKind.CATCH && p.role === 'seeker' && world.phase === 'hunt') {
      anyCatch = true; // resuelto en el pase 2 (tras mover a todos)
    }
  }

  // ── Pase 2: capturas por raycast (solo si alguien disparó este tick) ──
  if (anyCatch) {
    physics.syncBodies(world); // refleja las posiciones ya integradas
    for (let i = 0; i < commands.length; i++) {
      const cmd = commands[i];
      if (!cmd || cmd.action !== ActionKind.CATCH) continue;
      const seeker = world.players.get(cmd.playerId);
      if (!seeker || seeker.role !== 'seeker' || world.phase !== 'hunt') continue;

      const oy = seeker.pos.y + cfg.eyeHeight;
      // seeker.aimX/aimZ ya están normalizados (pase 1): cumplen el contrato de raySphere.
      const hit = physics.raycastClosest(
        seeker.pos.x,
        oy,
        seeker.pos.z,
        seeker.aimX,
        0, // disparo horizontal
        seeker.aimZ,
        cfg.catchRange,
        seeker.id,
      );
      if (!hit) continue;

      const target = world.players.get(hit.playerId);
      if (target && target.role === 'hider' && !target.caught) {
        // Un Hider atrapado pasa a Seeker para ayudar a buscar al resto.
        target.caught = true;
        target.role = 'seeker';
        target.frozen = false;
      }
    }
  }

  // ── Transición temporizada de fase (Prep→Hunt→Ended) ──
  advancePhaseIfDue(world);
}
