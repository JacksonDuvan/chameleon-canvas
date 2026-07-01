import { describe, it, expect } from 'vitest';
import { DEFAULT_MAP, referenceColorAt, type MapData } from './MapData';
import { ColorRGBA } from '../value-objects/ColorRGBA';

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
