import { describe, it, expect } from 'vitest';
import { Vec3 } from './Vec3';

describe('Vec3', () => {
  it('setMut fija las tres componentes y devuelve this', () => {
    const v = new Vec3();
    const r = v.setMut(1, 2, 3);
    expect(r).toBe(v);
    expect([v.x, v.y, v.z]).toEqual([1, 2, 3]);
  });

  it('addMut suma in situ', () => {
    const v = new Vec3(1, 1, 1);
    v.addMut(new Vec3(2, 3, 4));
    expect([v.x, v.y, v.z]).toEqual([3, 4, 5]);
  });

  it('addScaledMut hace this += o * s (integración)', () => {
    const pos = new Vec3(0, 0, 0);
    const vel = new Vec3(2, 0, -1);
    pos.addScaledMut(vel, 0.5); // dt = 0.5
    expect([pos.x, pos.y, pos.z]).toEqual([1, 0, -0.5]);
  });

  it('scaleMut escala in situ', () => {
    const v = new Vec3(1, -2, 3).scaleMut(2);
    expect([v.x, v.y, v.z]).toEqual([2, -4, 6]);
  });

  it('lengthSq y length', () => {
    const v = new Vec3(3, 4, 0);
    expect(v.lengthSq()).toBe(25);
    expect(v.length()).toBe(5);
  });

  it('distanceSqTo no asigna y es correcto', () => {
    const a = new Vec3(0, 0, 0);
    const b = new Vec3(3, 0, 4);
    expect(a.distanceSqTo(b)).toBe(25);
  });

  it('copyFromMut copia sin compartir referencia', () => {
    const a = new Vec3(1, 2, 3);
    const b = new Vec3().copyFromMut(a);
    a.setMut(9, 9, 9);
    expect([b.x, b.y, b.z]).toEqual([1, 2, 3]);
  });
});
