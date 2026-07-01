/**
 * `step` — UN tick determinista de la simulación. Corazón compartido del netcode:
 * lo ejecuta el servidor (autoritativo, `ProcessTick`) y reutiliza las MISMAS
 * funciones de movimiento (`@sim/core/movement`) que el cliente usa para predecir.
 *
 * Responsabilidades del MVP: aplicar inputs (apunte + movimiento con clamp), reglas
 * por fase, score de CAMUFLAJE por Hider (P0.2), CAPTURA POR FIJACIÓN del Seeker
 * (P0.3, modelo híbrido) y la transición temporizada de fase.
 *
 * Skills: `authoritative-netcode` (servidor autoritativo, timestep fijo, input =
 * intención) + `workers-memory-optimization` (muta el estado, sin asignaciones
 * por-tick; `_refColor` es scratch de módulo) + `hexagonal-vertical-slicing` (puro;
 * la física entra por el puerto; el mapa entra como dato).
 *
 * El mundo se MUTA in situ (no se devuelve uno nuevo).
 */
import type { WorldState } from './entities/WorldState';
import type { Rng } from './rng';
import type { IPhysicsWorld } from '../physics/IPhysicsWorld';
import { advancePhaseIfDue } from './phases';
import { applyAim, applyMovement, canMove } from './movement';
import { computeCamouflage, requiredFixationTicks } from './camouflage';
import { DEFAULT_MAP, referenceColorAt, type MapData } from './map/MapData';
import { ColorRGBA } from './value-objects/ColorRGBA';
import { ActionKind, type UserCommand } from '@shared/protocol';

// Scratch de módulo para el color de referencia del entorno (sin asignar por-tick).
const _refColor = new ColorRGBA();

export function step(
  world: WorldState,
  commands: readonly UserCommand[],
  dt: number,
  _rng: Rng,
  physics: IPhysicsWorld,
  map: MapData = DEFAULT_MAP,
): void {
  world.tick++;
  const cfg = world.config;

  // ── Reset de flags/intenciones transitorias del tick ──
  // La velocidad se pone a 0 aquí para que represente "lo movido ESTE tick": si un
  // jugador no manda comando (p. ej. pérdida de paquete), `applyMovement` no corre y su
  // `vel` no debe arrastrar la del tick anterior, o el camuflaje lo penalizaría por
  // "moverse" cuando está quieto. Los que sí mueven la re-establecen en `applyMovement`.
  for (const p of world.players.values()) {
    p.beingWatched = false;
    p.wantsCatch = false;
    p.vel.setMut(0, 0, 0);
  }

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
      p.wantsCatch = true; // mantiene el gatillo: la fijación se resuelve en el pase 3
      anyCatch = true;
    }
  }

  // ── Pase 2: camuflaje (P0.2). Tras integrar el movimiento, cada Hider tiene un score
  //    determinista según cuánto encaja su color con el entorno y si está quieto. ──
  for (const p of world.players.values()) {
    if (p.role !== 'hider') {
      p.camoScore = 0;
      continue;
    }
    referenceColorAt(map, p.pos.x, p.pos.z, _refColor);
    const speed = p.frozen ? 0 : Math.sqrt(p.vel.lengthSq());
    p.camoScore = computeCamouflage(p.color, _refColor, speed, cfg);
  }

  // ── Pase 3: captura por FIJACIÓN (P0.3, híbrido). El Seeker que mantiene el gatillo
  //    acumula ticks de mira sostenida sobre su objetivo; captura cuando alcanza la
  //    fijación requerida (mayor cuanto mejor camuflado está el objetivo). Nada pasivo:
  //    sin gatillo mantenido no pasa nada (no hay "detector" de Hiders).
  //    NOTA de diseño: la fijación NO exige que el Seeker se mueva — apuntar-y-sostener
  //    parado es válido y fiel (el original es "apunta y dispara"). El "barrer" de la
  //    biblia es ritmo de juego sugerido, no una regla del sistema. ──
  if (anyCatch && world.phase === 'hunt') {
    physics.syncBodies(world); // refleja las posiciones ya integradas
    for (const seeker of world.players.values()) {
      if (seeker.role !== 'seeker') continue;
      if (!seeker.wantsCatch) {
        // soltó el gatillo → se pierde la fijación
        seeker.lockTargetId = '';
        seeker.lockTicks = 0;
        continue;
      }
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
      const target = hit ? world.players.get(hit.playerId) : undefined;
      if (!target || target.role !== 'hider' || target.caught) {
        // apunta al vacío o a un no-Hider → se pierde la fijación
        seeker.lockTargetId = '';
        seeker.lockTicks = 0;
        continue;
      }
      // Acumula fijación sobre este objetivo (se reinicia si cambia de objetivo).
      if (seeker.lockTargetId === target.id) seeker.lockTicks++;
      else {
        seeker.lockTargetId = target.id;
        seeker.lockTicks = 1;
      }
      target.beingWatched = true; // feedback: el Hider siente que lo están fijando
      if (seeker.lockTicks >= requiredFixationTicks(target.camoScore, cfg)) {
        // Un Hider atrapado pasa a Seeker para ayudar a buscar al resto.
        target.caught = true;
        target.role = 'seeker';
        target.frozen = false;
        target.beingWatched = false;
        seeker.lockTargetId = '';
        seeker.lockTicks = 0;
      }
    }
  } else {
    // Ningún Seeker disparó este tick → todos sueltan su fijación.
    for (const p of world.players.values()) {
      if (p.role === 'seeker') {
        p.lockTargetId = '';
        p.lockTicks = 0;
      }
    }
  }

  // ── Transición temporizada de fase (Prep→Hunt→Ended) ──
  advancePhaseIfDue(world);
}
