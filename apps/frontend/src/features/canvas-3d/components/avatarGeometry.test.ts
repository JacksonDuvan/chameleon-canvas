/**
 * avatarGeometry — la silueta VISUAL de cada pose debe ser honesta con la esfera de
 * impacto AUTORITATIVA del servidor (`POSE_BODY_CY`/`POSE_BODY_R`, @mecha/sim):
 *
 *  1. Cubre el hitbox: nada de "aire que da hit" (un disparo que el server confirma
 *     debe verse pegar en el cuerpo, no por encima de la cabeza).
 *  2. No lo desborda más que un FLECO acotado (hocico/cola/patas): un disparo al
 *     borde visual que el server rechaza es tolerable solo dentro de ese margen.
 *  3. Pies en y=0 (el render coloca el avatar en pos.y del suelo, sin offsets mágicos).
 *  4. Mira a +Z local (convención del yaw del render: rotation.y = atan2(aimX, aimZ)).
 *  5. La pose "bola" es casi esférica: debe fundirse junto a las bolas decorativas
 *     del mapa (mimetismo de objeto, biblia `mecha-chameleon-gamedesign`).
 */
import { describe, expect, it } from 'vitest';
import { POSE_BALL, POSE_BODY_CY, POSE_BODY_R, POSE_COUNT, POSE_CROUCH, POSE_STAND } from '@mecha/sim';
import { buildPoseGeometries, VISUAL_FRINGE } from './avatarGeometry';

describe('buildPoseGeometries (silueta por pose vs hitbox del server)', () => {
  const geometries = buildPoseGeometries();

  it('construye una geometría fusionada por pose', () => {
    expect(geometries).toHaveLength(POSE_COUNT);
    for (const g of geometries) {
      expect(g.getAttribute('position').count).toBeGreaterThan(0);
      expect(g.getAttribute('normal')).toBeDefined();
    }
  });

  it('apoya los pies en y=0 (sin offset mágico en el render)', () => {
    for (const g of geometries) {
      g.computeBoundingBox();
      const bb = g.boundingBox!;
      expect(bb.min.y).toBeGreaterThanOrEqual(-0.02);
      expect(bb.min.y).toBeLessThanOrEqual(0.2);
    }
  });

  it('cubre la esfera de impacto (no hay hitbox invisible por encima ni cuerpo raquítico)', () => {
    for (let p = 0; p < POSE_COUNT; p++) {
      const g = geometries[p]!;
      g.computeBoundingBox();
      const bb = g.boundingBox!;
      const cy = POSE_BODY_CY[p]!;
      const r = POSE_BODY_R[p]!;
      // El techo visual llega (casi) al techo del hitbox…
      expect(bb.max.y, `pose ${p}: techo visual`).toBeGreaterThanOrEqual(cy + r * 0.8);
      // …y en planta el cuerpo ocupa una fracción decente del radio en algún eje.
      const halfX = Math.max(Math.abs(bb.min.x), Math.abs(bb.max.x));
      const halfZ = Math.max(Math.abs(bb.min.z), Math.abs(bb.max.z));
      expect(Math.max(halfX, halfZ), `pose ${p}: planta`).toBeGreaterThanOrEqual(r * 0.4);
    }
  });

  it(`no desborda el hitbox más que el fleco cosmético (${VISUAL_FRINGE} m)`, () => {
    for (let p = 0; p < POSE_COUNT; p++) {
      const g = geometries[p]!;
      g.computeBoundingBox();
      const bb = g.boundingBox!;
      const cy = POSE_BODY_CY[p]!;
      const r = POSE_BODY_R[p]!;
      expect(bb.max.y, `pose ${p}: techo`).toBeLessThanOrEqual(cy + r + VISUAL_FRINGE);
      for (const v of [bb.min.x, bb.max.x, bb.min.z, bb.max.z]) {
        expect(Math.abs(v), `pose ${p}: planta`).toBeLessThanOrEqual(r + VISUAL_FRINGE);
      }
    }
  });

  it('de pie y agachado miran a +Z local (la cabeza sigue al yaw)', () => {
    for (const p of [POSE_STAND, POSE_CROUCH]) {
      const g = geometries[p]!;
      g.computeBoundingBox();
      expect(g.boundingBox!.max.z, `pose ${p}`).toBeGreaterThanOrEqual(0.3);
    }
  });

  it('la pose bola es casi esférica (se funde con las bolas decorativas del mapa)', () => {
    const g = geometries[POSE_BALL]!;
    g.computeBoundingBox();
    const bb = g.boundingBox!;
    const dims = [bb.max.x - bb.min.x, bb.max.y - bb.min.y, bb.max.z - bb.min.z];
    const max = Math.max(...dims);
    const min = Math.min(...dims);
    expect((max - min) / max).toBeLessThanOrEqual(0.12);
  });
});
