/**
 * Estado cinemático de un jugador EN LA SIMULACIÓN compartida (lo que el cliente
 * predice). Forma monomórfica: TODOS los campos se inicializan en el constructor,
 * en orden fijo (hidden class estable). Skill `workers-memory-optimization`.
 *
 * Distinto del agregado `Player` del backend (rol de sesión, marcador) — ver
 * apps/backend/.../domain/entities/Player.ts.
 */
import { Vec3 } from '../value-objects/Vec3';
import { ColorRGBA } from '../value-objects/ColorRGBA';
import type { PlayerRole } from '@shared/protocol';

export class PlayerState {
  id: string;
  role: PlayerRole;
  readonly pos: Vec3;
  readonly vel: Vec3;
  aimX: number; // dirección de apunte normalizada 3D (del último input)
  aimY: number; // componente vertical del apunte (pitch del ratón; V1-C)
  aimZ: number;
  pose: number; // pose del Hider 0..3 (POSE_*; rompe la silueta; V1-B)
  readonly color: ColorRGBA; // color absorbido (camuflaje)
  frozen: boolean; // pose congelada (Hider) / congelado en Hunt
  caught: boolean; // un Hider atrapado pasa a Seeker y queda marcado
  colorLockedUntil: number; // tick hasta el que no puede recambiar color
  lastProcessedInput: number; // seq del último input consumido (reconciliación)
  // ── Camuflaje (P0.2) + economía de disparos, autoritativos del servidor ──
  camoScore: number; // 0..1 cuán camuflado está este Hider (viaja en el snapshot)
  ammo: number; // disparos restantes del Seeker (limitados; viaja en el snapshot)
  shotCooldownUntil: number; // (solo servidor) tick hasta el que no puede volver a disparar

  constructor(id: string, role: PlayerRole = 'hider') {
    this.id = id;
    this.role = role;
    this.pos = new Vec3();
    this.vel = new Vec3();
    this.aimX = 0;
    this.aimY = 0;
    this.aimZ = 1;
    this.pose = 0;
    this.color = new ColorRGBA(255, 255, 255); // camaleón "blanco puro" (biblia de diseño)
    this.frozen = false;
    this.caught = false;
    this.colorLockedUntil = 0;
    this.lastProcessedInput = 0;
    this.camoScore = 0;
    this.ammo = 0;
    this.shotCooldownUntil = 0;
  }
}
