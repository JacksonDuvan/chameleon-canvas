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
      roughness: 0.95,
      metalness: 0,
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
        roughness: 0.95,
        metalness: 0,
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
   * Empuja un muro ya fusionado CLAVADO DENTRO de los límites: los muros del
   * perímetro nacen centrados en la arista exterior (sobresaldrían 0.3 m de los
   * bounds). El clamp los deja a ras por dentro (grosor 0.3 ahí: visual y
   * colisión correctos, y la invariante "toda zona dentro de bounds" se mantiene).
   */
  const pushWall = (z: MapZone): void => {
    zones.push({
      ...z,
      minX: q(Math.max(z.minX, -W / 2)),
      maxX: q(Math.min(z.maxX, W / 2)),
      minZ: q(Math.max(z.minZ, -H / 2)),
      maxZ: q(Math.min(z.maxZ, H / 2)),
    });
  };
  // Verticales: arista entre (r,c)-(r,c+1), fusión por columna de arista.
  for (let c = 0; c < HOUSE_COLS - 1; c++) {
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
        minZ: q(cellZ0(r) - T / 2),
        maxZ: q(cellZ0(r2 + 1) + T / 2),
        y: 1.5,
        height: 3,
        color: wallColorFor(r, c, r, c + 1),
        roughness: 0.92,
        metalness: 0,
      });
      r = r2 + 1;
    }
  }
  // Horizontales: arista entre (r,c)-(r+1,c), fusión por fila de arista.
  for (let r = 0; r < HOUSE_ROWS - 1; r++) {
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
        minX: q(cellX0(c) - T / 2),
        maxX: q(cellX0(c2 + 1) + T / 2),
        minZ: q(z - T / 2),
        maxZ: q(z + T / 2),
        y: 1.5,
        height: 3,
        color: wallColorFor(r, c, r + 1, c),
        roughness: 0.92,
        metalness: 0,
      });
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

    // Galleta de pared (figureWall) montada en el muro IZQUIERDO del cuarto, si
    // ese muro existe (arista cerrada). ~55% de los cuartos.
    if (rng.next() < 0.55) {
      const c = room.c0;
      const rMid = Math.floor((room.r0 + room.r1) / 2);
      if (needWall(rMid, c, rMid, c - 1)) {
        const x = cellX0(c);
        zones.push({
          id: `room-${room.id}-cookie`,
          kind: 'prop',
          minX: q(x),
          maxX: q(x + 0.3),
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

/**
 * Mapa por defecto = casa con semilla 1. Se usa en el LOBBY (antes del primer
 * arranque), como fallback de los parámetros por defecto de `step`/`movement`, y en
 * tests. En partida, el mapa activo lo genera `generateMap(world.mapSeed)` (aleatorio
 * por ronda). Todos los consumidores deben preferir el mapa de la ronda cuando exista.
 */
export const DEFAULT_MAP: MapData = generateMap(1);
