/**
 * avatarGeometry — silueta de CAMALEÓN low-poly por pose (V1-G), construida con
 * primitivas de three fusionadas en UNA BufferGeometry por pose (docs/09 §5: estilo
 * low-poly sin Blender). Al ser una sola geometría, `Players` sigue dibujando TODOS
 * los avatares con un `InstancedMesh` por pose (máx. 4 draw calls, como antes).
 *
 * Contratos (verificados por avatarGeometry.test.ts):
 *  - Pies en y=0: el render coloca el avatar en el y del suelo, sin offsets por pose.
 *  - Mira a +Z local (el render orienta con rotation.y = atan2(aimX, aimZ)).
 *  - Honesta con la esfera de impacto del server (`POSE_BODY_CY/R`): la cubre (nada
 *    de "aire que da hit") y solo la desborda el fleco cosmético (hocico/cola/patas).
 *  - La pose "bola" es una esfera con la MISMA teselación que las bolas decorativas
 *    del mapa (mimetismo de objeto: fundirse junto a ellas, biblia de gamedesign).
 *
 * Construcción una sola vez al montar (no es camino caliente); el color por instancia
 * tiñe el cuerpo entero (el camaleón se pinta uniforme: pintura por color de V1).
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { POSE_COUNT } from '@mecha/sim';

/** Desborde máximo (m) de la silueta visual respecto al hitbox del server. */
export const VISUAL_FRINGE = 0.12;

/** Teselación compartida con las esferas decorativas del mapa (pose bola ≡ bola). */
export const LOWPOLY_SPHERE_W = 12;
export const LOWPOLY_SPHERE_H = 8;

/** Fusiona partes en una geometría (y libera las intermedias). */
function fuse(parts: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const merged = mergeGeometries(parts, false);
  if (!merged) throw new Error('avatarGeometry: fusión de primitivas fallida');
  for (const p of parts) p.dispose();
  return merged;
}

function sphere(r: number, x: number, y: number, z: number): THREE.BufferGeometry {
  return new THREE.SphereGeometry(r, LOWPOLY_SPHERE_W, LOWPOLY_SPHERE_H).translate(x, y, z);
}

/** Hocico: cono corto apuntando a +Z. */
function snout(r: number, len: number, x: number, y: number, z: number): THREE.BufferGeometry {
  return new THREE.ConeGeometry(r, len, 6).rotateX(Math.PI / 2).translate(x, y, z);
}

/** Cola en espiral (arco de toro en el plano YZ, tras el cuerpo). */
function tail(radius: number, tube: number, y: number, z: number): THREE.BufferGeometry {
  return new THREE.TorusGeometry(radius, tube, 6, 10, Math.PI * 1.5)
    .rotateY(Math.PI / 2)
    .translate(0, y, z);
}

function leg(r: number, h: number, x: number, y: number, z: number): THREE.BufferGeometry {
  return new THREE.CylinderGeometry(r, r * 1.15, h, 6).translate(x, y, z);
}

/** De pie (~1.7 m): bípedo inclinado hacia delante, cabeza CLARAMENTE separada del
 *  torso (con hocico y ojos-torreta) y cola en espiral que asoma por detrás. */
function buildStand(): THREE.BufferGeometry {
  return fuse([
    leg(0.09, 0.38, -0.16, 0.19, 0),
    leg(0.09, 0.38, 0.16, 0.19, 0),
    new THREE.CapsuleGeometry(0.3, 0.5, 4, 10).rotateX(0.35).translate(0, 0.88, 0.02),
    sphere(0.22, 0, 1.46, 0.34), // cabeza adelantada (no embebida en el torso)
    sphere(0.1, -0.18, 1.54, 0.34), // ojo izq (torreta)
    sphere(0.1, 0.18, 1.54, 0.34), // ojo der
    snout(0.1, 0.26, 0, 1.44, 0.58),
    tail(0.2, 0.06, 0.5, -0.48),
  ]);
}

/** Agachado (~1.1 m, la altura que espera el hitbox): a cuatro patas, pecho alzado. */
function buildCrouch(): THREE.BufferGeometry {
  return fuse([
    leg(0.07, 0.28, -0.2, 0.14, 0.18),
    leg(0.07, 0.28, 0.2, 0.14, 0.18),
    leg(0.07, 0.28, -0.2, 0.14, -0.24),
    leg(0.07, 0.28, 0.2, 0.14, -0.24),
    // Cuerpo tumbado hacia delante, grupa baja y pecho alto (rotación en X).
    new THREE.CapsuleGeometry(0.3, 0.38, 4, 10).rotateX(Math.PI / 2 - 0.55).translate(0, 0.55, -0.04),
    sphere(0.19, 0, 0.92, 0.26), // cabeza alzada
    sphere(0.08, -0.15, 0.97, 0.28),
    sphere(0.08, 0.15, 0.97, 0.28),
    snout(0.08, 0.18, 0, 0.9, 0.47),
    tail(0.13, 0.05, 0.32, -0.45),
  ]);
}

/** Bola: esfera pura con la teselación de las bolas decorativas (nada la delata). */
function buildBall(): THREE.BufferGeometry {
  return fuse([sphere(0.55, 0, 0.55, 0)]);
}

/** Plano contra la pared: panel fino (la versión lite del wall-flat del original). */
function buildFlat(): THREE.BufferGeometry {
  return fuse([new THREE.BoxGeometry(0.9, 1.4, 0.24).translate(0, 0.78, 0)]);
}

/** Una geometría fusionada por pose, indexada por el valor de pose del sim (0..3). */
export function buildPoseGeometries(): THREE.BufferGeometry[] {
  const out = [buildStand(), buildCrouch(), buildBall(), buildFlat()];
  if (out.length !== POSE_COUNT) throw new Error('avatarGeometry: falta una pose');
  return out;
}
