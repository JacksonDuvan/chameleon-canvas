/**
 * Poses del Hider (V1-B) — estado enumerado COMPARTIDO (viaja en el wire como 2 bits).
 *
 * La pose rompe la silueta humana (biblia `mecha-chameleon-gamedesign`: "los Seekers
 * reconocen formas humanas antes que fallos de color"). Su efecto de juego es doble:
 *  1. PERCEPTUAL (el grueso): el Seeker humano no reconoce una "bola" verde entre
 *     cajas verdes. No es un check del sistema.
 *  2. MECÁNICO (hitbox): cada pose baja/encoge la esfera de impacto del raycast de
 *     captura → agacharse TRAS una caja baja te cubre de verdad (el rayo, ahora con
 *     pitch, lo bloquea el obstáculo). Ver `KinematicPhysicsWorld.syncBodies`.
 *
 * Números planos (no enum de TS) por `verbatimModuleSyntax` y por el wire (u8 & 3).
 */

export const POSE_STAND = 0;
export const POSE_CROUCH = 1;
export const POSE_BALL = 2;
export const POSE_FLAT = 3; // plano contra la pared (wall-flat)
export const POSE_COUNT = 4;

/** Centro vertical de la esfera de impacto por pose (offset desde pos.y del suelo). */
export const POSE_BODY_CY: readonly number[] = [1.1, 0.55, 0.55, 0.85];
/** Radio de la esfera de impacto por pose. */
export const POSE_BODY_R: readonly number[] = [0.7, 0.55, 0.55, 0.6];

/** Sanea una pose que llega del cliente (anti-cheat: siempre 0..3). */
export function clampPose(pose: number): number {
  return pose & 3;
}
