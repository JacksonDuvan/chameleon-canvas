import { describe, it, expect } from 'vitest';
import { sampleRemote, pushRemoteSnapshot, MAX_REMOTE_BUFFER } from './interpolation';
import { Vec3 } from '@mecha/sim';
import type { RemoteSnapshot } from '../store/worldStore';

function snap(recvAt: number, x: number): RemoteSnapshot {
  return { tick: recvAt, recvAt, x, y: 0, z: 0 };
}

describe('sampleRemote', () => {
  it('interpola linealmente entre los dos snapshots que rodean renderTime', () => {
    const buffer = [snap(0, 0), snap(100, 10)];
    const out = new Vec3();
    sampleRemote(buffer, 50, out);
    expect(out.x).toBeCloseTo(5, 9); // mitad de camino
  });

  it('hace clamp al primer snapshot si renderTime es anterior al buffer', () => {
    const out = new Vec3();
    sampleRemote([snap(100, 7), snap(200, 9)], 50, out);
    expect(out.x).toBe(7);
  });

  it('hace clamp al último snapshot si renderTime es posterior al buffer', () => {
    const out = new Vec3();
    sampleRemote([snap(0, 1), snap(100, 3)], 999, out);
    expect(out.x).toBe(3);
  });

  it('con un solo snapshot devuelve esa posición', () => {
    const out = new Vec3();
    sampleRemote([snap(0, 42)], 50, out);
    expect(out.x).toBe(42);
  });

  it('buffer vacío: no toca el out', () => {
    const out = new Vec3(1, 2, 3);
    sampleRemote([], 50, out);
    expect([out.x, out.y, out.z]).toEqual([1, 2, 3]);
  });

  it('elige el par correcto con varios snapshots', () => {
    const buffer = [snap(0, 0), snap(100, 10), snap(200, 30)];
    const out = new Vec3();
    sampleRemote(buffer, 150, out); // entre 100 (x=10) y 200 (x=30) → 20
    expect(out.x).toBeCloseTo(20, 9);
  });
});

describe('pushRemoteSnapshot', () => {
  it('poda el buffer al máximo (descarta el más antiguo)', () => {
    const buffer: RemoteSnapshot[] = [];
    for (let i = 0; i < MAX_REMOTE_BUFFER + 5; i++) pushRemoteSnapshot(buffer, snap(i, i));
    expect(buffer.length).toBe(MAX_REMOTE_BUFFER);
    expect(buffer[0]!.recvAt).toBe(5); // los 5 primeros se descartaron
  });
});
