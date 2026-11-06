/**
 * Tests del cálculo de cadencia de silbidos (V1-H). Lógica PURA del dominio:
 * el jitter se inyecta (rand01) ⇒ determinista y testeable. El scheduler que la
 * usa vive en el DO (adaptador); la REGLA (cadencia ±25% alrededor de la base)
 * vive aquí. Skill `tdd-testing`.
 */
import { describe, it, expect } from 'vitest';
import { whistleDelaySec, WHISTLE_JITTER } from './whistle';

describe('whistleDelaySec', () => {
  it('rand01=0.5 ⇒ exactamente la cadencia base', () => {
    expect(whistleDelaySec(14, 0.5)).toBe(14);
  });

  it('rand01=0 ⇒ base − 25% (jitter mínimo)', () => {
    expect(whistleDelaySec(14, 0)).toBe(14 * (1 - WHISTLE_JITTER));
  });

  it('rand01=1 ⇒ base + 25% (jitter máximo)', () => {
    expect(whistleDelaySec(14, 1)).toBe(14 * (1 + WHISTLE_JITTER));
  });

  it('siempre dentro de [base·(1−j), base·(1+j)] para cualquier rand01', () => {
    const base = 10;
    for (let i = 0; i <= 100; i++) {
      const d = whistleDelaySec(base, i / 100);
      expect(d).toBeGreaterThanOrEqual(base * (1 - WHISTLE_JITTER));
      expect(d).toBeLessThanOrEqual(base * (1 + WHISTLE_JITTER));
    }
  });

  it('base mínima de 1 s (nunca 0 ni negativo)', () => {
    expect(whistleDelaySec(1, 0)).toBeGreaterThan(0);
  });
});
