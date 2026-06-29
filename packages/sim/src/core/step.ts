/**
 * `step` — UN tick determinista de la simulación. Corazón compartido del netcode:
 * lo ejecuta el servidor (autoritativo, `ProcessTick`) y lo re-ejecuta el cliente
 * (predicción) con EL MISMO código y los mismos `dt`/semilla.
 *
 * Responsabilidades del MVP (Step 2): aplicar inputs (movimiento con clamp
 * anti-trampas), reglas por fase, "disparo" del Seeker que registra impacto por
 * raycast (vía el puerto), y la transición temporizada de fase.
 *
 * Skills: `authoritative-netcode` (servidor autoritativo, timestep fijo, input =
 * intención) + `workers-memory-optimization` (muta el estado, scratch de módulo,
 * `for` indexado, sin asignaciones por-tick) + `hexagonal-vertical-slicing` (puro;
 * la física entra por el puerto `IPhysicsWorld`).
 *
 * El mundo se MUTA in situ (no se devuelve uno nuevo).
 */
import type { WorldState } from './entities/WorldState';
import type { PlayerState } from './entities/PlayerState';
import type { SimConfig } from './config';
import type { Rng } from './rng';
import type { IPhysicsWorld } from '../physics/IPhysicsWorld';
import { clampToBoundsMut } from './collision';
import { advancePhaseIfDue } from './phases';
import { ActionKind, type GamePhase, type UserCommand } from '@shared/protocol';
import { Vec3 } from './value-objects/Vec3';

// Scratch de ámbito de módulo: `step` es síncrono de principio a fin en un isolate
// monohilo, así que reutilizar estos vectores entre ticks (y entre salas del mismo
// isolate) es seguro y evita asignar por jugador/tick.
const _dir = new Vec3();
const _aim = new Vec3();

/** ¿Puede moverse este jugador en la fase actual? (reglas de Meccha Chameleon). */
function canMove(phase: GamePhase, p: PlayerState): boolean {
  if (p.frozen) return false;
  if (phase === 'prep') return p.role === 'hider'; // Hiders se mueven; Seekers esperan a ciegas
  if (phase === 'hunt') return p.role === 'seeker'; // Seekers cazan; Hiders congelados
  return false; // lobby / ended
}

function applyMovement(p: PlayerState, cmd: UserCommand, cfg: SimConfig, dt: number): void {
  _dir.setMut(cmd.moveX, 0, cmd.moveZ);
  const len = _dir.length();
  if (len > 1) _dir.scaleMut(1 / len); // clamp de la intención a magnitud 1 (anti-trampas)
  _dir.scaleMut(cfg.maxSpeed); // velocidad máxima autoritativa
  p.vel.copyFromMut(_dir);
  p.pos.addScaledMut(p.vel, dt); // pos += vel * dt
  clampToBoundsMut(p.pos, cfg.bounds); // clamp a los límites del escenario
}

export function step(
  world: WorldState,
  commands: readonly UserCommand[],
  dt: number,
  _rng: Rng,
  physics: IPhysicsWorld,
): void {
  world.tick++;
  const cfg = world.config;

  // ── Pase 1: aplicar inputs (movimiento + acciones que no son raycast) ──
  let anyCatch = false;
  for (let i = 0; i < commands.length; i++) {
    const cmd = commands[i];
    if (!cmd) continue;
    const p = world.players.get(cmd.playerId);
    if (!p) continue;

    p.lastProcessedInput = cmd.seq; // estampa para la reconciliación del cliente
    // El servidor es autoritativo: NO confía en que el cliente normalice el apunte.
    // Re-normaliza aquí (raySphere asume dirección unitaria). Conserva el apunte
    // anterior si el cliente envía un vector cero.
    _aim.setMut(cmd.aimX, 0, cmd.aimZ);
    if (_aim.lengthSq() > 0) {
      _aim.normalizeMut();
      p.aimX = _aim.x;
      p.aimZ = _aim.z;
    }

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
