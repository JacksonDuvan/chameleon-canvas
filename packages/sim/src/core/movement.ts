/**
 * Movimiento y apunte DETERMINISTAS, compartidos por servidor y cliente.
 *
 * Es la pieza clave de la PARIDAD servidor-cliente (skill `authoritative-netcode`):
 * el servidor las llama dentro de `step()` (autoritativo) y el cliente las llama en
 * su predicción local con EXACTAMENTE el mismo código ⇒ la predicción converge sin
 * rubber-banding. Sin asignaciones (scratch de módulo). Skill `workers-memory-optimization`.
 *
 * V1: el apunte es 3D (incluye pitch del ratón para el disparo del Seeker); el
 * movimiento sigue siendo horizontal (XZ) y COLISIONA contra los sólidos del mapa
 * (props/muros) — no se atraviesan (V1-A).
 */
import type { PlayerState } from './entities/PlayerState';
import type { SimConfig } from './config';
import type { GamePhase, UserCommand } from '@shared/protocol';
import { clampToBoundsMut, resolveCircleAABBMut } from './collision';
import { DEFAULT_MAP, isSolidZone, type MapData } from './map/MapData';
import { Vec3 } from './value-objects/Vec3';

const _dir = new Vec3();
const _aim = new Vec3();

/** ¿Puede moverse este jugador en la fase actual? (reglas de Meccha Chameleon). */
export function canMove(phase: GamePhase, p: PlayerState): boolean {
  if (p.frozen) return false;
  if (phase === 'prep') return p.role === 'hider'; // Hiders se mueven; Seekers esperan a ciegas
  if (phase === 'hunt') return p.role === 'seeker'; // Seekers cazan; Hiders congelados
  return false; // lobby / ended
}

/**
 * Normaliza y guarda el apunte 3D del comando en el jugador. El servidor NO confía en
 * que el cliente normalice (autoritativo); el cliente normaliza igual en su predicción.
 * Conserva el apunte anterior si el comando trae un vector cero.
 */
export function applyAim(p: PlayerState, cmd: UserCommand): void {
  _aim.setMut(cmd.aimX, cmd.aimY, cmd.aimZ);
  if (_aim.lengthSq() > 0) {
    _aim.normalizeMut();
    p.aimX = _aim.x;
    p.aimY = _aim.y;
    p.aimZ = _aim.z;
  }
}

/**
 * Integra el movimiento de un jugador por `dt`: clamp de velocidad, colisión contra
 * los sólidos del mapa (no atravesar props/muros) y clamp a los límites del escenario.
 */
export function applyMovement(
  p: PlayerState,
  cmd: UserCommand,
  cfg: SimConfig,
  dt: number,
  map: MapData = DEFAULT_MAP,
): void {
  _dir.setMut(cmd.moveX, 0, cmd.moveZ);
  const len = _dir.length();
  if (len > 1) _dir.scaleMut(1 / len); // clamp de la intención a magnitud 1 (anti-trampas)
  _dir.scaleMut(cfg.maxSpeed); // velocidad máxima autoritativa
  p.vel.copyFromMut(_dir);
  p.pos.addScaledMut(p.vel, dt); // pos += vel * dt
  // Colisión contra sólidos (V1-A): expulsa el círculo del jugador de cada AABB.
  // Orden fijo (el del array del mapa) ⇒ determinista en ambos lados.
  const zones = map.zones;
  for (let i = 0; i < zones.length; i++) {
    const z = zones[i]!;
    if (isSolidZone(z)) {
      resolveCircleAABBMut(p.pos, cfg.playerRadius, z.minX, z.minZ, z.maxX, z.maxZ);
    }
  }
  clampToBoundsMut(p.pos, cfg.bounds); // clamp a los límites del escenario
}