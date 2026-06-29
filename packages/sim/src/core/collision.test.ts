import { describe, it, expect } from 'vitest';
import { raySphere, clampToBoundsMut, type ArenaBounds } from './collision';
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
