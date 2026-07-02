import { describe, it, expect } from 'vitest';
import {
  raySphere,
  rayAABB,
  resolveCircleAABBMut,
  clampToBoundsMut,
  type ArenaBounds,
} from './collision';
import { Vec3 } from './value-objects/Vec3';

const BOUNDS: ArenaBounds = {
  minX: -10,
  maxX: 10,
  minY: 0,
  maxY: 5,
  minZ: -10,
  maxZ: 10,
};

describe('clampToBoundsMut', () => {
  it('restringe cada eje al rango del escenario', () => {
    const p = new Vec3(99, -3, -99);
    clampToBoundsMut(p, BOUNDS);
    expect([p.x, p.y, p.z]).toEqual([10, 0, -10]);
  });

  it('no toca una posición ya dentro', () => {
    const p = new Vec3(1, 2, 3);
    clampToBoundsMut(p, BOUNDS);
    expect([p.x, p.y, p.z]).toEqual([1, 2, 3]);
  });
});

describe('raySphere', () => {
  it('impacta una esfera de frente y devuelve la distancia a la superficie', () => {
    // rayo desde origen hacia +x; esfera en (5,0,0) radio 1 ⇒ superficie en t=4
    const t = raySphere(0, 0, 0, 1, 0, 0, 5, 0, 0, 1);
    expect(t).not.toBeNull();
    expect(t).toBeCloseTo(4, 6);
  });

  it('no impacta si el rayo pasa de largo', () => {
    // esfera desplazada en z fuera del radio
    const t = raySphere(0, 0, 0, 1, 0, 0, 5, 0, 5, 1);
    expect(t).toBeNull();
  });

  it('no impacta si apunta en dirección contraria', () => {
    const t = raySphere(0, 0, 0, -1, 0, 0, 5, 0, 0, 1);
    expect(t).toBeNull();
  });

  it('devuelve 0 si el origen está dentro de la esfera', () => {
    const t = raySphere(5, 0, 0, 1, 0, 0, 5, 0, 0, 2);
    expect(t).toBe(0);
  });
});

describe('rayAABB', () => {
  // Caja unitaria en x 4..6, y 0..2, z -1..1.
  const hit = (ox: number, oy: number, oz: number, dx: number, dy: number, dz: number) =>
    rayAABB(ox, oy, oz, dx, dy, dz, 4, 0, -1, 6, 2, 1);

  it('impacta la cara frontal de frente y devuelve la distancia', () => {
    expect(hit(0, 1, 0, 1, 0, 0)).toBeCloseTo(4, 9);
  });

  it('no impacta si el rayo pasa por encima (paralelo al eje y fuera del slab)', () => {
    expect(hit(0, 3, 0, 1, 0, 0)).toBeNull();
  });

  it('no impacta si apunta en dirección contraria', () => {
    expect(hit(0, 1, 0, -1, 0, 0)).toBeNull();
  });

  it('impacta en diagonal (dirección normalizada)', () => {
    const inv = 1 / Math.hypot(1, 0, 0.2);
    const t = hit(0, 1, 0, 1 * inv, 0, 0.2 * inv);
    expect(t).not.toBeNull();
    expect(t!).toBeGreaterThan(4);
  });

  it('devuelve 0 si el origen está dentro de la caja', () => {
    expect(hit(5, 1, 0, 1, 0, 0)).toBe(0);
  });

  it('un rayo con pitch hacia abajo pasa por encima de una caja baja', () => {
    // Caja baja y 0..1; rayo desde (0,1.5) con pitch suave hacia abajo: a x=4 el rayo
    // va a y≈1.1 > 1 → lo bloquea... a x=6 baja a y≈0.9 < 1 → SÍ impacta el tramo final.
    const dy = -0.1;
    const inv = 1 / Math.hypot(1, dy, 0);
    const t = rayAABB(0, 1.5, 0, inv, dy * inv, 0, 4, 0, -1, 6, 1, 1);
    expect(t).not.toBeNull(); // entra por la tapa superior dentro del rango x 4..6
  });
});

describe('resolveCircleAABBMut', () => {
  // Caja x 0..2, z 0..2; radio del jugador 0.5.
  it('no toca un círculo que no solapa', () => {
    const p = new Vec3(5, 0, 5);
    resolveCircleAABBMut(p, 0.5, 0, 0, 2, 2);
    expect([p.x, p.z]).toEqual([5, 5]);
  });

  it('empuja hacia fuera un círculo que solapa un borde', () => {
    const p = new Vec3(2.3, 0, 1); // borde derecho en x=2; centro a 0.3 < r 0.5
    resolveCircleAABBMut(p, 0.5, 0, 0, 2, 2);
    expect(p.x).toBeCloseTo(2.5, 9);
    expect(p.z).toBe(1);
  });

  it('empuja en diagonal desde una esquina', () => {
    const p = new Vec3(2.2, 0, 2.2); // esquina (2,2); dist ≈0.283 < 0.5
    resolveCircleAABBMut(p, 0.5, 0, 0, 2, 2);
    const d = Math.hypot(p.x - 2, p.z - 2);
    expect(d).toBeCloseTo(0.5, 6);
  });

  it('con el centro DENTRO de la caja, expulsa por el eje de mínima penetración', () => {
    const p = new Vec3(1.9, 0, 1); // pegado al borde derecho por dentro
    resolveCircleAABBMut(p, 0.5, 0, 0, 2, 2);
    expect(p.x).toBeCloseTo(2.5, 9); // fuera por la derecha
    expect(p.z).toBe(1);
  });

  it('es determinista (mismas entradas ⇒ mismo resultado)', () => {
    const a = new Vec3(2.2, 0, 2.2);
    const b = new Vec3(2.2, 0, 2.2);
    resolveCircleAABBMut(a, 0.5, 0, 0, 2, 2);
    resolveCircleAABBMut(b, 0.5, 0, 0, 2, 2);
    expect([a.x, a.z]).toEqual([b.x, b.z]);
  });
});
