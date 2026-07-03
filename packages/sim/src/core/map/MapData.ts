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

// ═══════════════════════════════════════════════════════════════════════════════
// Generador PROCEDURAL de mapa (feedback del playtest: "que el mapa sea aleatorio en
// cada ronda para que el Seeker no se lo aprenda"). DETERMINISTA a partir de una
// semilla → cliente y servidor generan el MISMO mapa (requisito del netcode; el mapa
// no viaja entero, solo su `mapSeed` en el wire). Todas las coordenadas se CUANTIZAN
// a una rejilla de 0.1 m para eliminar cualquier deriva de coma flotante entre
// isolates (server workerd ↔ navegador). Invariantes garantizadas (tests):
//   - recinto 48×48 = bounds del SimConfig; plaza central de spawn LIBRE de sólidos.
//   - ≥16 tramos de muro (4 perímetro + 4 barrios × 3 = miniciudad), ≥6 estatuas
//     (figure), ≥4 galletas de fachada (figureWall), esfera + cilindro, ≥8 colores.
// ═══════════════════════════════════════════════════════════════════════════════

import { makeRng } from '../rng';

/** Cuantiza a rejilla de 0.1 m (determinismo cross-isolate). */
function q(v: number): number {
  return Math.round(v * 10) / 10;
}

/** Paletas de barrio (base + variantes de props): dan a cada ronda un color distinto. */
const BARRIO_PALETTES: ReadonlyArray<{ floor: number; wall: number; props: readonly number[] }> = [
  { floor: 0xb5563f, wall: 0xe8d9b5, props: [0xa04533, 0x96442f, 0x8a3b2e] }, // terracota
  { floor: 0x2f6b6b, wall: 0x9fc4c4, props: [0x3a5f5f, 0x336666, 0x4c8f6a] }, // teal
  { floor: 0xc9a227, wall: 0xd7b45a, props: [0xb08a2a, 0x6b4a2b, 0x7d5a35] }, // mostaza
  { floor: 0x3a4a6b, wall: 0x6b7da3, props: [0x4a5a7a, 0x55688c, 0x46587a] }, // navy
  { floor: 0x6b3f6b, wall: 0xb59fc4, props: [0x7a4a7a, 0x8c5588, 0x5a3a6b] }, // ciruela
  { floor: 0x3f6b3a, wall: 0xa8c49f, props: [0x4c8f4a, 0x357032, 0x5a7d35] }, // bosque
];

/** Cuadrantes: signo (sx,sz) del barrio y el eje "hacia el centro". */
const QUADRANTS: ReadonlyArray<{ sx: number; sz: number }> = [
  { sx: -1, sz: -1 }, // NW
  { sx: 1, sz: -1 }, // NE
  { sx: -1, sz: 1 }, // SW
  { sx: 1, sz: 1 }, // SE
];

/** Baraja Fisher-Yates determinista (copia). */
function shuffled<T>(arr: readonly T[], rng: ReturnType<typeof makeRng>): T[] {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = rng.nextInt(i + 1);
    const t = a[i]!;
    a[i] = a[j]!;
    a[j] = t;
  }
  return a;
}

/**
 * Genera un PUEBLO 48×48 aleatorio pero determinista para `seed`. Mismo seed ⇒ mismo
 * mapa, byte a byte, en cualquier isolate. Ver el bloque de invariantes de arriba.
 */
export function generateMap(seed: number): MapData {
  const rng = makeRng((seed >>> 0) || 1);
  const zones: MapZone[] = [];
  const B = 24; // semi-lado del recinto (bounds -24..24)

  // ── Suelo por barrio (colores barajados) + plaza central ──
  const palettes = shuffled(BARRIO_PALETTES, rng);
  zones.push({ id: 'plaza', kind: 'floor', minX: -5.5, maxX: 5.5, minZ: -5.5, maxZ: 5.5, y: 0.02, height: 0, color: rgb(0xd8cfae), roughness: 0.95, metalness: 0 });
  for (let qi = 0; qi < 4; qi++) {
    const { sx, sz } = QUADRANTS[qi]!;
    const pal = palettes[qi]!;
    const x0 = sx < 0 ? -22 : 3;
    const x1 = sx < 0 ? -3 : 22;
    const z0 = sz < 0 ? -22 : 3;
    const z1 = sz < 0 ? -3 : 22;
    zones.push({ id: `q${qi}-floor`, kind: 'floor', minX: x0, maxX: x1, minZ: z0, maxZ: z1, y: 0.01, height: 0, color: rgb(pal.floor), roughness: 0.95, metalness: 0 });
  }

  // ── Muros perimetrales (recinto cerrado) ──
  const wallGray = rgb(0x7a7069);
  zones.push({ id: 'wall-n', kind: 'wall', minX: -B, maxX: B, minZ: -B, maxZ: -B + 0.6, y: 1.5, height: 3, color: wallGray, roughness: 0.95, metalness: 0 });
  zones.push({ id: 'wall-s', kind: 'wall', minX: -B, maxX: B, minZ: B - 0.6, maxZ: B, y: 1.5, height: 3, color: wallGray, roughness: 0.95, metalness: 0 });
  zones.push({ id: 'wall-w', kind: 'wall', minX: -B, maxX: -B + 0.6, minZ: -B, maxZ: B, y: 1.5, height: 3, color: wallGray, roughness: 0.95, metalness: 0 });
  zones.push({ id: 'wall-e', kind: 'wall', minX: B - 0.6, maxX: B, minZ: -B, maxZ: B, y: 1.5, height: 3, color: wallGray, roughness: 0.95, metalness: 0 });

  // ── Cada barrio: casa (3 muros, abertura aleatoria) + estatuas + galleta + props ──
  for (let qi = 0; qi < 4; qi++) {
    const { sx, sz } = QUADRANTS[qi]!;
    const pal = palettes[qi]!;
    const pick = (): number => rgb(pal.props[rng.nextInt(pal.props.length)]!);

    // Casa: cuadrado en el rincón exterior; se omite UN lado (abertura aleatoria).
    const cx = sx * 14;
    const cz = sz * 14;
    const h = 3.2;
    const t = 0.6;
    const wallCol = rgb(pal.wall);
    const openDir = rng.nextInt(4); // 0:-x 1:+x 2:-z 3:+z
    const houseWalls: Array<{ minX: number; maxX: number; minZ: number; maxZ: number }> = [];
    if (openDir !== 0) houseWalls.push({ minX: cx - h, maxX: cx - h + t, minZ: cz - h, maxZ: cz + h });
    if (openDir !== 1) houseWalls.push({ minX: cx + h - t, maxX: cx + h, minZ: cz - h, maxZ: cz + h });
    if (openDir !== 2) houseWalls.push({ minX: cx - h, maxX: cx + h, minZ: cz - h, maxZ: cz - h + t });
    if (openDir !== 3) houseWalls.push({ minX: cx - h, maxX: cx + h, minZ: cz + h - t, maxZ: cz + h });
    houseWalls.forEach((w, i) => {
      zones.push({ id: `q${qi}-house-${i}`, kind: 'wall', minX: q(w.minX), maxX: q(w.maxX), minZ: q(w.minZ), maxZ: q(w.maxZ), y: 1.3, height: 2.6, color: wallCol, roughness: 0.9, metalness: 0 });
    });

    // Galleta de fachada: montada contra el primer muro de la casa (figureWall).
    const fw = houseWalls[0]!;
    const fwMidZ = (fw.minZ + fw.maxZ) / 2;
    zones.push({ id: `q${qi}-cookie`, kind: 'prop', minX: q(fw.minX), maxX: q(fw.minX + 0.3), minZ: q(fwMidZ - 0.45), maxZ: q(fwMidZ + 0.45), y: 1.25, height: 1.5, color: pick(), roughness: 0.9, metalness: 0, shape: 'figureWall', rot: (rng.nextInt(4) as 0 | 1 | 2 | 3) });

    // 2 estatuas (figure) en el interior del barrio, jitter determinista.
    for (let s = 0; s < 2; s++) {
      const px = sx * q(8 + rng.next() * 2.5);
      const pz = sz * q(8 + rng.next() * 2.5 + s * 0.6);
      zones.push({ id: `q${qi}-statue-${s}`, kind: 'prop', minX: q(px - 0.45), maxX: q(px + 0.45), minZ: q(pz - 0.45), maxZ: q(pz + 0.45), y: 0.85, height: 1.7, color: rgb(pal.floor), roughness: 0.9, metalness: 0, shape: 'figure', rot: (rng.nextInt(4) as 0 | 1 | 2 | 3) });
    }

    // Trío de props para las otras poses: caja, barril (cilindro) y bola (esfera).
    const bx = sx * q(9 + rng.next() * 1.5);
    const bz = sz * q(10.5 + rng.next() * 1);
    zones.push({ id: `q${qi}-crate`, kind: 'prop', minX: q(bx - 0.6), maxX: q(bx + 0.6), minZ: q(bz - 0.6), maxZ: q(bz + 0.6), y: 0.55, height: 1.1, color: pick(), roughness: 0.9, metalness: 0, shape: 'box' });
    const yx = sx * q(9.5 + rng.next() * 1.5);
    const yz = sz * q(8 + rng.next() * 1);
    zones.push({ id: `q${qi}-barrel`, kind: 'prop', minX: q(yx - 0.6), maxX: q(yx + 0.6), minZ: q(yz - 0.6), maxZ: q(yz + 0.6), y: 0.7, height: 1.4, color: pick(), roughness: 0.85, metalness: 0.1, shape: 'cylinder' });
    const sxp = sx * q(10.5 + rng.next() * 1.5);
    const szp = sz * q(10.5 + rng.next() * 1);
    zones.push({ id: `q${qi}-ball`, kind: 'prop', minX: q(sxp - 0.6), maxX: q(sxp + 0.6), minZ: q(szp - 0.6), maxZ: q(szp + 0.6), y: 0.6, height: 1.2, color: rgb(pal.floor), roughness: 0.9, metalness: 0, shape: 'sphere' });
  }

  // ── Jardineras cilíndricas en las esquinas de la plaza (fuera del spawn |·|≤5.5) ──
  const planterCol = rgb(0x3f6b3a);
  for (let i = 0; i < 4; i++) {
    const sx = i & 1 ? 1 : -1;
    const sz = i & 2 ? 1 : -1;
    const px = sx * 6.6;
    const pz = sz * 6.6;
    zones.push({ id: `plaza-planter-${i}`, kind: 'prop', minX: q(px - 0.6), maxX: q(px + 0.6), minZ: q(pz - 0.6), maxZ: q(pz + 0.6), y: 0.55, height: 1.1, color: planterCol, roughness: 0.95, metalness: 0, shape: 'cylinder' });
  }

  return {
    id: `pueblo-${(seed >>> 0) || 1}`,
    bounds: { minX: -B, maxX: B, minY: 0, maxY: 5, minZ: -B, maxZ: B },
    floorColor: rgb(0xcfcabc),
    zones,
    spawns: [
      { x: -4, y: 0, z: -4 }, { x: 4, y: 0, z: -4 }, { x: -4, y: 0, z: 4 }, { x: 4, y: 0, z: 4 },
      { x: 0, y: 0, z: 0 }, { x: -2, y: 0, z: -2 }, { x: 2, y: 0, z: -2 }, { x: -2, y: 0, z: 2 },
      { x: 2, y: 0, z: 2 }, { x: 0, y: 0, z: -4 },
    ],
  };
}

/**
 * Mapa por defecto = pueblo con semilla 1. Se usa en el LOBBY (antes del primer
 * arranque), como fallback de los parámetros por defecto de `step`/`movement`, y en
 * tests. En partida, el mapa activo lo genera `generateMap(world.mapSeed)` (aleatorio
 * por ronda). Todos los consumidores deben preferir el mapa de la ronda cuando exista.
 */
export const DEFAULT_MAP: MapData = generateMap(1);
