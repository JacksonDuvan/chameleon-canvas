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

/** Mueble de oficina (pista de render; ver `MapZone.furniture`). */
export type FurnitureKind = 'cabinet' | 'desk' | 'terminal' | 'stool';

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
  /** Tipo de mueble de oficina (SOLO presentación: el cliente dibuja una malla
   *  detallada DENTRO del mismo AABB; colisión/oclusión/camuflaje no cambian). */
  readonly furniture?: FurnitureKind;
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
// Generador PROCEDURAL de la CASA (feedback del playtest r3: "mapa mucho más
// grande, no cuadrado, con pasillos y cuartos"). DETERMINISTA a partir de una
// semilla → cliente y servidor generan el MISMO mapa (requisito del netcode; el
// mapa no viaja entero, solo su `mapSeed` en el wire). Coordenadas CUANTIZADAS a
// 0.1 m contra deriva de coma flotante entre isolates.
//
// Arquitectura del generador (verdad compartida muros⇔puertas):
//  1. `generateHousePlan(seed)` — PLANO en rejilla de celdas de 4 m: anillo de
//     pasillo perimetral + cruz central (2 celdas), 4 bloques repartidos en
//     CUARTOS (guillotina), PUERTAS registradas como aristas abiertas, y
//     recortes de esquina que hacen la huella IRREGULAR (no cuadrada).
//  2. `isEdgeOpen(plan, …)` — UNA sola verdad de "¿se puede pasar entre dos
//     celdas?" que usan TANTO la emisión de muros como los tests de
//     conectividad (BFS): si un cuarto quedara sellado, el BFS lo caza.
//  3. `planToMapData` — el plano → zonas: suelos por cuarto/pasillo, muros por
//     aristas (con fusión de tramos), props de mimetismo por cuarto.
// Invariantes garantizadas (tests): bounds = SimConfig (80×64 m), huella
// irregular, ≥10 cuartos con ≥6 paletas, BFS conecta TODO el piso, spawn (hall
// central) libre de sólidos, ≥10 estatuas + ≥6 galletas + esfera/cilindro.
// ═══════════════════════════════════════════════════════════════════════════════

import { makeRng } from '../rng';

/** Cuantiza a rejilla de 0.1 m (determinismo cross-isolate). */
function q(v: number): number {
  return Math.round(v * 10) / 10;
}

/** Rejilla de la casa: celdas de 4 m; 20×16 celdas = 80×64 m = bounds del SimConfig. */
export const HOUSE_CELL = 4;
export const HOUSE_COLS = 20;
export const HOUSE_ROWS = 16;

/** Tipo de celda del plano. */
export const CELL_OUT = 0;
export const CELL_HALL = 1;
export const CELL_ROOM = 2;

/** Rectángulo de celdas de un cuarto + su paleta. */
export interface HouseRoom {
  readonly id: number;
  readonly r0: number;
  readonly r1: number;
  readonly c0: number;
  readonly c1: number;
  readonly palette: number;
}

export interface HousePlan {
  /** CELL_OUT | CELL_HALL | CELL_ROOM por celda (row-major, r*COLS+c). */
  readonly grid: Uint8Array;
  /** id del cuarto por celda (-1 si no es cuarto). */
  readonly roomId: Int16Array;
  /** Aristas VERTICALES abiertas (puertas) entre (r,c)-(r,c+1): clave r*100+c. */
  readonly doorsV: ReadonlySet<number>;
  /** Aristas HORIZONTALES abiertas (puertas) entre (r,c)-(r+1,c): clave r*100+c. */
  readonly doorsH: ReadonlySet<number>;
  readonly rooms: readonly HouseRoom[];
}

/** Celda del plano con guarda de borde (fuera de la rejilla = fuera de la casa). */
export function houseCell(plan: HousePlan, r: number, c: number): number {
  if (r < 0 || r >= HOUSE_ROWS || c < 0 || c >= HOUSE_COLS) return CELL_OUT;
  return plan.grid[r * HOUSE_COLS + c]!;
}

/**
 * ¿Se puede PASAR entre dos celdas ADYACENTES? La verdad ÚNICA de puertas y
 * muros: la emisión de zonas la consulta, y los tests de conectividad (BFS)
 * la recorren — si un cuarto quedara sellado, el BFS fallaría.
 */
export function isEdgeOpen(
  plan: HousePlan,
  r1: number,
  c1: number,
  r2: number,
  c2: number,
): boolean {
  const a = houseCell(plan, r1, c1);
  const b = houseCell(plan, r2, c2);
  if (a === CELL_OUT || b === CELL_OUT) return false;
  if (a === CELL_HALL && b === CELL_HALL) return true; // los pasillos siempre fluyen
  if (a === CELL_ROOM && b === CELL_ROOM) {
    const ra = plan.roomId[r1 * HOUSE_COLS + c1]!;
    const rb = plan.roomId[r2 * HOUSE_COLS + c2]!;
    if (ra === rb) return true; // interior del mismo cuarto
    // cuarto→cuarto distinto: cae al chequeo de puerta de abajo
  }
  if (c1 === c2) return plan.doorsH.has(Math.min(r1, r2) * 100 + c1);
  return plan.doorsV.has(r1 * 100 + Math.min(c1, c2));
}

/** Paletas de cuarto (suelo + muro + props): el camuflaje cambia por cuarto. */
const ROOM_PALETTES: ReadonlyArray<{ floor: number; wall: number; props: readonly number[] }> = [
  { floor: 0xb5563f, wall: 0xe8d9b5, props: [0xa04533, 0x96442f, 0x8a3b2e] }, // cocina terracota
  { floor: 0x2f6b6b, wall: 0x9fc4c4, props: [0x3a5f5f, 0x336666, 0x4c8f6a] }, // baño teal
  { floor: 0xc9a227, wall: 0xd7b45a, props: [0xb08a2a, 0x6b4a2b, 0x7d5a35] }, // sala mostaza
  { floor: 0x3a4a6b, wall: 0x6b7da3, props: [0x4a5a7a, 0x55688c, 0x46587a] }, // cuarto navy
  { floor: 0x6b3f6b, wall: 0xb59fc4, props: [0x7a4a7a, 0x8c5588, 0x5a3a6b] }, // estudio ciruela
  { floor: 0x3f6b3a, wall: 0xa8c49f, props: [0x4c8f4a, 0x357032, 0x5a7d35] }, // jardín bosque
  { floor: 0x8a6b4a, wall: 0xd7bfa0, props: [0x7d5a35, 0x6b4a2b, 0x9c7a52] }, // garaje roble
  { floor: 0x8f8f8f, wall: 0xd0d0d0, props: [0x7a7a7a, 0x696969, 0xa5a5a5] }, // lavadero gris
];

/** Colores de pasillo (rotan por tramo): madera, baldosa, alfombra. */
const HALL_FLOORS = [0x8a6b4a, 0xb5a99a, 0x9c8f7a] as const;
const HALL_WALL = 0x7a7069; // piedra de pasillo
const OUTER_WALL = 0x6e665f; // perímetro

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

/** Los 4 bloques de cuartos entre el anillo perimetral y la cruz central. */
const BLOCKS: ReadonlyArray<{ r0: number; r1: number; c0: number; c1: number }> = [
  { r0: 1, r1: 6, c0: 1, c1: 8 }, // NW
  { r0: 1, r1: 6, c0: 11, c1: 18 }, // NE
  { r0: 9, r1: 14, c0: 1, c1: 8 }, // SW
  { r0: 9, r1: 14, c0: 11, c1: 18 }, // SE
];

const DIRS: ReadonlyArray<readonly [number, number]> = [
  [0, 1],
  [0, -1],
  [1, 0],
  [-1, 0],
];

/**
 * Genera el PLANO de la casa (rejilla + cuartos + puertas). Determinista.
 * Exportado para los tests de conectividad (BFS) — es la misma verdad que
 * emite los muros en `planToMapData`.
 */
export function generateHousePlan(seed: number): HousePlan {
  const rng = makeRng((seed >>> 0) || 1);
  const M = HOUSE_COLS; // stride
  const grid = new Uint8Array(HOUSE_COLS * HOUSE_ROWS); // 0 = fuera
  const roomId = new Int16Array(HOUSE_COLS * HOUSE_ROWS).fill(-1);
  const doorsV = new Set<number>();
  const doorsH = new Set<number>();
  const rooms: HouseRoom[] = [];

  // ── 1) Esqueleto de PASILLOS: anillo perimetral + cruz central (2 celdas) ──
  const HR1 = (HOUSE_ROWS >> 1) - 1; // fila 7
  const HR2 = HOUSE_ROWS >> 1; // fila 8
  const HC1 = (HOUSE_COLS >> 1) - 1; // col 9
  const HC2 = HOUSE_COLS >> 1; // col 10
  for (let c = 0; c < HOUSE_COLS; c++) {
    grid[0 * M + c] = CELL_HALL;
    grid[(HOUSE_ROWS - 1) * M + c] = CELL_HALL;
    grid[HR1 * M + c] = CELL_HALL;
    grid[HR2 * M + c] = CELL_HALL;
  }
  for (let r = 0; r < HOUSE_ROWS; r++) {
    grid[r * M + 0] = CELL_HALL;
    grid[r * M + (HOUSE_COLS - 1)] = CELL_HALL;
    grid[r * M + HC1] = CELL_HALL;
    grid[r * M + HC2] = CELL_HALL;
  }

  // ── 2) Huella IRREGULAR (no cuadrada) ──
  // 2a) Se TIRA un ala completa: un bloque de esquina deja de existir (la casa
  //     queda en L/U según la semilla) y se retiran los tramos de anillo que lo
  //     rodeaban (la esquina queda al aire: la huella REALLY no es un rectángulo).
  const droppedCorner = rng.nextInt(4); // 0=NW 1=NE 2=SW 3=SE
  {
    const cEnd = (droppedCorner & 1) === 1 ? HOUSE_COLS - 1 : 0;
    const rEnd = (droppedCorner & 2) === 2 ? HOUSE_ROWS - 1 : 0;
    const blk = BLOCKS[droppedCorner]!;
    // Tramos de anillo adyacentes al ala caída (fila y columna del rincón).
    for (let c = 0; c < HOUSE_COLS; c++) {
      const inDroppedRow = cEnd === 0 ? c <= blk.c1 : c >= blk.c0;
      if (inDroppedRow) grid[rEnd * M + c] = CELL_OUT;
    }
    for (let r = 0; r < HOUSE_ROWS; r++) {
      const inDroppedCol = rEnd === 0 ? r <= blk.r1 : r >= blk.r0;
      if (inDroppedCol) grid[r * M + cEnd] = CELL_OUT;
    }
    // La intersección de la cruz junto al ala caída queda en cul-de-sac: se
    // recorta el stub del anillo que la cerraba para que "mueran" con gracia.
  }
  // 2b) Recortes en L adicionales en OTRAS esquinas (nicks de perímetro).
  const cuts = 2 + rng.nextInt(3); // 2..4 esquinas
  const cornerOrder = shuffled(
    [0, 1, 2, 3].filter((k) => k !== droppedCorner),
    rng,
  );
  for (let k = 0; k < Math.min(cuts, cornerOrder.length); k++) {
    const corner = cornerOrder[k]!;
    const cEnd = (corner & 1) === 1 ? HOUSE_COLS - 1 : 0;
    const rEnd = (corner & 2) === 2 ? HOUSE_ROWS - 1 : 0;
    const lenC = 2 + rng.nextInt(3);
    const lenR = 2 + rng.nextInt(3);
    for (let i = 0; i < lenC; i++) {
      const c = cEnd + (cEnd === 0 ? i : -i);
      grid[rEnd * M + c] = CELL_OUT;
    }
    for (let i = 0; i < lenR; i++) {
      const r = rEnd + (rEnd === 0 ? i : -i);
      grid[r * M + cEnd] = CELL_OUT;
    }
  }

  // ── 3) Bloques (menos el ala caída) → CUARTOS por guillotina (mín 2×2) ──
  let nextRoomId = 0;
  const paletteOrder = shuffled(
    ROOM_PALETTES.map((_, i) => i),
    rng,
  );
  const splitBlock = (r0: number, r1: number, c0: number, c1: number): void => {
    const w = c1 - c0 + 1;
    const h = r1 - r0 + 1;
    const canV = w >= 4;
    const canH = h >= 4;
    if ((w < 4 && h < 4) || w * h <= 6) {
      // Hoja: registra el cuarto con su paleta.
      const id = nextRoomId++;
      rooms.push({ id, r0, r1, c0, c1, palette: paletteOrder[id % paletteOrder.length]! });
      for (let r = r0; r <= r1; r++) {
        for (let c = c0; c <= c1; c++) {
          grid[r * M + c] = CELL_ROOM;
          roomId[r * M + c] = id;
        }
      }
      return;
    }
    if (canV && (!canH || w >= h)) {
      const cut = c0 + 2 + rng.nextInt(w - 3); // ambos lados ≥2
      splitBlock(r0, r1, c0, cut);
      splitBlock(r0, r1, cut + 1, c1);
    } else {
      const cut = r0 + 2 + rng.nextInt(h - 3);
      splitBlock(r0, cut, c0, c1);
      splitBlock(cut + 1, r1, c0, c1);
    }
  };
  for (const b of BLOCKS) {
    if (BLOCKS.indexOf(b) === droppedCorner) continue; // ala caída: sin cuartos
    splitBlock(b.r0, b.r1, b.c0, b.c1);
  }

  // ── 4) PUERTAS: 1-2 por cuarto, preferencia al PASILLO; si no, cuarto vecino ──
  for (const room of rooms) {
    const plan: HousePlan = { grid, roomId, doorsV, doorsH, rooms };
    type Cand = { key: number; vertical: boolean; hall: boolean };
    const seen = new Set<string>();
    const candidates: Cand[] = [];
    for (let r = room.r0; r <= room.r1; r++) {
      for (let c = room.c0; c <= room.c1; c++) {
        for (const dir of DIRS) {
          const r2 = r + dir[0];
          const c2 = c + dir[1];
          const nb = houseCell(plan, r2, c2);
          if (nb === CELL_OUT) continue;
          const vertical = dir[1] !== 0;
          const key = vertical
            ? r * 100 + Math.min(c, c2) // arista V en (r, min(c,c2))
            : Math.min(r, r2) * 100 + c; // arista H en (min(r,r2), c)
          const dedupe = `${vertical ? 'V' : 'H'}${key}`;
          if (seen.has(dedupe)) continue;
          // La arista debe separar este cuarto del vecino (no atravesar el cuarto).
          const nbRoomId = plan.roomId[(vertical ? r2 : r2) * M + c2]!;
          const inThisRoom = (rr: number, cc: number): boolean =>
            rr >= room.r0 && rr <= room.r1 && cc >= room.c0 && cc <= room.c1;
          if (inThisRoom(r, c) && inThisRoom(r2, c2)) continue; // interior del rect
          if (nb === CELL_ROOM && nbRoomId === room.id) continue;
          seen.add(dedupe);
          candidates.push({ key, vertical, hall: nb === CELL_HALL });
        }
      }
    }
    const hallCands = candidates.filter((cd) => cd.hall);
    const roomCands = shuffled(
      candidates.filter((cd) => !cd.hall),
      rng,
    );
    const pool = hallCands.length > 0 ? shuffled(hallCands, rng) : roomCands;
    const doorCount = Math.min(pool.length, 1 + (rng.nextInt(3) === 0 ? 1 : 0));
    for (let i = 0; i < doorCount; i++) {
      const cd = pool[i]!;
      if (cd.vertical) doorsV.add(cd.key);
      else doorsH.add(cd.key);
    }
  }

  return { grid, roomId, doorsV, doorsH, rooms };
}

/**
 * Genera la CASA (80×64 m: anillo + cruz + 10-20 cuartos con puertas, paletas
 * propias y props de mimetismo) para `seed`. Mismo seed ⇒ mismo mapa, byte a byte.
 */
export function generateMap(seed: number): MapData {
  return planToMapData(generateHousePlan(seed), seed);
}

/** El plano → zonas del mapa (suelos, muros fusionados por tramos, props, spawns). */
function planToMapData(plan: HousePlan, seed: number): MapData {
  const zones: MapZone[] = [];
  const M = HOUSE_COLS;
  const W = HOUSE_COLS * HOUSE_CELL; // 80 m
  const H = HOUSE_ROWS * HOUSE_CELL; // 64 m
  const cellX0 = (c: number): number => c * HOUSE_CELL - W / 2;
  const cellZ0 = (r: number): number => r * HOUSE_CELL - H / 2;
  const T = 0.6; // grosor de muro
  /**
   * Extensión de los extremos de un muro a lo largo de SU eje para sellar
   * esquinas: t/2−0.1 (no t/2). Con t/2 la cara del tope quedaba COPLANARIA con
   * la cara lateral del muro perpendicular (z-fighting: "las paredes
   * parpadean", playtest r4); con 0.1 menos, cada tope queda a 1 cm del muro
   * vecino: esquina sellada, cero caras coplanarias (test de regresión).
   */
  const EXT = T / 2 - 0.1;
  const rng = makeRng((seed >>> 0) || 1);

  // ── Suelos: un rect por CUARTO (color propio de su paleta) ──
  for (const room of plan.rooms) {
    const pal = ROOM_PALETTES[room.palette]!;
    zones.push({
      id: `room-floor-${room.id}`,
      kind: 'floor',
      minX: q(cellX0(room.c0)),
      maxX: q(cellX0(room.c1 + 1)),
      minZ: q(cellZ0(room.r0)),
      maxZ: q(cellZ0(room.r1 + 1)),
      y: 0.01,
      height: 0,
      color: rgb(pal.floor),
      // Pulido sutil (spec r4): refleja las luces de techo con metalness 0.1.
      roughness: 0.3,
      metalness: 0.1,
    });
  }

  // ── Suelos: pasillos por TRAMOS horizontales (color rotando) ──
  let hallRun = 0;
  for (let r = 0; r < HOUSE_ROWS; r++) {
    let c = 0;
    while (c < HOUSE_COLS) {
      if (plan.grid[r * M + c] !== CELL_HALL) {
        c++;
        continue;
      }
      let c2 = c;
      while (c2 + 1 < HOUSE_COLS && plan.grid[r * M + c2 + 1] === CELL_HALL) c2++;
      zones.push({
        id: `hall-floor-${hallRun}`,
        kind: 'floor',
        minX: q(cellX0(c)),
        maxX: q(cellX0(c2 + 1)),
        minZ: q(cellZ0(r)),
        maxZ: q(cellZ0(r + 1)),
        y: 0.01,
        height: 0,
        color: rgb(HALL_FLOORS[hallRun % HALL_FLOORS.length]!),
        roughness: 0.3, // pulido (spec r4)
        metalness: 0.1,
      });
      hallRun++;
      c = c2 + 1;
    }
  }

  // ── Muros por ARISTAS cerradas, con FUSIÓN de tramos consecutivos ──
  /** ¿Hace falta muro entre dos celdas? (hay piso y no se puede pasar) */
  const needWall = (r1: number, c1: number, r2: number, c2: number): boolean => {
    const a = houseCell(plan, r1, c1);
    const b = houseCell(plan, r2, c2);
    if (a === CELL_OUT && b === CELL_OUT) return false;
    if (a === CELL_OUT || b === CELL_OUT) return true; // perímetro de la huella
    return !isEdgeOpen(plan, r1, c1, r2, c2);
  };
  /** Color del muro: paleta del cuarto que toca; piedra para pasillos/perímetro. */
  const wallColorFor = (r1: number, c1: number, r2: number, c2: number): number => {
    for (const rc of [
      [r1, c1],
      [r2, c2],
    ]) {
      const r = rc[0]!;
      const c = rc[1]!;
      if (houseCell(plan, r, c) === CELL_ROOM) {
        const id = plan.roomId[r * M + c]!;
        const room = plan.rooms.find((rm) => rm.id === id);
        if (room) return rgb(ROOM_PALETTES[room.palette]!.wall);
      }
    }
    const hallTouch =
      houseCell(plan, r1, c1) === CELL_HALL || houseCell(plan, r2, c2) === CELL_HALL;
    return rgb(hallTouch ? HALL_WALL : OUTER_WALL);
  };
  /**
   * Empuja un muro ya fusionado CLAVADO DENTRO de los límites, con noción de eje
   * (anti z-fighting del playtest r4):
   *  - El GROSOR (perpendicular al eje largo) clava su cara exterior A RAS del
   *    bound (sobresaldría 0.3 m).
   *  - Las TAPAS (extremos del eje largo) se meten CAP_EPS (5 cm) hacia dentro
   *    cuando recortan con el bound: si no, la tapa del muro horizontal y la
   *    cara del muro perimetral vertical acabarían AMBAS exactamente en el
   *    bound ⇒ caras coplanarias solapadas en CADA esquina ⇒ parpadeo.
   *    Con 5 cm de margen la esquina sigue sellada (el muro perpendicular cubre
   *    el rinconcín) y no hay dos caras en el mismo plano.
   */
  const CAP_EPS = 0.1; // múltiplo de 0.1: sobrevive a q() (0.05 es caso .5 y q lo borra)
  const pushWall = (z: MapZone, along: 'x' | 'z'): void => {
    const lo = (v: number, bound: number): number => (v < bound ? q(bound + CAP_EPS) : v);
    const hi = (v: number, bound: number): number => (v > bound ? q(bound - CAP_EPS) : v);
    if (along === 'z') {
      // muro vertical: eje largo en z, grosor en x
      zones.push({
        ...z,
        minX: q(Math.max(z.minX, -W / 2)),
        maxX: q(Math.min(z.maxX, W / 2)),
        minZ: lo(z.minZ, -H / 2),
        maxZ: hi(z.maxZ, H / 2),
      });
    } else {
      zones.push({
        ...z,
        minX: lo(z.minX, -W / 2),
        maxX: hi(z.maxX, W / 2),
        minZ: q(Math.max(z.minZ, -H / 2)),
        maxZ: q(Math.min(z.maxZ, H / 2)),
      });
    }
  };
  // Verticales: arista entre (r,c)-(r,c+1), fusión por columna de arista. El rango
  // c ∈ [-1, COLS) INCLUYE las aristas del BORDE de la rejilla (celda|fuera): sin
  // ellas la casa quedaba ABIERTA en su contorno (regresión del playtest r4).
  for (let c = -1; c < HOUSE_COLS; c++) {
    let r = 0;
    while (r < HOUSE_ROWS) {
      if (!needWall(r, c, r, c + 1)) {
        r++;
        continue;
      }
      let r2 = r;
      while (r2 + 1 < HOUSE_ROWS && needWall(r2 + 1, c, r2 + 1, c + 1)) r2++;
      const x = cellX0(c + 1);
      pushWall({
        id: `wall-v-${c}-${r}`,
        kind: 'wall',
        minX: q(x - T / 2),
        maxX: q(x + T / 2),
        minZ: q(cellZ0(r) - EXT),
        maxZ: q(cellZ0(r2 + 1) + EXT),
        y: 1.5,
        height: 3,
        color: wallColorFor(r, c, r, c + 1),
        roughness: 0.8, // mate (spec visual r4)
        metalness: 0,
      }, 'z');
      r = r2 + 1;
    }
  }
  // Horizontales: arista entre (r,c)-(r+1,c), fusión por fila de arista. El rango
  // r ∈ [-1, ROWS) incluye el borde N y S de la rejilla.
  for (let r = -1; r < HOUSE_ROWS; r++) {
    let c = 0;
    while (c < HOUSE_COLS) {
      if (!needWall(r, c, r + 1, c)) {
        c++;
        continue;
      }
      let c2 = c;
      while (c2 + 1 < HOUSE_COLS && needWall(r, c2 + 1, r + 1, c2 + 1)) c2++;
      const z = cellZ0(r + 1);
      pushWall({
        id: `wall-h-${r}-${c}`,
        kind: 'wall',
        minX: q(cellX0(c) - EXT),
        maxX: q(cellX0(c2 + 1) + EXT),
        minZ: q(z - T / 2),
        maxZ: q(z + T / 2),
        y: 1.5,
        height: 3,
        color: wallColorFor(r, c, r + 1, c),
        roughness: 0.8, // mate (spec visual r4)
        metalness: 0,
      }, 'x');
      c = c2 + 1;
    }
  }

  // ── Props de MIMETISMO por cuarto (estatua + caja + barril + bola) ──
  for (const room of plan.rooms) {
    const pal = ROOM_PALETTES[room.palette]!;
    const pick = (): number => rgb(pal.props[rng.nextInt(pal.props.length)]!);
    const cells: Array<[number, number]> = [];
    for (let r = room.r0; r <= room.r1; r++) {
      for (let c = room.c0; c <= room.c1; c++) cells.push([r, c]);
    }
    // Centro de celda con jitter determinista. Los props NUNCA tapan puertas:
    // están a ≥2 m de las aristas de su celda y una puerta es una arista COMPLETA.
    const center = (r: number, c: number): { x: number; z: number } => ({
      x: q(cellX0(c) + HOUSE_CELL / 2 + (rng.next() * 2 - 1) * 1.1),
      z: q(cellZ0(r) + HOUSE_CELL / 2 + (rng.next() * 2 - 1) * 1.1),
    });
    const shapes: Array<'figure' | 'box' | 'cylinder' | 'sphere'> = [
      'figure',
      'box',
      'cylinder',
      'sphere',
    ];
    if (cells.length >= 9) shapes.push('figure');
    if (cells.length >= 12) shapes.push('box');
    const used = new Set<number>();
    for (let i = 0; i < Math.min(shapes.length, cells.length); i++) {
      let idx = (i * 3 + 1) % cells.length; // reparte por el cuarto sin repetir
      while (used.has(idx)) idx = (idx + 1) % cells.length;
      used.add(idx);
      const cell = cells[idx]!;
      const { x, z } = center(cell[0], cell[1]);
      const shape = shapes[i]!;
      if (shape === 'figure') {
        zones.push({ id: `room-${room.id}-statue-${i}`, kind: 'prop', minX: q(x - 0.45), maxX: q(x + 0.45), minZ: q(z - 0.45), maxZ: q(z + 0.45), y: 0.85, height: 1.7, color: rgb(pal.floor), roughness: 0.9, metalness: 0, shape: 'figure', rot: (rng.nextInt(4) as 0 | 1 | 2 | 3) });
      } else if (shape === 'box') {
        zones.push({ id: `room-${room.id}-crate-${i}`, kind: 'prop', minX: q(x - 0.6), maxX: q(x + 0.6), minZ: q(z - 0.6), maxZ: q(z + 0.6), y: 0.55, height: 1.1, color: pick(), roughness: 0.9, metalness: 0, shape: 'box' });
      } else if (shape === 'cylinder') {
        zones.push({ id: `room-${room.id}-barrel-${i}`, kind: 'prop', minX: q(x - 0.6), maxX: q(x + 0.6), minZ: q(z - 0.6), maxZ: q(z + 0.6), y: 0.7, height: 1.4, color: pick(), roughness: 0.85, metalness: 0.1, shape: 'cylinder' });
      } else {
        zones.push({ id: `room-${room.id}-ball-${i}`, kind: 'prop', minX: q(x - 0.6), maxX: q(x + 0.6), minZ: q(z - 0.6), maxZ: q(z + 0.6), y: 0.6, height: 1.2, color: rgb(pal.floor), roughness: 0.9, metalness: 0, shape: 'sphere' });
      }
    }

    // ── Oficina low-poly (spec r4): archivadores, mesas, terminales y taburetes
    // en las ESQUINAS de las celdas del cuarto (offset diagonal ±1.05: no pisan
    // las estatuas/señuelos centrales —distancia 1.48 > 0.6+0.8— ni las puertas,
    // que son aristas completas de celda y quedan a ≥0.2 m). Geometría NATIVA
    // (Box/Cylinder) vía 'box'/'cylinder': cero cambios de wire/render. Son
    // SÓLIDOS: el servidor los conoce (oclusión de disparos, camuflaje al
    // abrazarlos, anti-cheat).
    const OFFICE = {
      cabinet: { w: 0.9, h: 2.1, d: 0.7, color: 0x6b7280, rough: 0.8, metal: 0 },
      desk: { w: 1.6, h: 0.75, d: 0.8, color: 0x8a6b4a, rough: 0.7, metal: 0 },
      terminal: { w: 0.6, h: 1.4, d: 0.5, color: 0x3d4450, rough: 0.5, metal: 0.3 },
      stool: { w: 0.6, h: 0.9, d: 0.6, color: 0x44506b, rough: 0.85, metal: 0 },
    } as const;
    const officeKinds = ['cabinet', 'desk', 'terminal', 'stool'] as const;
    const CORNER: ReadonlyArray<readonly [number, number]> = [
      [-1.05, -1.05], [1.05, -1.05], [-1.05, 1.05], [1.05, 1.05],
    ];
    const maxOffice = cells.length >= 9 ? 5 : 3;
    let office = 0;
    for (let k = 0; k < cells.length && office < maxOffice; k++) {
      if (rng.next() < 0.35) continue; // deja aire: no todas las celdas
      const cell = cells[k]!;
      const corner = CORNER[office % CORNER.length]!;
      const fx = q(cellX0(cell[1]) + HOUSE_CELL / 2 + corner[0]);
      const fz = q(cellZ0(cell[0]) + HOUSE_CELL / 2 + corner[1]);
      const kind = officeKinds[office % officeKinds.length]!;
      const spec = OFFICE[kind];
      if (kind === 'stool') {
        zones.push({ id: `room-${room.id}-stool-${office}`, kind: 'prop', minX: q(fx - spec.w / 2), maxX: q(fx + spec.w / 2), minZ: q(fz - spec.d / 2), maxZ: q(fz + spec.d / 2), y: q(spec.h / 2), height: spec.h, color: rgb(spec.color), roughness: spec.rough, metalness: spec.metal, shape: 'cylinder', furniture: kind });
      } else {
        zones.push({ id: `room-${room.id}-${kind}-${office}`, kind: 'prop', minX: q(fx - spec.w / 2), maxX: q(fx + spec.w / 2), minZ: q(fz - spec.d / 2), maxZ: q(fz + spec.d / 2), y: q(spec.h / 2), height: spec.h, color: rgb(spec.color), roughness: spec.rough, metalness: spec.metal, shape: 'box', furniture: kind });
      }
      office++;
    }

    // Galleta de pared (figureWall) montada en el muro IZQUIERDO del cuarto, si
    // ese muro existe (arista cerrada). ~55% de los cuartos. Offsets en MÚLTIPLOS
    // de 0.1 elegidos para que sus caras NUNCA caigan en el plano de una cara del
    // muro (x±0.3): x+0.2 queda empotrada 10 cm y x+0.5 sobresale 20 cm al cuarto
    // (z-fighting del playtest r4: q() redondea .5 hacia arriba y clavaba la cara
    // trasera EXACTAMENTE en la cara del muro).
    if (rng.next() < 0.55) {
      const c = room.c0;
      const rMid = Math.floor((room.r0 + room.r1) / 2);
      if (needWall(rMid, c, rMid, c - 1)) {
        const x = cellX0(c);
        zones.push({
          id: `room-${room.id}-cookie`,
          kind: 'prop',
          minX: q(x + 0.2),
          maxX: q(x + 0.5),
          minZ: q(cellZ0(rMid) + HOUSE_CELL / 2 - 0.45),
          maxZ: q(cellZ0(rMid) + HOUSE_CELL / 2 + 0.45),
          y: 1.25,
          height: 1.5,
          color: pick(),
          roughness: 0.9,
          metalness: 0,
          shape: 'figureWall',
          rot: rng.nextInt(4) as 0 | 1 | 2 | 3,
        });
      }
    }
  }

  // ── Anti z-fighting (playtest r4): post-pase determinista ──
  // Los props con jitter pueden caer con una cara EXACTAMENTE en el plano de un
  // muro (q() redondea .5 hacia +∞) ⇒ shimmer al renderizar. Se recorren los
  // pares sólidos y a todo PROP coplanario con algo se le aplica un nudge de 0.1
  // en el eje conflictivo, ALEJÁNDOSE del otro sólido. Rejilla de 0.1 intacta,
  // movimiento ≤0.4 m (los props viven a ≥0.75 m de puertas y a ≥1.4 m de los
  // muros: el nudge jamás sella un paso ni pisa el spawn). Camino FRÍO, una vez
  // por ronda; máx 4 pases.
  deplanarizeProps(zones);

  return {
    id: `casa-${(seed >>> 0) || 1}`,
    bounds: { minX: -W / 2, maxX: W / 2, minY: 0, maxY: 5, minZ: -H / 2, maxZ: H / 2 },
    floorColor: rgb(0xcfcabc),
    zones,
    // Spawn: intersección de la cruz (hall central 8×8 m, libre de sólidos).
    spawns: [
      { x: 0, y: 0, z: 0 },
      { x: -2.8, y: 0, z: 0 },
      { x: 2.8, y: 0, z: 0 },
      { x: 0, y: 0, z: -2.8 },
      { x: 0, y: 0, z: 2.8 },
      { x: -2.8, y: 0, z: -2.8 },
      { x: 2.8, y: 0, z: -2.8 },
      { x: -2.8, y: 0, z: 2.8 },
      { x: 2.8, y: 0, z: 2.8 },
      { x: 1.4, y: 0, z: 1.4 },
    ],
  };
}

/** Verdad del post-pase: ¿las caras X (o Z) de a y b son coplanarias y solapadas? */
function coplanarAxis(
  a: MapZone,
  b: MapZone,
  axis: 'x' | 'z',
): boolean {
  const EPS = 1e-4;
  const yOverlap = Math.min(zoneYMax(a), zoneYMax(b)) - Math.max(zoneYMin(a), zoneYMin(b));
  if (yOverlap <= EPS) return false;
  const [aLo, aHi, bLo, bHi] =
    axis === 'x' ? [a.minX, a.maxX, b.minX, b.maxX] : [a.minZ, a.maxZ, b.minZ, b.maxZ];
  const faces: Array<[number, number]> = [
    [aLo, bLo], [aLo, bHi], [aHi, bLo], [aHi, bHi],
  ];
  for (const [pa, pb] of faces) {
    if (Math.abs(pa - pb) > EPS) continue;
    if (axis === 'x') {
      const ov = Math.min(a.maxZ, b.maxZ) - Math.max(a.minZ, b.minZ);
      if (ov > EPS) return true;
    } else {
      const ov = Math.min(a.maxX, b.maxX) - Math.max(a.minX, b.minX);
      if (ov > EPS) return true;
    }
  }
  return false;
}

/** Nudge determinista de props coplanarios (ver bloque de llamada). */
function deplanarizeProps(zones: MapZone[]): void {
  for (let pass = 0; pass < 4; pass++) {
    let moved = false;
    for (let i = 0; i < zones.length; i++) {
      const a = zones[i]!;
      if (a.kind !== 'prop') continue; // la estructura (muros) no se toca
      for (let j = 0; j < zones.length; j++) {
        if (i === j) continue;
        const b = zones[j]!;
        if (!isSolidZone(b)) continue;
        let axis: 'x' | 'z' | null = null;
        if (coplanarAxis(a, b, 'x')) axis = 'x';
        else if (coplanarAxis(a, b, 'z')) axis = 'z';
        if (axis === null) continue;
        // Separa ALEJÁNDOLO del otro sólido (según centros) — 0.1 en la rejilla.
        if (axis === 'x') {
          const dir = (a.minX + a.maxX) / 2 >= (b.minX + b.maxX) / 2 ? 0.1 : -0.1;
          zones[i] = { ...a, minX: q(a.minX + dir), maxX: q(a.maxX + dir) };
        } else {
          const dir = (a.minZ + a.maxZ) / 2 >= (b.minZ + b.maxZ) / 2 ? 0.1 : -0.1;
          zones[i] = { ...a, minZ: q(a.minZ + dir), maxZ: q(a.maxZ + dir) };
        }
        moved = true;
        break; // re-evalúa este prop desde el principio en el siguiente pase
      }
    }
    if (!moved) return;
  }
}

/**
 * Mapa por defecto = casa con semilla 1. Se usa en el LOBBY (antes del primer
 * arranque), como fallback de los parámetros por defecto de `step`/`movement`, y en
 * tests. En partida, el mapa activo lo genera `generateMap(world.mapSeed)` (aleatorio
 * por ronda). Todos los consumidores deben preferir el mapa de la ronda cuando exista.
 */
export const DEFAULT_MAP: MapData = generateMap(1);
