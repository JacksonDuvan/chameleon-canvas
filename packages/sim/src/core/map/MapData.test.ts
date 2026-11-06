import { describe, it, expect } from 'vitest';
import {
  DEFAULT_MAP,
  generateMap,
  generateHousePlan,
  houseCell,
  isEdgeOpen,
  isSolidZone,
  referenceColorAt,
  zoneYMin,
  zoneYMax,
  CELL_OUT,
  CELL_ROOM,
  HOUSE_CELL,
  HOUSE_COLS,
  HOUSE_ROWS,
  type MapData,
} from './MapData';
import { ColorRGBA } from '../value-objects/ColorRGBA';
import { DEFAULT_SIM_CONFIG } from '../config';
import { initialWorld } from '../entities/WorldState';
import { spawnPlayer } from '../phases';

/** Empaqueta 0..255 a 0xRRGGBBAA (alpha 255), como los colores de zona. */
function pack(r: number, g: number, b: number): number {
  return (((r << 24) | (g << 16) | (b << 8) | 0xff) >>> 0) as number;
}

// Mapa sintético con control total de la geometría para probar el algoritmo.
const M: MapData = {
  id: 'test',
  bounds: { minX: -10, maxX: 10, minY: 0, maxY: 5, minZ: -10, maxZ: 10 },
  floorColor: pack(1, 2, 3),
  zones: [
    // suelo izquierdo (x -10..0)
    { id: 'f1', kind: 'floor', minX: -10, maxX: 0, minZ: -10, maxZ: 10, y: 0, height: 0, color: pack(10, 20, 30), roughness: 1, metalness: 0 },
    // suelo derecho (x 0..10) que SOLAPA con el prop 'box' para probar prioridad
    { id: 'f2', kind: 'floor', minX: 0, maxX: 10, minZ: -10, maxZ: 10, y: 0, height: 0, color: pack(9, 9, 9), roughness: 1, metalness: 0 },
    // prop en la esquina derecha
    { id: 'box', kind: 'prop', minX: 4, maxX: 6, minZ: 4, maxZ: 6, y: 1, height: 2, color: pack(200, 100, 50), roughness: 1, metalness: 0 },
  ],
  spawns: [],
};

describe('referenceColorAt', () => {
  it('devuelve el color de la zona de suelo que contiene el punto', () => {
    const out = new ColorRGBA();
    referenceColorAt(M, -5, 0, out);
    expect([out.r, out.g, out.b]).toEqual([10, 20, 30]);
  });

  it('un prop/muro tiene prioridad sobre la zona de suelo que solapa', () => {
    const out = new ColorRGBA();
    referenceColorAt(M, 5, 5, out); // dentro de f2 Y de box
    expect([out.r, out.g, out.b]).toEqual([200, 100, 50]);
  });

  it('cuenta como "pegado" a un prop dentro de un pequeño margen', () => {
    const out = new ColorRGBA();
    referenceColorAt(M, 6.5, 6.5, out); // fuera del box pero dentro del margen de abrazo
    expect([out.r, out.g, out.b]).toEqual([200, 100, 50]);
  });

  it('cae al color base del suelo fuera de toda zona', () => {
    const out = new ColorRGBA();
    referenceColorAt(M, 9.5, 9.5, out); // en f2 pero lejos del box... corregir: usar punto sin zona
    // (9.5,9.5) está dentro de f2; para probar el fallback usamos un mapa sin suelos:
    const empty: MapData = { ...M, zones: [] };
    referenceColorAt(empty, 9.5, 9.5, out);
    expect([out.r, out.g, out.b]).toEqual([1, 2, 3]);
  });

  it('es determinista y sin asignaciones (reutiliza y devuelve `out`)', () => {
    const out = new ColorRGBA();
    const ret = referenceColorAt(M, -5, 0, out);
    expect(ret).toBe(out); // no asigna: escribe y devuelve el mismo objeto
    const first = [out.r, out.g, out.b];
    referenceColorAt(M, -5, 0, out);
    expect([out.r, out.g, out.b]).toEqual(first);
  });
});

describe('DEFAULT_MAP', () => {
  it('ofrece al menos 4 colores de superficie claramente distintos (Hecho cuando de P0.1)', () => {
    const colors = new Set<number>([DEFAULT_MAP.floorColor]);
    for (const z of DEFAULT_MAP.zones) colors.add(z.color);
    expect(colors.size).toBeGreaterThanOrEqual(4);
  });

  it('tiene al menos una zona de suelo y al menos un prop/muro', () => {
    const kinds = new Set(DEFAULT_MAP.zones.map((z) => z.kind));
    expect(kinds.has('floor')).toBe(true);
    expect(kinds.has('prop') || kinds.has('wall')).toBe(true);
  });

  it('todas las zonas caben dentro de los límites del escenario', () => {
    const b = DEFAULT_MAP.bounds;
    for (const z of DEFAULT_MAP.zones) {
      expect(z.minX).toBeGreaterThanOrEqual(b.minX);
      expect(z.maxX).toBeLessThanOrEqual(b.maxX);
      expect(z.minZ).toBeGreaterThanOrEqual(b.minZ);
      expect(z.maxZ).toBeLessThanOrEqual(b.maxZ);
    }
  });

  it('el servidor conoce un color de referencia para cualquier punto del mapa', () => {
    const out = new ColorRGBA();
    // barrido grueso: nunca debe fallar ni dejar el color sin definir
    for (let x = DEFAULT_MAP.bounds.minX; x <= DEFAULT_MAP.bounds.maxX; x += 5) {
      for (let z = DEFAULT_MAP.bounds.minZ; z <= DEFAULT_MAP.bounds.maxZ; z += 5) {
        const ret = referenceColorAt(DEFAULT_MAP, x, z, out);
        expect(ret).toBe(out);
        expect(out.a).toBe(255);
      }
    }
  });
});

describe('generateMap — CASA procedural: pasillos + cuartos, grande e irregular (playtest r3)', () => {
  // Muestreo de semillas variadas para los tests de invariantes.
  const SEEDS = [1, 2, 3, 7, 42, 100, 999, 123456, 0xdeadbeef, 0];

  it('DETERMINISTA: el mismo seed produce un mapa IDÉNTICO (byte a byte)', () => {
    // El requisito clave del netcode: cliente y servidor generan el mismo mapa desde
    // el mapSeed del wire. Comparación estructural profunda (JSON estable).
    for (const s of SEEDS) {
      expect(JSON.stringify(generateMap(s))).toEqual(JSON.stringify(generateMap(s)));
    }
  });

  it('coordenadas cuantizadas a 0.1 m (sin deriva de coma flotante entre isolates)', () => {
    for (const z of generateMap(42).zones) {
      for (const v of [z.minX, z.maxX, z.minZ, z.maxZ]) {
        expect(Math.abs(Math.round(v * 10) - v * 10)).toBeLessThan(1e-6);
      }
    }
  });

  it('semillas distintas producen mapas distintos (de verdad cambia por ronda)', () => {
    const a = JSON.stringify(generateMap(1));
    const distintos = SEEDS.slice(1).filter((s) => JSON.stringify(generateMap(s)) !== a);
    expect(distintos.length).toBeGreaterThanOrEqual(SEEDS.length - 2);
  });

  it('DEFAULT_MAP === generateMap(1) (mismo mapa de lobby/fallback)', () => {
    expect(JSON.stringify(DEFAULT_MAP)).toEqual(JSON.stringify(generateMap(1)));
  });

  // ── Invariantes que DEBEN cumplirse para CUALQUIER semilla ──
  for (const seed of SEEDS) {
    describe(`invariantes @ seed=${seed}`, () => {
      const map = generateMap(seed);

      it('bounds = SimConfig y CASA GRANDE (≥76×60 m)', () => {
        expect(map.bounds).toEqual(DEFAULT_SIM_CONFIG.bounds);
        expect(map.bounds.maxX - map.bounds.minX).toBeGreaterThanOrEqual(76);
        expect(map.bounds.maxZ - map.bounds.minZ).toBeGreaterThanOrEqual(60);
      });

      it('toda zona cabe dentro de los límites', () => {
        for (const z of map.zones) {
          expect(z.minX).toBeGreaterThanOrEqual(map.bounds.minX);
          expect(z.maxX).toBeLessThanOrEqual(map.bounds.maxX);
          expect(z.minZ).toBeGreaterThanOrEqual(map.bounds.minZ);
          expect(z.maxZ).toBeLessThanOrEqual(map.bounds.maxZ);
        }
      });

      it('NO cuadrado: la huella es irregular (recortes de esquina del anillo)', () => {
        // El plano de la casa dice qué celdas son "fuera": debe haber celdas OUT
        // en el BORDE de la rejilla (esquinas recortadas) y la huella no llena el
        // rectángulo de bounds.
        const plan = generateHousePlan(seed);
        const edge = [...plan.rooms].reduce((acc, rm) => acc + (rm.c1 - rm.c0 + 1) * (rm.r1 - rm.r0 + 1), 0);
        const floors = map.zones.filter((z) => z.kind === 'floor');
        const area = floors.reduce(
          (acc, f) => acc + (f.maxX - f.minX) * (f.maxZ - f.minZ),
          0,
        );
        const total = (map.bounds.maxX - map.bounds.minX) * (map.bounds.maxZ - map.bounds.minZ);
        expect(edge).toBeGreaterThan(0);
        expect(area / total).toBeLessThan(0.95); // no es un rectángulo lleno
        expect(area / total).toBeGreaterThan(0.5); // …pero sigue siendo una casa grande
      });

      it('CASA: ≥10 cuartos con color propio + pasillos', () => {
        const rooms = map.zones.filter((z) => z.id.startsWith('room-floor'));
        expect(rooms.length).toBeGreaterThanOrEqual(10);
        const halls = map.zones.filter((z) => z.id.startsWith('hall-floor'));
        expect(halls.length).toBeGreaterThanOrEqual(6);
        // Colores de cuarto DIVERSOS (camuflaje distinto por cuarto).
        const roomColors = new Set(rooms.map((z) => z.color));
        expect(roomColors.size).toBeGreaterThanOrEqual(6);
      });

      it('la rejilla de spawn (hall central) queda LIBRE de sólidos', () => {
        const world = initialWorld(seed);
        const r = DEFAULT_SIM_CONFIG.playerRadius;
        for (let i = 0; i < 25; i++) {
          const p = spawnPlayer(world, `p${i}`);
          for (const z of map.zones) {
            if (!isSolidZone(z)) continue;
            const inside =
              p.pos.x > z.minX - r && p.pos.x < z.maxX + r &&
              p.pos.z > z.minZ - r && p.pos.z < z.maxZ + r;
            expect(inside, `spawn ${i} pisa ${z.id}`).toBe(false);
          }
        }
      });

      it('OFICINA low-poly: ≥30 muebles (archivadores/mesas/terminales/taburetes)', () => {
        // Spec r4: la casa deja de ser un laberinto plano — cada cuarto recibe
        // mobiliario SÓLIDO (el servidor lo conoce: ocluye disparos y da color
        // de camuflaje al abrazarlo). Celdas libres, nunca en el spawn.
        const office = map.zones.filter((z) => /-(cabinet|desk|terminal|stool)-/.test(z.id));
        expect(office.length).toBeGreaterThanOrEqual(30);
        // Los muebles no pisan el spawn (hall central ±3.5).
        for (const z of office) {
          expect(z.maxX < -3.5 || z.minX > 3.5 || z.maxZ < -3.5 || z.minZ > 3.5).toBe(true);
        }
      });

      it('mimetismo por cuarto: ≥10 figure, ≥6 figureWall, esfera+cilindro, ≥24 muros', () => {
        expect(map.zones.filter((z) => z.kind === 'wall').length).toBeGreaterThanOrEqual(24);
        expect(map.zones.filter((z) => z.shape === 'figure').length).toBeGreaterThanOrEqual(10);
        expect(map.zones.filter((z) => z.shape === 'figureWall').length).toBeGreaterThanOrEqual(6);
        const shapes = new Set(map.zones.map((z) => z.shape ?? 'box'));
        expect(shapes.has('sphere')).toBe(true);
        expect(shapes.has('cylinder')).toBe(true);
      });

      it('anti z-fighting: NINGUNA cara de dos sólidos es coplanaria y solapada', () => {
        // Regresión del playtest r4 ("las paredes parpadean"): caras exactamente en
        // el mismo plano y solapadas ⇒ shimmer/z-fighting. Pares: minX/maxX/minZ/maxZ
        // de cada zona sólida contra TODAS las caras de las demás (incluye trasera
        // con trasera). Los pisos no son sólidos: sus topes no compiten con nada.
        const solids = map.zones.filter(isSolidZone);
        const EPS = 1e-4;
        for (let i = 0; i < solids.length; i++) {
          const a = solids[i]!;
          for (let j = i + 1; j < solids.length; j++) {
            const b = solids[j]!;
            // Solapamiento vertical (y): ambas caras existen en el mismo rango.
            const yOverlap =
              Math.min(zoneYMax(a), zoneYMax(b)) - Math.max(zoneYMin(a), zoneYMin(b));
            if (yOverlap <= EPS) continue;
            for (const [pa, pb] of [
              [a.minX, b.minX], [a.minX, b.maxX],
              [a.maxX, b.minX], [a.maxX, b.maxX],
            ] as const) {
              if (Math.abs(pa - pb) > EPS) continue;
              const zOverlap =
                Math.min(a.maxZ, b.maxZ) - Math.max(a.minZ, b.minZ);
              if (zOverlap > EPS) {
                throw new Error(
                  `caras X coplanarias solapadas: ${a.id} y ${b.id} en x=${pa}`,
                );
              }
            }
            for (const [pa, pb] of [
              [a.minZ, b.minZ], [a.minZ, b.maxZ],
              [a.maxZ, b.minZ], [a.maxZ, b.maxZ],
            ] as const) {
              if (Math.abs(pa - pb) > EPS) continue;
              const xOverlap =
                Math.min(a.maxX, b.maxX) - Math.max(a.minX, b.minX);
              if (xOverlap > EPS) {
                throw new Error(
                  `caras Z coplanarias solapadas: ${a.id} y ${b.id} en z=${pa}`,
                );
              }
            }
          }
        }
      });

      it('perímetro CERRADO: toda celda de piso del borde tiene muro exterior', () => {
        // Regresión: los bucles de aristas solo cubrían celdas INTERIORES de la
        // rejilla ⇒ la casa estaba abierta en su contorno (el clamp de posición
        // la cerraba "de facto" pero visualmente y para el rayo quedaba abierta).
        const plan = generateHousePlan(seed);
        const B = map.bounds;
        const C = HOUSE_CELL;
        const W = HOUSE_COLS * C, H = HOUSE_ROWS * C;
        const cellX0 = (c: number): number => c * C - W / 2;
        const cellZ0 = (r: number): number => r * C - H / 2;
        /** ¿Un muro en la banda del borde `side` cubre ≥75% del tramo de la celda? */
        const covered = (
          cell: { x0: number; x1: number; z0: number; z1: number },
          side: 'N' | 'S' | 'E' | 'W',
        ): boolean => {
          for (const z of map.zones) {
            if (z.kind !== 'wall') continue;
            if (side === 'N' || side === 'S') {
              const line = side === 'N' ? B.minZ : B.maxZ;
              // muro horizontal apoyado en esa banda de borde
              if (z.minZ > line + 0.4 || z.maxZ < line - 0.05) continue;
              const ov = Math.min(z.maxX, cell.x1) - Math.max(z.minX, cell.x0);
              if (ov >= (cell.x1 - cell.x0) * 0.75) return true;
            } else {
              const line = side === 'W' ? B.minX : B.maxX;
              if (z.minX > line + 0.4 || z.maxX < line - 0.05) continue;
              const ov = Math.min(z.maxZ, cell.z1) - Math.max(z.minZ, cell.z0);
              if (ov >= (cell.z1 - cell.z0) * 0.75) return true;
            }
          }
          return false;
        };
        let checked = 0;
        for (let r = 0; r < HOUSE_ROWS; r++) {
          for (let c = 0; c < HOUSE_COLS; c++) {
            if (houseCell(plan, r, c) === CELL_OUT) continue;
            const cell = { x0: cellX0(c), x1: cellX0(c) + C, z0: cellZ0(r), z1: cellZ0(r) + C };
            const onEdge = r === 0 || r === HOUSE_ROWS - 1 || c === 0 || c === HOUSE_COLS - 1;
            if (!onEdge) continue;
            checked++;
            if (r === 0 && !covered(cell, 'N')) throw new Error(`borde N abierto en (${r},${c})`);
            if (r === HOUSE_ROWS - 1 && !covered(cell, 'S')) throw new Error(`borde S abierto en (${r},${c})`);
            if (c === 0 && !covered(cell, 'W')) throw new Error(`borde W abierto en (${r},${c})`);
            if (c === HOUSE_COLS - 1 && !covered(cell, 'E')) throw new Error(`borde E abierto en (${r},${c})`);
          }
        }
        expect(checked).toBeGreaterThan(0); // el anillo existe en este seed
      });

      it('≥8 colores distintos y color de referencia definido en todo el mapa', () => {
        const colors = new Set<number>([map.floorColor]);
        for (const z of map.zones) colors.add(z.color);
        expect(colors.size).toBeGreaterThanOrEqual(8);
        const out = new ColorRGBA();
        for (let x = map.bounds.minX; x <= map.bounds.maxX; x += 5) {
          for (let z = map.bounds.minZ; z <= map.bounds.maxZ; z += 5) {
            expect(referenceColorAt(map, x, z, out).a).toBe(255);
          }
        }
      });
    });
  }

  // ── El PLANO de la casa (verdad compartida de muros/puertas): conectividad ──
  for (const seed of SEEDS.slice(0, 6)) {
    describe(`plano @ seed=${seed}`, () => {
      const plan = generateHousePlan(seed);

      /** ¿La celda (r,c) es piso (pasillos o cuartos)? */
      const isFloorCell = (r: number, c: number): boolean =>
        houseCell(plan, r, c) !== CELL_OUT;

      it('CONECTIVIDAD: BFS desde el spawn alcanza TODA celda de cuarto y pasillo', () => {
        // Nadie debe quedar encerrado: toda celda de piso es alcanzable desde el
        // hall central (spawn) usando la MISMA verdad (`isEdgeOpen`) que emite
        // los muros del mapa — si esto pasa, no hay cuartos sellados.
        const cr = HOUSE_ROWS >> 1;
        const cc = HOUSE_COLS >> 1;
        expect(isFloorCell(cr, cc)).toBe(true); // el spawn es piso
        const seen = new Set<number>([cr * HOUSE_COLS + cc]);
        const queue: number[] = [cr * HOUSE_COLS + cc];
        const DIRS: ReadonlyArray<[number, number]> = [
          [0, 1], [0, -1], [1, 0], [-1, 0],
        ];
        while (queue.length > 0) {
          const cur = queue.pop()!;
          const r = Math.floor(cur / HOUSE_COLS);
          const c = cur % HOUSE_COLS;
          for (const [dr, dc] of DIRS) {
            const r2 = r + dr;
            const c2 = c + dc;
            const key = r2 * HOUSE_COLS + c2;
            if (seen.has(key)) continue;
            if (!isFloorCell(r2, c2)) continue;
            if (!isEdgeOpen(plan, r, c, r2, c2)) continue;
            seen.add(key);
            queue.push(key);
          }
        }
        let floors = 0;
        for (let r = 0; r < HOUSE_ROWS; r++) {
          for (let c = 0; c < HOUSE_COLS; c++) {
            if (isFloorCell(r, c)) floors++;
          }
        }
        expect(seen.size).toBe(floors); // alcanzables == totales
      });

      it('cada cuarto tiene ≥1 PUERTA en su perímetro (a pasillo u otro cuarto)', () => {
        for (const room of plan.rooms) {
          let doors = 0;
          for (let r = room.r0; r <= room.r1; r++) {
            for (let c = room.c0; c <= room.c1; c++) {
              for (const [dr, dc] of [[0, 1], [0, -1], [1, 0], [-1, 0]] as const) {
                const r2 = r + dr;
                const c2 = c + dc;
                if (r2 < 0 || r2 >= HOUSE_ROWS || c2 < 0 || c2 >= HOUSE_COLS) continue;
                if (isEdgeOpen(plan, r, c, r2, c2) && houseCell(plan, r2, c2) !== CELL_OUT) {
                  // abierta hacia OTRA celda (otro cuarto o pasillo)
                  const sameRoom = r2 >= room.r0 && r2 <= room.r1 && c2 >= room.c0 && c2 <= room.c1;
                  if (!sameRoom) doors++;
                }
              }
            }
          }
          expect(doors, `cuarto ${room.id} sin puertas`).toBeGreaterThanOrEqual(1);
        }
      });

      it('los cuartos son RECTÁNGULOS disjuntos y todos tienen celdas ROOM', () => {
        const seen = new Set<number>();
        for (const room of plan.rooms) {
          expect(room.r1).toBeGreaterThanOrEqual(room.r0);
          expect(room.c1).toBeGreaterThanOrEqual(room.c0);
          for (let r = room.r0; r <= room.r1; r++) {
            for (let c = room.c0; c <= room.c1; c++) {
              const key = r * HOUSE_COLS + c;
              expect(seen.has(key), `celda (${r},${c}) en dos cuartos`).toBe(false);
              seen.add(key);
              expect(houseCell(plan, r, c)).toBe(CELL_ROOM);
            }
          }
        }
      });
    });
  }
});
