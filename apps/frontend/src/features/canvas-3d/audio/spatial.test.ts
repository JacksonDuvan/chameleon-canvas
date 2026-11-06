/**
 * Tests del posicionamiento estéreo de eventos sonoros (V1-H). Lógica PURA:
 * la señal de audio (pan/gain) se deriva del jugador local y del punto del
 * evento — sin WebAudio, testeable fuera del navegador. Skill `tdd-testing`.
 */
import { describe, it, expect } from 'vitest';
import { computeSpatial } from './spatial';

describe('computeSpatial (pan = ángulo relativo al apunte, gain = distancia)', () => {
  it('evento JUSTO DELANTE ⇒ pan ~0 y gain alto de cerca', () => {
    // Local en el origen mirando -Z (aim 0,-1); evento a 4 m delante.
    const sp = computeSpatial(
      { x: 0, z: 0, aimX: 0, aimZ: -1 },
      { x: 0, z: -4 },
    );
    expect(sp.pan).toBeCloseTo(0, 5);
    expect(sp.gain).toBeGreaterThan(0.5); // 1/(1+4/8) = 0.67
  });

  it('evento a la DERECHA del apunte ⇒ pan positivo', () => {
    // Mirando -Z ⇒ derecha es +X.
    const sp = computeSpatial(
      { x: 0, z: 0, aimX: 0, aimZ: -1 },
      { x: 10, z: 0 },
    );
    expect(sp.pan).toBeGreaterThan(0.9);
  });

  it('evento a la IZQUIERDA del apunte ⇒ pan negativo', () => {
    const sp = computeSpatial(
      { x: 0, z: 0, aimX: 0, aimZ: -1 },
      { x: -10, z: 0 },
    );
    expect(sp.pan).toBeLessThan(-0.9);
  });

  it('el pan RESPETA el apunte (mismo evento, otro yaw ⇒ otro lado)', () => {
    // Mirando +X: el evento en +X ahora está DELANTE (pan ~0).
    const sp = computeSpatial(
      { x: 0, z: 0, aimX: 1, aimZ: 0 },
      { x: 10, z: 0 },
    );
    expect(sp.pan).toBeCloseTo(0, 5);
  });

  it('gain decae con la distancia (más lejos ⇒ más quedo)', () => {
    const near = computeSpatial({ x: 0, z: 0, aimX: 0, aimZ: -1 }, { x: 0, z: -5 });
    const far = computeSpatial({ x: 0, z: 0, aimX: 0, aimZ: -1 }, { x: 0, z: -40 });
    expect(far.gain).toBeLessThan(near.gain);
    expect(far.gain).toBeGreaterThan(0); // nunca silencio absoluto
  });

  it('evento ENCIMA del jugador (dist ~0) ⇒ pan 0 sin NaN', () => {
    const sp = computeSpatial({ x: 3, z: 3, aimX: 0.7, aimZ: -0.7 }, { x: 3, z: 3 });
    expect(sp.pan).toBe(0);
    expect(Number.isFinite(sp.gain)).toBe(true);
  });

  it('apunte vertical puro (aimX/aimZ ~0) no produce NaN', () => {
    const sp = computeSpatial({ x: 0, z: 0, aimX: 0, aimZ: 0 }, { x: 5, z: 5 });
    expect(Number.isFinite(sp.pan)).toBe(true);
    expect(Number.isFinite(sp.gain)).toBe(true);
  });
});
