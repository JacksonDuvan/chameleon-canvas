/**
 * Poses del Hider — estado enumerado COMPARTIDO (viaja en el wire como 4 bits, v7).
 *
 * La pose rompe la silueta humana (biblia `mecha-chameleon-gamedesign`: "los Seekers
 * reconocen formas humanas antes que fallos de color"). Su efecto de juego es doble:
 *  1. PERCEPTUAL (el grueso): el Seeker humano no reconoce una "caja" verde entre
 *     cajas verdes. No es un check del sistema.
 *  2. MECÁNICO (hitbox): cada pose baja/encoge la esfera de impacto del raycast de
 *     captura → agacharse/hacerse caja TRAS cobertura baja te cubre de verdad (el rayo,
 *     con pitch, lo bloquea el obstáculo). Ver `KinematicPhysicsWorld.syncBodies`.
 *
 * V1-G v3 (feedback del playtest "convertirme en cualquier figura del escenario"):
 * además de las poses humanas, el Hider puede MIMETIZAR objetos del mapa — CAJA (como
 * las cajas), BARRIL (como los barriles/cilindros). La bola y la estatua ya existían
 * (BALL ≡ esferas decorativas; STAND ≡ estatuas `figure`).
 *
 * Números planos (no enum de TS) por `verbatimModuleSyntax` y por el wire.
 */

export const POSE_STAND = 0;
export const POSE_CROUCH = 1;
export const POSE_BALL = 2;
export const POSE_FLAT = 3; // plano contra la pared (wall-flat)
export const POSE_BOX = 4; // mimetiza una caja del escenario
export const POSE_CYLINDER = 5; // mimetiza un barril/cilindro
// Playtest r6 ("convertirme en TODAS las figuras del mapa"): muebles de oficina.
// Mismas medidas que `FURNITURE_SPECS` (MapData) — el cliente los dibuja con ellas.
export const POSE_CABINET = 6; // archivador
export const POSE_DESK = 7; // mesa
export const POSE_TERMINAL = 8; // terminal-kiosco
export const POSE_STOOL = 9; // taburete
export const POSE_COUNT = 10;

/** Centro vertical de la esfera de impacto por pose (offset desde pos.y del suelo). */
export const POSE_BODY_CY: readonly number[] = [
  1.1, 0.55, 0.55, 0.85, 0.55, 0.7,
  1.25, 0.37, 0.8, 0.45, // archivador, mesa, terminal, taburete
];
/** Radio de la esfera de impacto por pose. */
export const POSE_BODY_R: readonly number[] = [
  0.7, 0.55, 0.55, 0.6, 0.62, 0.6,
  // La mesa es baja y alargada (1.6 m): su esfera cubre el CENTRO, no las puntas —
  // una esfera que abarcase todo el largo daría hit en el aire por encima del tablero.
  0.8, 0.47, 0.6, 0.45,
];

/** Sanea una pose que llega del cliente (anti-cheat: siempre una pose válida). */
export function clampPose(pose: number): number {
  const p = pose & 0xff;
  return p < POSE_COUNT ? p : 0;
}
