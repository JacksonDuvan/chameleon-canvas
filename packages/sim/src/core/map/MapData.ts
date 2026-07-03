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
/**
 * Forma VISUAL del prop (la colisión/oclusión sigue siendo su AABB, aproximación).
 * `figure` = SEÑUELO con forma de muñeco de pie (estatua/maniquí) y `figureWall` =
 * muñeco plano montado en un muro (como las galletas del original): el cliente los
 * renderiza con LA MISMA geometría que el avatar → un Hider pintado y posado junto
 * a ellos es indistinguible (el pilar del mimetismo del original). Son sólidos:
 * dispararle a una estatua es un fallo, como dispararle a un cactus en el original.
 */
export type ZoneShape = 'box' | 'cylinder' | 'sphere' | 'figure' | 'figureWall';

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
  /** Forma de render (default 'box'). Las esferas/cilindros dan a las poses "bola" y
   *  "agachado" siluetas vecinas que imitar (mimetismo de objeto, biblia). */
  readonly shape?: ZoneShape;
  /** Orientación de render en cuartos de vuelta sobre Y (0..3; solo figuras). */
  readonly rot?: 0 | 1 | 2 | 3;
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

/**
 * ¿Es una zona SÓLIDA? (bloquea el movimiento y el rayo de captura — V1-A).
 * Los suelos no; muros y props sí.
 */
export function isSolidZone(z: MapZone): boolean {
  return z.kind !== 'floor';
}

/** Rango vertical de una zona sólida (para el ray-AABB de oclusión). */
export function zoneYMin(z: MapZone): number {
  return z.y - z.height / 2;
}
export function zoneYMax(z: MapZone): number {
  return z.y + z.height / 2;
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
 * Mapa por defecto v2 (post-playtest de V1-G): un PUEBLO 48×48 tipo diorama, no una
 * habitación. La receta del original que pidió el usuario:
 *  - Plaza central de spawn (|x|,|z| ≤ 5.5 SIN sólidos: la rejilla de spawnPlayer).
 *  - 4 barrios con paleta propia y CASAS con interior accesible (muros h 2.6 con
 *    aperturas ≥ 3 m; oclusión real): terracota (NW), teal (NE), mercado mostaza (SW)
 *    y navy (SE), separados por calles de 6 m sobre el suelo base.
 *  - SEÑUELOS de muñeco: `figure` (estatuas de pie: el "jardín de estatuas" del NE,
 *    maniquíes del mercado…) y `figureWall` (muñecos planos en fachadas, como las
 *    galletas del original) — el cliente los renderiza con la geometría del avatar.
 *  - Bolas, barriles y jardineras siguen emparejando con las otras poses.
 * Sin voladizos NI tejados: la colisión de movimiento es 2D (ignora Y) a propósito.
 * `bounds` DEBE coincidir con `DEFAULT_SIM_CONFIG.bounds` (test lo fuerza).
 */
export const DEFAULT_MAP: MapData = {
  id: 'pueblo-01',
  bounds: { minX: -24, maxX: 24, minY: 0, maxY: 5, minZ: -24, maxZ: 24 },
  floorColor: rgb(0xcfcabc), // calle/base beige
  zones: [
    // ── Suelos: plaza + 4 barrios (calles de 6 m en cruz quedan en el color base) ──
    { id: 'plaza', kind: 'floor', minX: -5.5, maxX: 5.5, minZ: -5.5, maxZ: 5.5, y: 0.02, height: 0, color: rgb(0xd8cfae), roughness: 0.95, metalness: 0 },
    { id: 'floor-nw', kind: 'floor', minX: -22, maxX: -3, minZ: -22, maxZ: -3, y: 0.01, height: 0, color: rgb(0xb5563f), roughness: 0.95, metalness: 0 },
    { id: 'floor-ne', kind: 'floor', minX: 3, maxX: 22, minZ: -22, maxZ: -3, y: 0.01, height: 0, color: rgb(0x2f6b6b), roughness: 0.95, metalness: 0 },
    { id: 'floor-sw', kind: 'floor', minX: -22, maxX: -3, minZ: 3, maxZ: 22, y: 0.01, height: 0, color: rgb(0xc9a227), roughness: 0.95, metalness: 0 },
    { id: 'floor-se', kind: 'floor', minX: 3, maxX: 22, minZ: 3, maxZ: 22, y: 0.01, height: 0, color: rgb(0x3a4a6b), roughness: 0.95, metalness: 0 },

    // ── Muros perimetrales (piedra): recinto 48×48 ──
    { id: 'wall-n', kind: 'wall', minX: -24, maxX: 24, minZ: -24, maxZ: -23.4, y: 1.5, height: 3, color: rgb(0x7a7069), roughness: 0.95, metalness: 0 },
    { id: 'wall-s', kind: 'wall', minX: -24, maxX: 24, minZ: 23.4, maxZ: 24, y: 1.5, height: 3, color: rgb(0x7a7069), roughness: 0.95, metalness: 0 },
    { id: 'wall-w', kind: 'wall', minX: -24, maxX: -23.4, minZ: -24, maxZ: 24, y: 1.5, height: 3, color: rgb(0x7a7069), roughness: 0.95, metalness: 0 },
    { id: 'wall-e', kind: 'wall', minX: 23.4, maxX: 24, minZ: -24, maxZ: 24, y: 1.5, height: 3, color: rgb(0x7a7069), roughness: 0.95, metalness: 0 },

    // ── NW · Casa crema (abre al sur) con patio terracota ──
    { id: 'nw-house-back', kind: 'wall', minX: -18, maxX: -9, minZ: -19, maxZ: -18.4, y: 1.3, height: 2.6, color: rgb(0xe8d9b5), roughness: 0.9, metalness: 0 },
    { id: 'nw-house-left', kind: 'wall', minX: -18, maxX: -17.4, minZ: -18.4, maxZ: -12, y: 1.3, height: 2.6, color: rgb(0xe8d9b5), roughness: 0.9, metalness: 0 },
    { id: 'nw-house-right', kind: 'wall', minX: -9.6, maxX: -9, minZ: -18.4, maxZ: -12, y: 1.3, height: 2.6, color: rgb(0xe8d9b5), roughness: 0.9, metalness: 0 },
    { id: 'nw-crate-tall', kind: 'prop', minX: -16.2, maxX: -14.4, minZ: -17.4, maxZ: -15.6, y: 1, height: 2, color: rgb(0xa04533), roughness: 0.9, metalness: 0 },
    { id: 'nw-crate-low', kind: 'prop', minX: -12.4, maxX: -11.2, minZ: -17, maxZ: -15.8, y: 0.5, height: 1, color: rgb(0x96442f), roughness: 0.9, metalness: 0 },
    // Galletas de fachada (cara este de la casa, mirando a +X)
    { id: 'nw-cookie-1', kind: 'prop', minX: -9, maxX: -8.7, minZ: -17, maxZ: -16.1, y: 1.25, height: 1.5, color: rgb(0x8a5a33), roughness: 0.9, metalness: 0, shape: 'figureWall', rot: 1 },
    { id: 'nw-cookie-2', kind: 'prop', minX: -9, maxX: -8.7, minZ: -15.2, maxZ: -14.3, y: 1.25, height: 1.5, color: rgb(0xe8d9b5), roughness: 0.9, metalness: 0, shape: 'figureWall', rot: 1 },
    // Estatua del patio + bola terracota
    { id: 'nw-statue', kind: 'prop', minX: -13.5, maxX: -12.6, minZ: -10.5, maxZ: -9.6, y: 0.85, height: 1.7, color: rgb(0xb5563f), roughness: 0.9, metalness: 0, shape: 'figure', rot: 2 },
    { id: 'nw-ball', kind: 'prop', minX: -7.2, maxX: -6, minZ: -12.6, maxZ: -11.4, y: 0.6, height: 1.2, color: rgb(0xb5563f), roughness: 0.9, metalness: 0, shape: 'sphere' },
    { id: 'nw-barrel', kind: 'prop', minX: -20.4, maxX: -19.2, minZ: -9.4, maxZ: -8.2, y: 0.7, height: 1.4, color: rgb(0x8a3b2e), roughness: 0.85, metalness: 0, shape: 'cylinder' },

    // ── NE · Casa teal (abre al oeste) + JARDÍN DE ESTATUAS (los "cactus") ──
    { id: 'ne-house-back', kind: 'wall', minX: 17.4, maxX: 18, minZ: -19, maxZ: -11, y: 1.3, height: 2.6, color: rgb(0x9fc4c4), roughness: 0.9, metalness: 0 },
    { id: 'ne-house-top', kind: 'wall', minX: 9, maxX: 18, minZ: -19, maxZ: -18.4, y: 1.3, height: 2.6, color: rgb(0x9fc4c4), roughness: 0.9, metalness: 0 },
    { id: 'ne-house-bottom', kind: 'wall', minX: 9, maxX: 18, minZ: -11.6, maxZ: -11, y: 1.3, height: 2.6, color: rgb(0x9fc4c4), roughness: 0.9, metalness: 0 },
    { id: 'ne-shelf', kind: 'prop', minX: 15.8, maxX: 16.6, minZ: -17.2, maxZ: -13.2, y: 0.9, height: 1.8, color: rgb(0x3a5f5f), roughness: 0.85, metalness: 0 },
    { id: 'ne-barrel-in', kind: 'prop', minX: 10.6, maxX: 11.8, minZ: -17.8, maxZ: -16.6, y: 0.7, height: 1.4, color: rgb(0x336666), roughness: 0.8, metalness: 0.15, shape: 'cylinder' },
    // Jardín de estatuas: fila doble — el escondite estrella de la pose "de pie"
    { id: 'ne-statue-1', kind: 'prop', minX: 7, maxX: 7.9, minZ: -7.6, maxZ: -6.7, y: 0.85, height: 1.7, color: rgb(0x4c8f6a), roughness: 0.9, metalness: 0, shape: 'figure' },
    { id: 'ne-statue-2', kind: 'prop', minX: 9.8, maxX: 10.7, minZ: -7.6, maxZ: -6.7, y: 0.85, height: 1.7, color: rgb(0x3f7d5c), roughness: 0.9, metalness: 0, shape: 'figure', rot: 1 },
    { id: 'ne-statue-3', kind: 'prop', minX: 12.6, maxX: 13.5, minZ: -7.6, maxZ: -6.7, y: 0.85, height: 1.7, color: rgb(0x4c8f6a), roughness: 0.9, metalness: 0, shape: 'figure', rot: 3 },
    { id: 'ne-statue-4', kind: 'prop', minX: 8.4, maxX: 9.3, minZ: -5.4, maxZ: -4.5, y: 0.85, height: 1.7, color: rgb(0x2f6b6b), roughness: 0.9, metalness: 0, shape: 'figure', rot: 2 },
    { id: 'ne-planter-1', kind: 'prop', minX: 6.6, maxX: 7.8, minZ: -4.9, maxZ: -3.7, y: 0.55, height: 1.1, color: rgb(0x3f6b3a), roughness: 0.95, metalness: 0, shape: 'cylinder' },
    { id: 'ne-planter-2', kind: 'prop', minX: 11.8, maxX: 13, minZ: -5.2, maxZ: -4, y: 0.55, height: 1.1, color: rgb(0x356032), roughness: 0.95, metalness: 0, shape: 'cylinder' },
    { id: 'ne-ball', kind: 'prop', minX: 20, maxX: 21.2, minZ: -8.4, maxZ: -7.2, y: 0.6, height: 1.2, color: rgb(0x2f6b6b), roughness: 0.9, metalness: 0, shape: 'sphere' },

    // ── SW · Mercado mostaza: puestos, barriles, maniquíes y muro en L con galletas ──
    { id: 'sw-stall-a', kind: 'prop', minX: -16, maxX: -13, minZ: 8, maxZ: 9.2, y: 0.5, height: 1, color: rgb(0xb08a2a), roughness: 0.9, metalness: 0 },
    { id: 'sw-stall-b', kind: 'prop', minX: -16, maxX: -13, minZ: 12, maxZ: 13.2, y: 0.5, height: 1, color: rgb(0x6b4a2b), roughness: 0.85, metalness: 0 },
    { id: 'sw-crate-tall', kind: 'prop', minX: -19.6, maxX: -17.8, minZ: 15, maxZ: 16.8, y: 1.1, height: 2.2, color: rgb(0x7d5a35), roughness: 0.85, metalness: 0 },
    { id: 'sw-wall-l', kind: 'wall', minX: -8, maxX: -7.4, minZ: 8, maxZ: 14, y: 1.2, height: 2.4, color: rgb(0x8a6a3a), roughness: 0.9, metalness: 0 },
    { id: 'sw-cookie-1', kind: 'prop', minX: -7.4, maxX: -7.1, minZ: 9, maxZ: 9.9, y: 1.25, height: 1.5, color: rgb(0xc9a227), roughness: 0.9, metalness: 0, shape: 'figureWall', rot: 1 },
    { id: 'sw-cookie-2', kind: 'prop', minX: -7.4, maxX: -7.1, minZ: 11.6, maxZ: 12.5, y: 1.25, height: 1.5, color: rgb(0x8a5a33), roughness: 0.9, metalness: 0, shape: 'figureWall', rot: 1 },
    { id: 'sw-mannequin-1', kind: 'prop', minX: -14.2, maxX: -13.3, minZ: 5.2, maxZ: 6.1, y: 0.85, height: 1.7, color: rgb(0xc9a227), roughness: 0.9, metalness: 0, shape: 'figure', rot: 2 },
    { id: 'sw-mannequin-2', kind: 'prop', minX: -11, maxX: -10.1, minZ: 10.2, maxZ: 11.1, y: 0.85, height: 1.7, color: rgb(0xb08a2a), roughness: 0.9, metalness: 0, shape: 'figure', rot: 1 },
    { id: 'sw-barrel-1', kind: 'prop', minX: -12, maxX: -10.8, minZ: 14.6, maxZ: 15.8, y: 0.7, height: 1.4, color: rgb(0x8a6a3a), roughness: 0.85, metalness: 0, shape: 'cylinder' },
    { id: 'sw-barrel-2', kind: 'prop', minX: -20.8, maxX: -19.6, minZ: 8.6, maxZ: 9.8, y: 0.7, height: 1.4, color: rgb(0x6b4a2b), roughness: 0.85, metalness: 0, shape: 'cylinder' },
    { id: 'sw-ball', kind: 'prop', minX: -18.4, maxX: -17.2, minZ: 19.6, maxZ: 20.8, y: 0.6, height: 1.2, color: rgb(0xc9a227), roughness: 0.9, metalness: 0, shape: 'sphere' },

    // ── SE · Barrio navy: casa (abre al norte), lockers, galletas y bolas ──
    { id: 'se-house-south', kind: 'wall', minX: 9, maxX: 19, minZ: 18.4, maxZ: 19, y: 1.3, height: 2.6, color: rgb(0x6b7da3), roughness: 0.9, metalness: 0 },
    { id: 'se-house-west', kind: 'wall', minX: 9, maxX: 9.6, minZ: 12, maxZ: 18.4, y: 1.3, height: 2.6, color: rgb(0x6b7da3), roughness: 0.9, metalness: 0 },
    { id: 'se-locker-1', kind: 'prop', minX: 16, maxX: 17.8, minZ: 15, maxZ: 16.8, y: 1.1, height: 2.2, color: rgb(0x4a5a7a), roughness: 0.35, metalness: 0.7 },
    { id: 'se-locker-2', kind: 'prop', minX: 12, maxX: 13.4, minZ: 16.2, maxZ: 17.6, y: 1.1, height: 2.2, color: rgb(0x55688c), roughness: 0.35, metalness: 0.7 },
    { id: 'se-cookie-1', kind: 'prop', minX: 8.7, maxX: 9, minZ: 13, maxZ: 13.9, y: 1.25, height: 1.5, color: rgb(0x9fb4d8), roughness: 0.9, metalness: 0, shape: 'figureWall', rot: 3 },
    { id: 'se-cookie-2', kind: 'prop', minX: 8.7, maxX: 9, minZ: 15.4, maxZ: 16.3, y: 1.25, height: 1.5, color: rgb(0x3a4a6b), roughness: 0.9, metalness: 0, shape: 'figureWall', rot: 3 },
    { id: 'se-statue', kind: 'prop', minX: 6.4, maxX: 7.3, minZ: 9.4, maxZ: 10.3, y: 0.85, height: 1.7, color: rgb(0x3a4a6b), roughness: 0.9, metalness: 0, shape: 'figure' },
    { id: 'se-ball-1', kind: 'prop', minX: 13.2, maxX: 14.4, minZ: 10, maxZ: 11.2, y: 0.6, height: 1.2, color: rgb(0x3a4a6b), roughness: 0.9, metalness: 0, shape: 'sphere' },
    { id: 'se-ball-2', kind: 'prop', minX: 20.2, maxX: 21.4, minZ: 20, maxZ: 21.2, y: 0.6, height: 1.2, color: rgb(0x55688c), roughness: 0.9, metalness: 0, shape: 'sphere' },
    { id: 'se-barrel', kind: 'prop', minX: 19.8, maxX: 21, minZ: 12.4, maxZ: 13.6, y: 0.7, height: 1.4, color: rgb(0x4a5a7a), roughness: 0.8, metalness: 0.15, shape: 'cylinder' },

    // ── Miniciudad (v3, feedback del playtest): más casas/cobertizos por barrio ──
    // NW-2 · Cabaña salmón (oeste; abre al este y al sur)
    { id: 'nw2-back', kind: 'wall', minX: -21, maxX: -20.4, minZ: -8, maxZ: -3.6, y: 1.3, height: 2.6, color: rgb(0xd98c7a), roughness: 0.9, metalness: 0 },
    { id: 'nw2-top', kind: 'wall', minX: -21, maxX: -15, minZ: -8, maxZ: -7.4, y: 1.3, height: 2.6, color: rgb(0xd98c7a), roughness: 0.9, metalness: 0 },
    { id: 'nw2-bottom', kind: 'wall', minX: -21, maxX: -18, minZ: -4.2, maxZ: -3.6, y: 1.3, height: 2.6, color: rgb(0xd98c7a), roughness: 0.9, metalness: 0 },
    { id: 'nw2-statue', kind: 'prop', minX: -19.4, maxX: -18.5, minZ: -6.6, maxZ: -5.7, y: 0.85, height: 1.7, color: rgb(0xd98c7a), roughness: 0.9, metalness: 0, shape: 'figure', rot: 1 },
    // NE-2 · Cabaña esquina (usa el perímetro como dos lados; abre al sur-oeste)
    { id: 'ne2-south', kind: 'wall', minX: 19, maxX: 23, minZ: -18.6, maxZ: -18, y: 1.3, height: 2.6, color: rgb(0xbfd9d9), roughness: 0.9, metalness: 0 },
    { id: 'ne2-west', kind: 'wall', minX: 19, maxX: 19.6, minZ: -23, maxZ: -21, y: 1.3, height: 2.6, color: rgb(0xbfd9d9), roughness: 0.9, metalness: 0 },
    { id: 'ne2-cookie', kind: 'prop', minX: 19.6, maxX: 19.9, minZ: -22.6, maxZ: -21.7, y: 1.25, height: 1.5, color: rgb(0x2f6b6b), roughness: 0.9, metalness: 0, shape: 'figureWall', rot: 1 },
    // SW-2 · Cabaña mostaza pálida (sur; abre al oeste)
    { id: 'sw2-back', kind: 'wall', minX: -15, maxX: -9, minZ: 21.4, maxZ: 22, y: 1.3, height: 2.6, color: rgb(0xd7b45a), roughness: 0.9, metalness: 0 },
    { id: 'sw2-east', kind: 'wall', minX: -9.6, maxX: -9, minZ: 17, maxZ: 21.4, y: 1.3, height: 2.6, color: rgb(0xd7b45a), roughness: 0.9, metalness: 0 },
    { id: 'sw2-top', kind: 'wall', minX: -15, maxX: -12.6, minZ: 17, maxZ: 17.6, y: 1.3, height: 2.6, color: rgb(0xd7b45a), roughness: 0.9, metalness: 0 },
    { id: 'sw2-cookie', kind: 'prop', minX: -9.9, maxX: -9.6, minZ: 18.2, maxZ: 19.1, y: 1.25, height: 1.5, color: rgb(0x6b4a2b), roughness: 0.9, metalness: 0, shape: 'figureWall', rot: 3 },
    // SE-2 · Cobertizo en L (abre al sur)
    { id: 'se2-north', kind: 'wall', minX: 17, maxX: 22, minZ: 3.5, maxZ: 4.1, y: 1.3, height: 2.6, color: rgb(0x8a9bbf), roughness: 0.9, metalness: 0 },
    { id: 'se2-west', kind: 'wall', minX: 17, maxX: 17.6, minZ: 4.1, maxZ: 8, y: 1.3, height: 2.6, color: rgb(0x8a9bbf), roughness: 0.9, metalness: 0 },
    { id: 'se2-statue', kind: 'prop', minX: 19.2, maxX: 20.1, minZ: 5.4, maxZ: 6.3, y: 0.85, height: 1.7, color: rgb(0x3a4a6b), roughness: 0.9, metalness: 0, shape: 'figure', rot: 3 },

    // ── Plaza y calles: jardineras en las esquinas de la plaza + tráfico de props ──
    { id: 'plaza-planter-1', kind: 'prop', minX: -7.4, maxX: -6.2, minZ: -7.4, maxZ: -6.2, y: 0.55, height: 1.1, color: rgb(0x3f6b3a), roughness: 0.95, metalness: 0, shape: 'cylinder' },
    { id: 'plaza-planter-2', kind: 'prop', minX: 6.2, maxX: 7.4, minZ: -7.4, maxZ: -6.2, y: 0.55, height: 1.1, color: rgb(0x356032), roughness: 0.95, metalness: 0, shape: 'cylinder' },
    { id: 'plaza-planter-3', kind: 'prop', minX: -7.4, maxX: -6.2, minZ: 6.2, maxZ: 7.4, y: 0.55, height: 1.1, color: rgb(0x356032), roughness: 0.95, metalness: 0, shape: 'cylinder' },
    { id: 'plaza-planter-4', kind: 'prop', minX: 6.2, maxX: 7.4, minZ: 6.2, maxZ: 7.4, y: 0.55, height: 1.1, color: rgb(0x3f6b3a), roughness: 0.95, metalness: 0, shape: 'cylinder' },
    { id: 'street-crate-n', kind: 'prop', minX: -1.4, maxX: 0, minZ: -14, maxZ: -12.6, y: 0.5, height: 1, color: rgb(0xbfb49a), roughness: 0.9, metalness: 0 },
    { id: 'street-crate-s', kind: 'prop', minX: 0.2, maxX: 1.6, minZ: 13, maxZ: 14.4, y: 0.5, height: 1, color: rgb(0xbfb49a), roughness: 0.9, metalness: 0 },
    { id: 'street-statue-w', kind: 'prop', minX: -14.6, maxX: -13.7, minZ: -0.9, maxZ: 0, y: 0.85, height: 1.7, color: rgb(0xcfcabc), roughness: 0.9, metalness: 0, shape: 'figure', rot: 1 },
    { id: 'street-ball-e', kind: 'prop', minX: 13.6, maxX: 14.8, minZ: -0.6, maxZ: 0.6, y: 0.6, height: 1.2, color: rgb(0xcfcabc), roughness: 0.9, metalness: 0, shape: 'sphere' },
  ],
  // Puntos de spawn de referencia sobre zonas variadas. NOTA: hoy el spawn activo lo
  // calcula `phases.spawnPlayer` (rejilla en la plaza); unificarlos es un follow-up.
  spawns: [
    { x: -4, y: 0, z: -4 },
    { x: 4, y: 0, z: -4 },
    { x: -4, y: 0, z: 4 },
    { x: 4, y: 0, z: 4 },
    { x: 0, y: 0, z: 0 },
    { x: -2, y: 0, z: -2 },
    { x: 2, y: 0, z: -2 },
    { x: -2, y: 0, z: 2 },
    { x: 2, y: 0, z: 2 },
    { x: 0, y: 0, z: -4 },
  ],
};
