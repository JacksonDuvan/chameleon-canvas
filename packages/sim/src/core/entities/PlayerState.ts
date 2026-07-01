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
  aimX: number; // dirección de apunte normalizada (del último input)
  aimZ: number;
  readonly color: ColorRGBA; // color absorbido (camuflaje)
  frozen: boolean; // pose congelada (Hider) / congelado en Hunt
  caught: boolean; // un Hider atrapado pasa a Seeker y queda marcado
  colorLockedUntil: number; // tick hasta el que no puede recambiar color
  lastProcessedInput: number; // seq del último input consumido (reconciliación)
  // ── Camuflaje/detección (P0.2/P0.3), autoritativo del servidor ──
  camoScore: number; // 0..1 cuán camuflado está este Hider (viaja en el snapshot)
  beingWatched: boolean; // un Seeker está fijando la mira sobre él AHORA (feedback; viaja en el snapshot)
  lockTargetId: string; // (solo servidor) objetivo que este Seeker está fijando
  lockTicks: number; // (solo servidor) ticks de fijación acumulados sobre lockTargetId
  wantsCatch: boolean; // (solo servidor, transitorio) mantuvo el gatillo este tick

  constructor(id: string, role: PlayerRole = 'hider') {
    this.id = id;
    this.role = role;
    this.pos = new Vec3();
    this.vel = new Vec3();
    this.aimX = 0;
    this.aimZ = 1;
    this.color = new ColorRGBA(255, 255, 255); // camaleón "blanco puro" (biblia de diseño)
    this.frozen = false;
    this.caught = false;
    this.colorLockedUntil = 0;
    this.lastProcessedInput = 0;
    this.camoScore = 0;
    this.beingWatched = false;
    this.lockTargetId = '';
    this.lockTicks = 0;
    this.wantsCatch = false;
  }
}
