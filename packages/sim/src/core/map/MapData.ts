/**
 * MapData — el escenario como DATO compartido y determinista (P0.1 del roadmap).
 *
 * Única fuente de verdad del mapa: el CLIENTE lo renderiza (Environment.tsx) y el
 * SERVIDOR razona sobre camuflaje con él (color de referencia por zona). Antes vivía
 * duplicado: colores solo-cliente en Environment + spawns solo-backend en GameMap.
 * Al vivir en `@mecha/sim`, ambos lados ven exactamente los mismos colores → el score
 * de camuflaje (P0.2) es coherente con lo que el jugador ve.
 *
 * Puro y sin Three.js (regla de dependencias, `hexagonal-vertical-slicing`). Colores
 * empaquetados 0xRRGGBBAA (mismo formato que `ColorRGBA.packRGBA8`), interpretados en
 * espacio sRGB por el render. `referenceColorAt` es camino caliente (P0.2 lo llama por
 * tick y por Hider): sin asignaciones, escribe en un `out` reutilizado.
 */
import { ColorRGBA } from '../value-objects/ColorRGBA';
import type { ArenaBounds } from '../collision';

export type ZoneKind = 'floor' | 'wall' | 'prop';

/** Región rectangular del escenario (AABB en el plano XZ, con altura) + su material. */
export interface MapZone {
  readonly id: string;
  readonly kind: ZoneKind;
  readonly minX: number;
  readonly maxX: number;
  readonly minZ: number;
  readonly maxZ: number;
  readonly y: number; // centro vertical (para render)
  readonly height: number; // alto del prop/muro (0 = suelo plano)
  readonly color: number; // color de referencia empaquetado 0xRRGGBBAA (sRGB)
  readonly roughness: number;
  readonly metalness: number;
}

export interface MapSpawn {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

export interface MapData {
  readonly id: string;
  readonly bounds: ArenaBounds;
  readonly floorColor: number; // color base del suelo (fallback), 0xRRGGBBAA
  readonly zones: readonly MapZone[];
  readonly spawns: readonly MapSpawn[];
}

/** Margen (m) para considerar que un jugador está "pegado" a un prop/muro. */
const PROP_HUG_MARGIN = 0.7;

function within(x: number, z: number, zn: MapZone, margin: number): boolean {
  return (
    x >= zn.minX - margin &&
    x <= zn.maxX + margin &&
    z >= zn.minZ - margin &&
    z <= zn.maxZ + margin
  );
}

/**
 * Color de referencia del entorno bajo/junto a (x,z): el color que un Hider intentaría
 * imitar ahí. Determinista y sin asignaciones (escribe en `out` y lo devuelve).
 *
 * Prioridad: prop/muro adyacente (dentro del margen de abrazo) > zona de suelo que
 * contiene el punto > color base del suelo. Empates: primer match en orden del array.
 */
export function referenceColorAt(map: MapData, x: number, z: number, out: ColorRGBA): ColorRGBA {
  // 1) prop/muro que "abrazas" (te escondes junto a él → imitas su color).
  for (let i = 0; i < map.zones.length; i++) {
    const zn = map.zones[i]!;
    if (zn.kind !== 'floor' && within(x, z, zn, PROP_HUG_MARGIN)) {
      return out.setFromPackedMut(zn.color);
    }
  }
  // 2) zona de suelo que pisas.
  for (let i = 0; i < map.zones.length; i++) {
    const zn = map.zones[i]!;
    if (zn.kind === 'floor' && within(x, z, zn, 0)) {
      return out.setFromPackedMut(zn.color);
    }
  }
  // 3) suelo base.
  return out.setFromPackedMut(map.floorColor);
}

/** Empaqueta 0xRRGGBB (sRGB) a 0xRRGGBBAA con alpha 255. */
function rgb(hex24: number): number {
  return (((hex24 & 0xffffff) << 8) | 0xff) >>> 0;
}

/**
 * Mapa por defecto: un salón pequeño y colorido. Suelo dividido en zonas de colores
 * muy distintos (para que "muévete a la zona roja y píntate de rojo" sea estrategia) +
 * props/muros de la paleta clásica (ladrillo, madera, musgo, metal, piedra) para
 * esconderse pegado y mimetizar su color. Diseñado dentro de bounds ±20.
 */
export const DEFAULT_MAP: MapData = {
  id: 'salon-01',
  bounds: { minX: -20, maxX: 20, minY: 0, maxY: 5, minZ: -20, maxZ: 20 },
  floorColor: rgb(0xcfcabc), // beige base
  zones: [
    // ── Zonas de suelo (colores dominantes distintos) ──
    { id: 'floor-nw', kind: 'floor', minX: -14, maxX: -2, minZ: -14, maxZ: -2, y: 0.01, height: 0, color: rgb(0xb5563f), roughness: 0.95, metalness: 0 },
    { id: 'floor-ne', kind: 'floor', minX: 2, maxX: 14, minZ: -14, maxZ: -2, y: 0.01, height: 0, color: rgb(0x2f6b6b), roughness: 0.95, metalness: 0 },
    { id: 'floor-sw', kind: 'floor', minX: -14, maxX: -2, minZ: 2, maxZ: 14, y: 0.01, height: 0, color: rgb(0xc9a227), roughness: 0.95, metalness: 0 },
    { id: 'floor-se', kind: 'floor', minX: 2, maxX: 14, minZ: 2, maxZ: 14, y: 0.01, height: 0, color: rgb(0x3a4a6b), roughness: 0.95, metalness: 0 },
    { id: 'rug-center', kind: 'floor', minX: -4, maxX: 4, minZ: -4, maxZ: 4, y: 0.02, height: 0, color: rgb(0x4a7a3a), roughness: 0.95, metalness: 0 },
    // ── Props (esquinas): cajas de la paleta clásica ──
    { id: 'prop-brick', kind: 'prop', minX: -9, maxX: -7, minZ: -9, maxZ: -7, y: 1, height: 2, color: rgb(0x8a3b2e), roughness: 0.9, metalness: 0 },
    { id: 'prop-wood', kind: 'prop', minX: 7, maxX: 9, minZ: -9, maxZ: -7, y: 1, height: 2, color: rgb(0x6b4a2b), roughness: 0.85, metalness: 0 },
    { id: 'prop-moss', kind: 'prop', minX: -9, maxX: -7, minZ: 7, maxZ: 9, y: 1, height: 2, color: rgb(0x3f6b3a), roughness: 0.95, metalness: 0 },
    { id: 'prop-metal', kind: 'prop', minX: 7, maxX: 9, minZ: 7, maxZ: 9, y: 0.75, height: 1.5, color: rgb(0x4a5a7a), roughness: 0.35, metalness: 0.7 },
    // ── Muros perimetrales (piedra), dejan un borde dentro de bounds ──
    { id: 'wall-n', kind: 'wall', minX: -15, maxX: 15, minZ: -15.5, maxZ: -14.5, y: 1.5, height: 3, color: rgb(0x7a7069), roughness: 0.95, metalness: 0 },
    { id: 'wall-s', kind: 'wall', minX: -15, maxX: 15, minZ: 14.5, maxZ: 15.5, y: 1.5, height: 3, color: rgb(0x7a7069), roughness: 0.95, metalness: 0 },
  ],
  // Puntos de spawn de referencia sobre zonas variadas. NOTA: hoy el spawn activo lo
  // calcula `phases.spawnPlayer` (rejilla); unificarlo con estos puntos es un follow-up.
  spawns: [
    { x: -8, y: 0, z: -4 },
    { x: 8, y: 0, z: -4 },
    { x: -8, y: 0, z: 4 },
    { x: 8, y: 0, z: 4 },
    { x: 0, y: 0, z: 0 },
    { x: -4, y: 0, z: -10 },
    { x: 4, y: 0, z: -10 },
    { x: -4, y: 0, z: 10 },
    { x: 4, y: 0, z: 10 },
    { x: 0, y: 0, z: -12 },
  ],
};
