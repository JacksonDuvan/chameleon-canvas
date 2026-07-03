/**
 * avatarGeometry — el MUÑECO liso del original (v2, post-playtest): cabeza esférica
 * sin cara + cuerpo blob + brazos/piernas redondeados, como las figuras de plastilina
 * del juego base. Cada pose se construye con primitivas de three FUSIONADAS en UNA
 * BufferGeometry (`Players` sigue dibujando todo con un `InstancedMesh` por pose:
 * máx. 4 draw calls).
 *
 * La MISMA geometría renderiza los SEÑUELOS del mapa (`MapZone.shape: 'figure'` usa
 * la pose de pie, `'figureWall'` la pose plana): un Hider pintado y posado junto a
 * un señuelo es geométricamente INDISTINGUIBLE — el pilar del mimetismo del original.
 *
 * Contratos (verificados por avatarGeometry.test.ts):
 *  - Pies en y=0: el render coloca el avatar en el y del suelo, sin offsets por pose.
 *  - Honesta con la esfera de impacto del server (`POSE_BODY_CY/R`): la cubre (nada
 *    de "aire que da hit") y solo la desborda el fleco cosmético (manos/rodillas).
 *  - El arrodillado mira a +Z local (el render orienta por el yaw); el de pie es
 *    simétrico (sin cara, fiel al original). La pose plano es DELGADA en Z.
 *  - La bola es casi esférica (se funde junto a las bolas decorativas del mapa).
 *
 * Suavizado LISO (no flat-shading): el muñeco del original es redondeado; el facetado
 * queda para la arquitectura del mapa. Construcción una sola vez al montar.
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { POSE_COUNT } from '@mecha/sim';

/** Desborde máximo (m) de la silueta visual respecto al hitbox del server. */
export const VISUAL_FRINGE = 0.12;

/** Teselación compartida con las esferas decorativas del mapa (pose bola ≡ bola). */
export const SPHERE_SEGS_W = 16;
export const SPHERE_SEGS_H = 12;

/** Fusiona partes en una geometría (y libera las intermedias). */
function fuse(parts: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const merged = mergeGeometries(parts, false);
  if (!merged) throw new Error('avatarGeometry: fusión de primitivas fallida');
  for (const p of parts) p.dispose();
  return merged;
}

function sphere(r: number, x: number, y: number, z: number): THREE.BufferGeometry {
  return new THREE.SphereGeometry(r, SPHERE_SEGS_W, SPHERE_SEGS_H).translate(x, y, z);
}

/** Extremidad: cápsula con rotaciones opcionales (aplicadas ANTES de trasladar). */
function limb(
  r: number,
  len: number,
  rotX: number,
  rotZ: number,
  x: number,
  y: number,
  z: number,
): THREE.BufferGeometry {
  const g = new THREE.CapsuleGeometry(r, len, 4, 10);
  if (rotX !== 0) g.rotateX(rotX);
  if (rotZ !== 0) g.rotateZ(rotZ);
  return g.translate(x, y, z);
}

/** Aplasta una parte en Z (para la silueta "galleta" de la pose plano). */
function flatten(g: THREE.BufferGeometry, k: number): THREE.BufferGeometry {
  return g.scale(1, 1, k);
}

/** De pie (~1.7 m): el muñeco del original — simétrico, sin cara, brazos a los lados. */
function buildStand(): THREE.BufferGeometry {
  return fuse([
    sphere(0.28, 0, 1.4, 0), // cabeza (top ~1.68)
    new THREE.CapsuleGeometry(0.31, 0.5, 4, 12).translate(0, 0.72, 0), // torso blob
    limb(0.1, 0.35, 0, 0.25, -0.38, 0.82, 0), // brazo izq (ligeramente abierto)
    limb(0.1, 0.35, 0, -0.25, 0.38, 0.82, 0), // brazo der
    limb(0.12, 0.3, 0, 0, -0.15, 0.27, 0), // pierna izq
    limb(0.12, 0.3, 0, 0, 0.15, 0.27, 0), // pierna der
  ]);
}

/** Arrodillado (~1.2 m, la altura del hitbox): rodillas al frente, brazos pegados. */
function buildCrouch(): THREE.BufferGeometry {
  return fuse([
    sphere(0.24, 0, 0.96, 0.06), // cabeza (top 1.20)
    new THREE.CapsuleGeometry(0.28, 0.35, 4, 12).rotateX(0.35).translate(0, 0.52, -0.02),
    sphere(0.11, -0.16, 0.13, 0.3), // rodilla izq (sesgo frontal: sigue al yaw)
    sphere(0.11, 0.16, 0.13, 0.3), // rodilla der
    sphere(0.1, -0.16, 0.11, -0.3), // pie izq
    sphere(0.1, 0.16, 0.11, -0.3), // pie der
    limb(0.09, 0.28, 0.5, 0, -0.31, 0.5, 0.12), // brazo izq abrazando el frente
    limb(0.09, 0.28, 0.5, 0, 0.31, 0.5, 0.12), // brazo der
  ]);
}

/** Bola: cuerpo acurrucado casi esférico con la cabeza recogida (curl del original). */
function buildBall(): THREE.BufferGeometry {
  return fuse([
    sphere(0.5, 0, 0.5, 0), // cuerpo hecho bola
    sphere(0.24, 0, 0.6, 0.34), // cabeza recogida (bulto sutil)
  ]);
}

/** Caja (~1.1 m): el Hider se hace una CAJA — se funde con las cajas del mapa
 *  (mimetismo de objeto del original). Cubo biselado; el hitbox lo cubre. */
function buildBox(): THREE.BufferGeometry {
  return fuse([new RoundedBoxGeometry(1.1, 1.05, 1.1, 2, 0.06).translate(0, 0.53, 0)]);
}

/** Barril (~1.4 m): el Hider se hace un CILINDRO — se funde con los barriles del mapa. */
function buildCylinder(): THREE.BufferGeometry {
  return fuse([new THREE.CylinderGeometry(0.58, 0.58, 1.35, 14).translate(0, 0.68, 0)]);
}

/** Plano (galleta, ~1.5 m): silueta de muñeco APLASTADA — idéntica a los señuelos
 *  `figureWall` de las fachadas del mapa. Delgada en Z (el yaw la alinea al muro). */
function buildFlat(): THREE.BufferGeometry {
  const K = 0.4; // factor de aplastado
  return fuse([
    flatten(sphere(0.26, 0, 0, 0), K).translate(0, 1.26, 0), // cabeza (top 1.52)
    flatten(new THREE.CapsuleGeometry(0.28, 0.45, 4, 12), K).translate(0, 0.74, 0),
    flatten(limb(0.09, 0.3, 0, 0.6, 0, 0, 0), K).translate(-0.36, 0.9, 0),
    flatten(limb(0.09, 0.3, 0, -0.6, 0, 0, 0), K).translate(0.36, 0.9, 0),
    flatten(limb(0.1, 0.26, 0, 0, 0, 0, 0), K).translate(-0.15, 0.25, 0),
    flatten(limb(0.1, 0.26, 0, 0, 0, 0, 0), K).translate(0.15, 0.25, 0),
  ]);
}

/** Una geometría fusionada por pose, indexada por el valor de pose del sim (0..5). */
export function buildPoseGeometries(): THREE.BufferGeometry[] {
  // Orden = POSE_STAND, CROUCH, BALL, FLAT, BOX, CYLINDER (índices del sim).
  const out = [buildStand(), buildCrouch(), buildBall(), buildFlat(), buildBox(), buildCylinder()];
  if (out.length !== POSE_COUNT) throw new Error('avatarGeometry: falta una pose');
  return out;
}
