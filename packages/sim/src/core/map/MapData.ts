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
/** Forma VISUAL del prop (la colisión/oclusión sigue siendo su AABB, aproximación). */
export type ZoneShape = 'box' | 'cylinder' | 'sphere';

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
 * Mapa por defecto (V1-A): un salón CON COBERTURA — la condición para esconderse de
 * verdad. Suelo en zonas de colores muy distintos ("muévete a la zona roja y píntate
 * de rojo") + muros perimetrales e interiores que crean esquinas/nichos con oclusión
 * real + cajas ALTAS (~2 m: cubren de pie) y BAJAS (~1 m: cubren agachado/bola) cuyo
 * color empareja con el suelo de su cuadrante (pintarte del color local funciona
 * pegado a ellas). El área central de spawn (|x|,|z| ≤ 4.5) queda libre de sólidos.
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

    // ── Muros perimetrales (piedra): recinto cerrado 30×30 ──
    { id: 'wall-n', kind: 'wall', minX: -15, maxX: 15, minZ: -15.3, maxZ: -14.7, y: 1.5, height: 3, color: rgb(0x7a7069), roughness: 0.95, metalness: 0 },
    { id: 'wall-s', kind: 'wall', minX: -15, maxX: 15, minZ: 14.7, maxZ: 15.3, y: 1.5, height: 3, color: rgb(0x7a7069), roughness: 0.95, metalness: 0 },
    { id: 'wall-w', kind: 'wall', minX: -15.3, maxX: -14.7, minZ: -15, maxZ: 15, y: 1.5, height: 3, color: rgb(0x7a7069), roughness: 0.95, metalness: 0 },
    { id: 'wall-e', kind: 'wall', minX: 14.7, maxX: 15.3, minZ: -15, maxZ: 15, y: 1.5, height: 3, color: rgb(0x7a7069), roughness: 0.95, metalness: 0 },

    // ── Muros interiores: esquinas y habitaciones (oclusión real) ──
    { id: 'wall-int-w', kind: 'wall', minX: -14.7, maxX: -6, minZ: -0.35, maxZ: 0.35, y: 1.2, height: 2.4, color: rgb(0x8a3b2e), roughness: 0.9, metalness: 0 },
    { id: 'wall-int-n', kind: 'wall', minX: -0.35, maxX: 0.35, minZ: -14.7, maxZ: -6, y: 1.2, height: 2.4, color: rgb(0x5a6668), roughness: 0.95, metalness: 0 },
    { id: 'wall-int-se-a', kind: 'wall', minX: 6, maxX: 13, minZ: 6.7, maxZ: 7.3, y: 1.1, height: 2.2, color: rgb(0x46587a), roughness: 0.9, metalness: 0.1 },
    { id: 'wall-int-se-b', kind: 'wall', minX: 6, maxX: 6.6, minZ: 7.3, maxZ: 12, y: 1.1, height: 2.2, color: rgb(0x46587a), roughness: 0.9, metalness: 0.1 },

    // ── NW (ladrillo/terracota): cajas altas + baja ──
    { id: 'crate-nw-tall-1', kind: 'prop', minX: -11, maxX: -9, minZ: -11, maxZ: -9, y: 1, height: 2, color: rgb(0x8a3b2e), roughness: 0.9, metalness: 0 },
    { id: 'crate-nw-tall-2', kind: 'prop', minX: -8.4, maxX: -6.9, minZ: -10.8, maxZ: -9.3, y: 1, height: 2, color: rgb(0xa04533), roughness: 0.9, metalness: 0 },
    { id: 'crate-nw-low', kind: 'prop', minX: -10.6, maxX: -9.4, minZ: -7.8, maxZ: -6.6, y: 0.45, height: 0.9, color: rgb(0x96442f), roughness: 0.9, metalness: 0 },

    // ── NE (teal): estantería larga + cajas ──
    { id: 'shelf-ne', kind: 'prop', minX: 4, maxX: 12, minZ: -8.7, maxZ: -8.1, y: 0.9, height: 1.8, color: rgb(0x3a5f5f), roughness: 0.85, metalness: 0 },
    { id: 'crate-ne-tall', kind: 'prop', minX: 10, maxX: 12, minZ: -13, maxZ: -11.4, y: 1.05, height: 2.1, color: rgb(0x2f5b5b), roughness: 0.9, metalness: 0 },
    { id: 'crate-ne-low', kind: 'prop', minX: 5, maxX: 6.4, minZ: -12.4, maxZ: -11, y: 0.5, height: 1, color: rgb(0x367070), roughness: 0.9, metalness: 0 },

    // ── SW (madera/mostaza): cajas altas + baja ──
    { id: 'crate-sw-tall-1', kind: 'prop', minX: -12, maxX: -10, minZ: 9, maxZ: 11, y: 1, height: 2, color: rgb(0x6b4a2b), roughness: 0.85, metalness: 0 },
    { id: 'crate-sw-tall-2', kind: 'prop', minX: -9.4, maxX: -7.6, minZ: 11.2, maxZ: 12.8, y: 1.1, height: 2.2, color: rgb(0x7d5a35), roughness: 0.85, metalness: 0 },
    { id: 'crate-sw-low', kind: 'prop', minX: -7.5, maxX: -6.2, minZ: 8, maxZ: 9.3, y: 0.45, height: 0.9, color: rgb(0xb08a2a), roughness: 0.9, metalness: 0 },

    // ── SE (metal/navy): lockers dentro del nicho en L ──
    { id: 'locker-se-1', kind: 'prop', minX: 10.5, maxX: 12.3, minZ: 9, maxZ: 10.8, y: 1.1, height: 2.2, color: rgb(0x4a5a7a), roughness: 0.35, metalness: 0.7 },
    { id: 'locker-se-2', kind: 'prop', minX: 8, maxX: 9.4, minZ: 11.5, maxZ: 13, y: 1.1, height: 2.2, color: rgb(0x55688c), roughness: 0.35, metalness: 0.7 },

    // ── Jardineras (musgo, bajas) cerca del centro — cilíndricas ──
    { id: 'planter-1', kind: 'prop', minX: -5.8, maxX: -4.6, minZ: 4.6, maxZ: 5.8, y: 0.55, height: 1.1, color: rgb(0x3f6b3a), roughness: 0.95, metalness: 0, shape: 'cylinder' },
    { id: 'planter-2', kind: 'prop', minX: 4.6, maxX: 5.8, minZ: -5.8, maxZ: -4.6, y: 0.55, height: 1.1, color: rgb(0x356032), roughness: 0.95, metalness: 0, shape: 'cylinder' },

    // ── Barriles (cilindros): silueta vecina para la pose "agachado" ──
    { id: 'barrel-ne', kind: 'prop', minX: 12.6, maxX: 13.8, minZ: -7.6, maxZ: -6.4, y: 0.7, height: 1.4, color: rgb(0x336666), roughness: 0.8, metalness: 0.15, shape: 'cylinder' },
    { id: 'barrel-sw', kind: 'prop', minX: -13.4, maxX: -12.2, minZ: 5, maxZ: 6.2, y: 0.7, height: 1.4, color: rgb(0x8a6a3a), roughness: 0.85, metalness: 0, shape: 'cylinder' },

    // ── Bolas decorativas (esferas): la pose "bola" desaparece junto a ellas ──
    { id: 'ball-nw', kind: 'prop', minX: -6.4, maxX: -5.2, minZ: -12.8, maxZ: -11.6, y: 0.6, height: 1.2, color: rgb(0xb5563f), roughness: 0.9, metalness: 0, shape: 'sphere' },
    { id: 'ball-se', kind: 'prop', minX: 12.4, maxX: 13.6, minZ: 12.2, maxZ: 13.4, y: 0.6, height: 1.2, color: rgb(0x3a4a6b), roughness: 0.9, metalness: 0, shape: 'sphere' },
    { id: 'ball-center', kind: 'prop', minX: 5.2, maxX: 6.4, minZ: 5.2, maxZ: 6.4, y: 0.6, height: 1.2, color: rgb(0x4a7a3a), roughness: 0.9, metalness: 0, shape: 'sphere' },
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
