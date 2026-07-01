import { describe, it, expect } from 'vitest';
import { computeCamouflage, requiredFixationTicks } from './camouflage';
import { ColorRGBA } from './value-objects/ColorRGBA';
import { DEFAULT_SIM_CONFIG } from './config';

const cfg = DEFAULT_SIM_CONFIG;

describe('computeCamouflage', () => {
  it('color idéntico al entorno y quieto ⇒ camuflaje máximo (1)', () => {
    const c = new ColorRGBA(74, 122, 58);
    const ref = new ColorRGBA(74, 122, 58);
    expect(computeCamouflage(c, ref, 0, cfg)).toBeCloseTo(1, 6);
  });

  it('color opuesto (negro sobre blanco) ⇒ camuflaje nulo (0)', () => {
    const c = new ColorRGBA(0, 0, 0);
    const ref = new ColorRGBA(255, 255, 255);
    expect(computeCamouflage(c, ref, 0, cfg)).toBeCloseTo(0, 6);
  });

  it('moverse a máxima velocidad delata aunque el color encaje', () => {
    const c = new ColorRGBA(74, 122, 58);
    const ref = new ColorRGBA(74, 122, 58);
    const still = computeCamouflage(c, ref, 0, cfg);
    const moving = computeCamouflage(c, ref, cfg.maxSpeed, cfg);
    expect(moving).toBeLessThan(still);
    expect(moving).toBeCloseTo(1 - cfg.camoMovePenalty, 6);
  });

  it('está acotado a 0..1', () => {
    const c = new ColorRGBA(0, 0, 0);
    const ref = new ColorRGBA(255, 255, 255);
    // velocidad absurda no lo hace negativo
    expect(computeCamouflage(c, ref, cfg.maxSpeed * 10, cfg)).toBe(0);
  });

  it('es determinista: mismas entradas ⇒ mismo valor', () => {
    const c = new ColorRGBA(100, 50, 25);
    const ref = new ColorRGBA(120, 40, 30);
    const a = computeCamouflage(c, ref, 1.5, cfg);
    const b = computeCamouflage(c, ref, 1.5, cfg);
    expect(a).toBe(b);
  });
});

describe('requiredFixationTicks', () => {
  it('un objetivo totalmente visible (score 0) requiere la fijación mínima', () => {
    expect(requiredFixationTicks(0, cfg)).toBe(cfg.fixationMinTicks);
  });

  it('un camuflaje perfecto (score 1) requiere la fijación máxima', () => {
    expect(requiredFixationTicks(1, cfg)).toBe(cfg.fixationMaxTicks);
  });

  it('es monótona: más camuflaje ⇒ más tiempo de fijación', () => {
    expect(requiredFixationTicks(0.25, cfg)).toBeLessThan(requiredFixationTicks(0.75, cfg));
  });
});
