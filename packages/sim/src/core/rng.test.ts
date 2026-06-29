import { describe, it, expect } from 'vitest';
import { makeRng } from './rng';

describe('makeRng (mulberry32)', () => {
  it('misma semilla ⇒ misma secuencia (determinismo)', () => {
    const a = makeRng(1234);
    const b = makeRng(1234);
    const seqA = Array.from({ length: 16 }, () => a.next());
    const seqB = Array.from({ length: 16 }, () => b.next());
    expect(seqA).toEqual(seqB);
  });

  it('semillas distintas ⇒ secuencias distintas', () => {
    const a = makeRng(1);
    const b = makeRng(2);
    expect(a.next()).not.toBe(b.next());
  });

  it('next() siempre cae en [0, 1)', () => {
    const r = makeRng(99);
    for (let i = 0; i < 1000; i++) {
      const v = r.next();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });

  it('nextInt(n) cae en [0, n)', () => {
    const r = makeRng(7);
    for (let i = 0; i < 1000; i++) {
      const v = r.nextInt(5);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(5);
      expect(Number.isInteger(v)).toBe(true);
    }
  });

  it('getState/setState restaura la secuencia (persistencia)', () => {
    const r = makeRng(42);
    r.next();
    r.next();
    const snapshot = r.getState();
    const afterA = r.next();
    r.setState(snapshot);
    const afterB = r.next();
    expect(afterA).toBe(afterB);
  });
});
