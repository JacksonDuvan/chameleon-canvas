import { describe, it, expect } from 'vitest';
import { ColorRGBA } from './ColorRGBA';

describe('ColorRGBA', () => {
  it('pack/unpack es un round-trip exacto', () => {
    const c = new ColorRGBA(0x12, 0x34, 0x56, 0x78);
    const packed = c.packRGBA8();
    const back = ColorRGBA.fromPacked(packed);
    expect([back.r, back.g, back.b, back.a]).toEqual([0x12, 0x34, 0x56, 0x78]);
  });

  it('packRGBA8 produce un uint32 sin signo para canales altos', () => {
    const white = new ColorRGBA(255, 255, 255, 255);
    const packed = white.packRGBA8();
    expect(packed).toBe(0xffffffff);
    expect(packed).toBeGreaterThan(0); // no negativo (>>> 0)
  });

  it('setFromPackedMut muta sin asignar', () => {
    const c = new ColorRGBA();
    const r = c.setFromPackedMut(0xaabbccdd);
    expect(r).toBe(c);
    expect([c.r, c.g, c.b, c.a]).toEqual([0xaa, 0xbb, 0xcc, 0xdd]);
  });
});
