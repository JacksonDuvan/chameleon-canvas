/**
 * pose — poses del Hider, incluidas las de MIMETISMO de objeto (caja/barril) que pidió
 * el playtest ("poder convertirme en cualquier figura del escenario"). Contratos:
 *  - hay hitbox (centro/radio) para CADA pose y son valores sanos (>0, sobre el suelo).
 *  - `clampPose` sanea CUALQUIER byte del cliente a una pose válida [0, POSE_COUNT)
 *    (anti-cheat: un cliente malicioso podría mandar 200).
 */
import { describe, expect, it } from 'vitest';
import {
  clampPose,
  POSE_BALL,
  POSE_BODY_CY,
  POSE_BODY_R,
  POSE_BOX,
  POSE_CABINET,
  POSE_COUNT,
  POSE_CROUCH,
  POSE_CYLINDER,
  POSE_DESK,
  POSE_FLAT,
  POSE_STAND,
  POSE_STOOL,
  POSE_TERMINAL,
} from './pose';

describe('poses', () => {
  const ALL = [
    POSE_STAND, POSE_CROUCH, POSE_BALL, POSE_FLAT, POSE_BOX, POSE_CYLINDER,
    POSE_CABINET, POSE_DESK, POSE_TERMINAL, POSE_STOOL,
  ];
  it('son 10: las 6 de siempre + los 4 muebles de oficina (caben en 4 bits del wire)', () => {
    expect(POSE_COUNT).toBe(10);
    expect(POSE_COUNT).toBeLessThanOrEqual(16);
    expect(new Set(ALL).size).toBe(10);
    for (const p of ALL) {
      expect(p).toBeGreaterThanOrEqual(0);
      expect(p).toBeLessThan(POSE_COUNT);
    }
  });

  it('cada pose tiene hitbox (centro y radio sanos)', () => {
    expect(POSE_BODY_CY).toHaveLength(POSE_COUNT);
    expect(POSE_BODY_R).toHaveLength(POSE_COUNT);
    for (let p = 0; p < POSE_COUNT; p++) {
      expect(POSE_BODY_R[p]!).toBeGreaterThan(0.2);
      expect(POSE_BODY_CY[p]! - POSE_BODY_R[p]!).toBeGreaterThanOrEqual(-0.1); // no bajo tierra
      expect(POSE_BODY_CY[p]!).toBeLessThan(1.5); // dentro de la altura del muñeco
    }
  });

  it('clampPose sanea CUALQUIER byte a una pose válida [0, POSE_COUNT)', () => {
    for (const v of [0, 1, 5, 6, 7, 42, 200, 255]) {
      const c = clampPose(v);
      expect(c).toBeGreaterThanOrEqual(0);
      expect(c).toBeLessThan(POSE_COUNT);
    }
    // Las poses válidas se conservan intactas.
    for (let p = 0; p < POSE_COUNT; p++) expect(clampPose(p)).toBe(p);
  });
});
