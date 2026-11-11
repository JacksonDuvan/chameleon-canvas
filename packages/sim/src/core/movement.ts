/**
 * Movimiento y apunte DETERMINISTAS, compartidos por servidor y cliente.
 *
 * Es la pieza clave de la PARIDAD servidor-cliente (skill `authoritative-netcode`):
 * el servidor las llama dentro de `step()` (autoritativo) y el cliente las llama en
 * su predicción local con EXACTAMENTE el mismo código ⇒ la predicción converge sin
 * rubber-banding. Sin asignaciones (scratch de módulo). Skill `workers-memory-optimization`.
 *
 * V1: el apunte es 3D (incluye pitch del ratón para el disparo del Seeker); el
 * movimiento horizontal (XZ) COLISIONA contra los sólidos del mapa (props/muros) —
 * no se atraviesan (V1-A). Playtest r6: eje vertical con SALTO (`applyVertical`) y
 * muebles pisables.
 */
import type { PlayerState } from './entities/PlayerState';
import type { SimConfig } from './config';
import type { GamePhase, UserCommand } from '@shared/protocol';
import { clampToBoundsMut, resolveCircleAABBMut } from './collision';
import { DEFAULT_MAP, isSolidZone, zoneYMax, type MapData, type MapZone } from './map/MapData';
import { Vec3 } from './value-objects/Vec3';

const _dir = new Vec3();
const _aim = new Vec3();

/** Tolerancia (m) para considerar que los pies están "a la altura" de un tope. */
const STAND_EPS = 0.02;
/** Margen (m) alrededor del AABB de un mueble dentro del cual el centro del jugador
 *  sigue apoyado en él (pisas el borde sin caerte al primer milímetro). */
const STAND_MARGIN = 0.15;

/**
 * ¿Se puede PISAR esta zona? Solo los props (muebles, cajas, barriles…): saltar
 * encima de una mesa y posar ahí es parte del escondite. Los MUROS nunca: ni el
 * salto alto del Seeker permite cruzar la casa por encima de las paredes.
 */
export function isStandable(z: MapZone): boolean {
  return z.kind === 'prop';
}

/**
 * Altura del apoyo bajo (x,z): el tope más alto de un prop pisable que contiene al
 * jugador y que NO está por encima de sus pies (`feetY`); 0 = suelo. Determinista
 * (orden del array), sin asignaciones.
 */
export function groundHeightAt(map: MapData, x: number, z: number, feetY: number): number {
  let ground = 0;
  const zones = map.zones;
  for (let i = 0; i < zones.length; i++) {
    const zn = zones[i]!;
    if (!isStandable(zn)) continue;
    const top = zoneYMax(zn);
    if (top <= ground || top > feetY + STAND_EPS) continue;
    if (
      x >= zn.minX - STAND_MARGIN &&
      x <= zn.maxX + STAND_MARGIN &&
      z >= zn.minZ - STAND_MARGIN &&
      z <= zn.maxZ + STAND_MARGIN
    ) {
      ground = top;
    }
  }
  return ground;
}

/**
 * Eje VERTICAL de un jugador por `dt`: salto (si está apoyado y `wantsJump`),
 * gravedad y aterrizaje en el suelo o sobre un mueble. Se llama SIEMPRE, pueda o no
 * moverse (un Hider congelado en el aire al empezar la caza tiene que caer);
 * `wantsJump` ya viene filtrado por `canMove`. Servidor y cliente la ejecutan una
 * vez por comando ⇒ la predicción converge. Sin asignaciones.
 */
export function applyVertical(
  p: PlayerState,
  wantsJump: boolean,
  cfg: SimConfig,
  dt: number,
  map: MapData = DEFAULT_MAP,
): void {
  if (wantsJump && p.grounded) {
    p.vy = p.role === 'seeker' ? cfg.seekerJumpSpeed : cfg.jumpSpeed;
    p.grounded = false;
  }
  const prevY = p.pos.y;
  p.vy -= cfg.gravity * dt;
  p.pos.y += p.vy * dt;
  // Apoyo: topes que estaban A LA ALTURA de los pies o por debajo antes de integrar
  // (no se "atraviesa hacia arriba" un mueble).
  const ground = groundHeightAt(map, p.pos.x, p.pos.z, prevY);
  if (p.pos.y <= ground) {
    p.pos.y = ground;
    p.vy = 0;
    p.grounded = true;
  } else {
    p.grounded = false;
    if (p.pos.y > cfg.bounds.maxY) {
      p.pos.y = cfg.bounds.maxY; // techo del escenario
      if (p.vy > 0) p.vy = 0;
    }
  }
}

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
  const y = p.pos.y; // el eje vertical lo integra `applyVertical` (no este paso)
  p.pos.addScaledMut(p.vel, dt); // pos += vel * dt
  // Colisión contra sólidos (V1-A): expulsa el círculo del jugador de cada AABB.
  // Orden fijo (el del array del mapa) ⇒ determinista en ambos lados.
  const zones = map.zones;
  for (let i = 0; i < zones.length; i++) {
    const z = zones[i]!;
    if (!isSolidZone(z)) continue;
    // Con los pies a la altura del tope (o por encima) de un mueble pisable, este
    // deja de ser una pared: se camina SOBRE él (salto, playtest r6).
    if (isStandable(z) && y >= zoneYMax(z) - STAND_EPS) continue;
    resolveCircleAABBMut(p.pos, cfg.playerRadius, z.minX, z.minZ, z.maxX, z.maxZ);
  }
  clampToBoundsMut(p.pos, cfg.bounds); // clamp a los límites del escenario
  p.pos.y = y;
}