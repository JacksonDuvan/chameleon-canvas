/**
 * furnitureGeometry — muebles de oficina DETALLADOS, en espacio UNITARIO (−0.5..0.5).
 *
 * ÚNICA definición de la forma de cada mueble, usada por dos consumidores:
 *  - `Environment`: la escala al AABB de la zona del mapa (colisión/oclusión del
 *    servidor intactas — el volumen es exactamente el mismo).
 *  - `avatarGeometry`: la escala a `FURNITURE_SPECS` para las POSES de mimetismo
 *    (`POSE_CABINET`…): un Hider hecho mesa es geométricamente la mesa del mapa.
 *
 * Cada mueble es una fusión de cajas (un solo material: el relieve lo lee la luz).
 * Simétricos en X/Z: el generador no orienta los muebles.
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { FurnitureKind } from '@mecha/sim';

/** Caja en espacio UNITARIO: pieza de un mueble compuesto. */
function part(x0: number, x1: number, y0: number, y1: number, z0: number, z1: number): THREE.BufferGeometry {
  return new THREE.BoxGeometry(x1 - x0, y1 - y0, z1 - z0).translate((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
}

function fuse(parts: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const merged = mergeGeometries(parts, false);
  for (const p of parts) p.dispose();
  if (!merged) throw new Error('furnitureGeometry: fusión de mueble fallida');
  return merged;
}

function buildUnit(kind: FurnitureKind): THREE.BufferGeometry {
  switch (kind) {
    // Mesa: tablero + dos costados + cajonera retranqueada + travesaño.
    case 'desk':
      return fuse([
        part(-0.5, 0.5, 0.36, 0.5, -0.5, 0.5),
        part(-0.5, -0.45, -0.5, 0.36, -0.46, 0.46),
        part(0.45, 0.5, -0.5, 0.36, -0.46, 0.46),
        part(0.12, 0.45, -0.3, 0.36, -0.4, 0.4),
        part(-0.45, 0.12, 0.0, 0.36, -0.06, 0.06),
      ]);
    // Archivador: cuerpo retranqueado + 4 frentes de cajón + tapa y zócalo.
    case 'cabinet':
      return fuse([
        part(-0.47, 0.47, -0.5, 0.5, -0.46, 0.46),
        part(-0.5, 0.5, 0.46, 0.5, -0.5, 0.5),
        part(-0.5, 0.5, -0.5, -0.46, -0.5, 0.5),
        part(-0.42, 0.42, 0.24, 0.43, -0.5, 0.5),
        part(-0.42, 0.42, 0.01, 0.2, -0.5, 0.5),
        part(-0.42, 0.42, -0.22, -0.03, -0.5, 0.5),
        part(-0.42, 0.42, -0.43, -0.26, -0.5, 0.5),
      ]);
    // Terminal-kiosco: peana + columna + cabezal con visera.
    case 'terminal':
      return fuse([
        part(-0.5, 0.5, -0.5, -0.44, -0.5, 0.5),
        part(-0.3, 0.3, -0.44, 0.1, -0.3, 0.3),
        part(-0.5, 0.5, 0.1, 0.44, -0.42, 0.42),
        part(-0.44, 0.44, 0.44, 0.5, -0.5, 0.5),
      ]);
    // Taburete: base + fuste + asiento (perfil torneado).
    case 'stool': {
      const lathe = new THREE.LatheGeometry(
        [
          new THREE.Vector2(0.0, -0.5),
          new THREE.Vector2(0.42, -0.5),
          new THREE.Vector2(0.42, -0.44),
          new THREE.Vector2(0.12, -0.4),
          new THREE.Vector2(0.1, 0.24),
          new THREE.Vector2(0.5, 0.3),
          new THREE.Vector2(0.5, 0.5),
          new THREE.Vector2(0.0, 0.5),
        ],
        12,
      );
      // Sin índice, como las cajas fusionadas: el flat-shading queda idéntico en el
      // mapa y en el avatar (nadie se delata por el sombreado).
      const flat = lathe.toNonIndexed();
      lathe.dispose();
      flat.computeVertexNormals();
      return flat;
    }
  }
}

const cache = new Map<FurnitureKind, THREE.BufferGeometry>();

/** Geometría UNITARIA (compartida, no la mutes ni la liberes) de un mueble. */
export function getFurnitureUnit(kind: FurnitureKind): THREE.BufferGeometry {
  let g = cache.get(kind);
  if (!g) {
    g = buildUnit(kind);
    cache.set(kind, g);
  }
  return g;
}

/** Copia a TAMAÑO REAL con la base en y=0 (para las poses del avatar). */
export function buildFurnitureSized(kind: FurnitureKind, w: number, h: number, d: number): THREE.BufferGeometry {
  return getFurnitureUnit(kind).clone().scale(w, h, d).translate(0, h / 2, 0);
}
