/**
 * `step` — UN tick determinista de la simulación. Corazón compartido del netcode:
 * lo ejecuta el servidor (autoritativo, `ProcessTick`) y reutiliza las MISMAS
 * funciones de movimiento (`@sim/core/movement`) que el cliente usa para predecir.
 *
 * Responsabilidades: aplicar inputs (apunte 3D + movimiento con colisión + pose),
 * score de CAMUFLAJE por Hider (P0.2, feedback), DISPAROS del Seeker (modelo del
 * original: tag por impacto instantáneo, munición limitada, cooldown; el rayo lo
 * bloquean los sólidos del mapa y usa el hitbox por pose del objetivo) y la
 * transición temporizada de fase.
 *
 * Skills: `authoritative-netcode` (servidor autoritativo, timestep fijo, input =
 * intención; nunca "acerté" del cliente) + `workers-memory-optimization` (muta el
 * estado, sin asignaciones por-tick; `_refColor` es scratch de módulo) +
 * `hexagonal-vertical-slicing` (puro; la física entra por el puerto; el mapa como dato).
 *
 * El mundo se MUTA in situ (no se devuelve uno nuevo).
 */
import type { WorldState } from './entities/WorldState';
import type { Rng } from './rng';
import type { IPhysicsWorld } from '../physics/IPhysicsWorld';
import { advancePhaseIfDue, anyHiderAlive } from './phases';
import { applyAim, applyMovement, canMove } from './movement';
import { computeCamouflage } from './camouflage';
import { DEFAULT_MAP, referenceColorAt, type MapData } from './map/MapData';
import { clampPose } from './pose';
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

  // ── Reset transitorio del tick ──
  // La velocidad se pone a 0 aquí para que represente "lo movido ESTE tick": si un
  // jugador no manda comando (p. ej. pérdida de paquete), `applyMovement` no corre y su
  // `vel` no debe arrastrar la del tick anterior, o el camuflaje lo penalizaría por
  // "moverse" cuando está quieto. Los que sí mueven la re-establecen en `applyMovement`.
  for (const p of world.players.values()) {
    p.vel.setMut(0, 0, 0);
  }

  // ── Pase 1: aplicar inputs (apunte + movimiento + pose) ──
  let anyShot = false;
  for (let i = 0; i < commands.length; i++) {
    const cmd = commands[i];
    if (!cmd) continue;
    const p = world.players.get(cmd.playerId);
    if (!p) continue;

    p.lastProcessedInput = cmd.seq; // estampa para la reconciliación del cliente
    applyAim(p, cmd); // re-normaliza el apunte 3D (mismas funciones que la predicción)
    if (canMove(world.phase, p)) applyMovement(p, cmd, cfg, dt, map);

    // Pose (V1-B): solo el Hider, en Prep y sin congelar (en Hunt queda fija).
    // `clampPose` sanea el valor del cliente (anti-cheat). El cliente la predice con
    // esta MISMA regla (prediction.ts) para que la reconciliación converja.
    if (p.role === 'hider' && !p.frozen && world.phase === 'prep') {
      p.pose = clampPose(cmd.pose);
    }

    if (cmd.action === ActionKind.CATCH && p.role === 'seeker' && world.phase === 'hunt') {
      anyShot = true; // resuelto en el pase 3 (tras integrar el movimiento de todos)
    }
  }

  // ── Pase 2: camuflaje (P0.2, feedback del Hider). Tras integrar el movimiento, cada
  //    Hider tiene un score determinista según cuánto encaja su color con el entorno y
  //    si está quieto. NO modula la captura (percepción, como el original). ──
  for (const p of world.players.values()) {
    if (p.role !== 'hider') {
      p.camoScore = 0;
      continue;
    }
    referenceColorAt(map, p.pos.x, p.pos.z, _refColor);
    const speed = p.frozen ? 0 : Math.sqrt(p.vel.lengthSq());
    p.camoScore = computeCamouflage(p.color, _refColor, speed, cfg);
  }

  // ── Pase 3: DISPAROS (modelo del original). Cada CATCH es un disparo instantáneo
  //    con cooldown; el impacto lo resuelve el raycast del servidor — bloqueado por
  //    los sólidos del mapa (oclusión) y contra el hitbox por pose del objetivo.
  //    Acertar a un Hider = tag (pasa a Seeker). El camuflaje engaña al OJO, no al rayo.
  //    Munición: ILIMITADA por defecto (juego base). Con `ammoLimitEnabled` (modo del
  //    update 2.3.0 del original): fallar cuesta 1, acertar es GRATIS, y si todos los
  //    Seekers llegan a 0 los Hiders ganan al instante. ──
  if (anyShot) {
    physics.syncBodies(world); // refleja las posiciones ya integradas
    for (let i = 0; i < commands.length; i++) {
      const cmd = commands[i];
      if (!cmd || cmd.action !== ActionKind.CATCH) continue;
      const seeker = world.players.get(cmd.playerId);
      if (!seeker || seeker.role !== 'seeker' || world.phase !== 'hunt') continue;
      if (world.tick < seeker.shotCooldownUntil) continue;
      if (cfg.ammoLimitEnabled && seeker.ammo <= 0) continue;

      seeker.shotCooldownUntil = world.tick + cfg.shotCooldownTicks;

      const oy = seeker.pos.y + cfg.eyeHeight;
      const hit = physics.raycastClosest(
        seeker.pos.x,
        oy,
        seeker.pos.z,
        seeker.aimX,
        seeker.aimY,
        seeker.aimZ,
        cfg.catchRange,
        seeker.id,
      );
      const target = hit ? world.players.get(hit.playerId) : undefined;
      if (target && target.role === 'hider' && !target.caught) {
        // ACIERTO (gratis en el modo limitado): el Hider pasa a Seeker (infección).
        target.caught = true;
        target.role = 'seeker';
        target.frozen = false;
        target.ammo = cfg.shotAmmo;
        target.shotCooldownUntil = world.tick + cfg.shotCooldownTicks;
      } else if (cfg.ammoLimitEnabled) {
        seeker.ammo--; // FALLO: cuesta una bala (solo en modo limitado)
      }
    }

    // Modo limitado: si NINGÚN Seeker conserva munición, los Hiders ganan al instante.
    if (cfg.ammoLimitEnabled && world.phase === 'hunt') {
      let anyAmmo = false;
      for (const p of world.players.values()) {
        if (p.role === 'seeker' && p.ammo > 0) {
          anyAmmo = true;
          break;
        }
      }
      if (!anyAmmo) {
        world.phase = 'ended';
        world.phaseEndsAtTick = 0;
        world.outcome = anyHiderAlive(world) ? 'hiders' : 'seekers';
      }
    }
  }

  // ── Transición temporizada de fase (Prep→Hunt→Ended) ──
  advancePhaseIfDue(world);
}
