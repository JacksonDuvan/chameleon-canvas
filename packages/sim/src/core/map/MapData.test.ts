import { describe, it, expect } from 'vitest';
import { DEFAULT_MAP, isSolidZone, referenceColorAt, type MapData } from './MapData';
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

describe('DEFAULT_MAP v2 — pueblo (feedback del playtest: mapa grande + mimetismo)', () => {
  it('los límites del mapa y los de SimConfig son EL MISMO volumen (una sola verdad)', () => {
    // `movement.applyMovement` clampa con cfg.bounds pero colisiona con map.zones:
    // si divergen, hay franjas donde una autoridad existe y la otra no.
    expect(DEFAULT_MAP.bounds).toEqual(DEFAULT_SIM_CONFIG.bounds);
  });

  it('es un mapa grande (≥ 44 m de lado): pueblo, no habitación', () => {
    const b = DEFAULT_MAP.bounds;
    expect(b.maxX - b.minX).toBeGreaterThanOrEqual(44);
    expect(b.maxZ - b.minZ).toBeGreaterThanOrEqual(44);
  });

  it('TODA la rejilla de spawn queda libre de sólidos (nadie nace dentro de una casa)', () => {
    const world = initialWorld();
    const r = DEFAULT_SIM_CONFIG.playerRadius;
    for (let i = 0; i < 25; i++) {
      const p = spawnPlayer(world, `p${i}`);
      for (const z of DEFAULT_MAP.zones) {
        if (!isSolidZone(z)) continue;
        const inside =
          p.pos.x > z.minX - r &&
          p.pos.x < z.maxX + r &&
          p.pos.z > z.minZ - r &&
          p.pos.z < z.maxZ + r;
        expect(inside, `spawn ${i} (${p.pos.x},${p.pos.z}) pisa ${z.id}`).toBe(false);
      }
    }
  });

  it('tiene señuelos con forma de muñeco: ≥6 "figure" de pie y ≥4 "figureWall" en muros', () => {
    // El pilar del mimetismo del original (cactus con brazos, galletas en las paredes):
    // un Hider pintado y posado JUNTO a un señuelo debe ser indistinguible.
    const figures = DEFAULT_MAP.zones.filter((z) => z.shape === 'figure');
    const wallFigures = DEFAULT_MAP.zones.filter((z) => z.shape === 'figureWall');
    expect(figures.length).toBeGreaterThanOrEqual(6);
    expect(wallFigures.length).toBeGreaterThanOrEqual(4);
    // Los señuelos son sólidos: ocluyen el rayo (dispararle a una estatua = fallo).
    for (const z of [...figures, ...wallFigures]) expect(isSolidZone(z)).toBe(true);
  });

  it('es una MINICIUDAD: suficientes muros para formar varias casas (≥16 tramos)', () => {
    // 4 perimetrales + ≥12 tramos de casas/cobertizos (feedback del playtest:
    // "quisiera que hubiera casas, una especie de miniciudad").
    const walls = DEFAULT_MAP.zones.filter((z) => z.kind === 'wall');
    expect(walls.length).toBeGreaterThanOrEqual(16);
  });

  it('ofrece variedad real de superficies: ≥8 colores distintos', () => {
    const colors = new Set<number>([DEFAULT_MAP.floorColor]);
    for (const z of DEFAULT_MAP.zones) colors.add(z.color);
    expect(colors.size).toBeGreaterThanOrEqual(8);
  });

  it('también hay formas que emparejan con las otras poses: bolas y cilindros', () => {
    const shapes = new Set(DEFAULT_MAP.zones.map((z) => z.shape ?? 'box'));
    expect(shapes.has('sphere')).toBe(true);
    expect(shapes.has('cylinder')).toBe(true);
  });
});
