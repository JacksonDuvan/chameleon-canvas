/**
 * ColorRGBA — color/textura que el Hider absorbe del entorno (cuentagotas). Canales
 * 0..255. Forma monomórfica fija. `packRGBA8` lo cuantiza a un uint32 para el wire
 * (skill `authoritative-netcode`); `fromPacked` lo reconstruye.
 */
export class ColorRGBA {
  r = 0;
  g = 0;
  b = 0;
  a = 255;

  constructor(r = 0, g = 0, b = 0, a = 255) {
    this.r = r;
    this.g = g;
    this.b = b;
    this.a = a;
  }

  setMut(r: number, g: number, b: number, a = 255): this {
    this.r = r;
    this.g = g;
    this.b = b;
    this.a = a;
    return this;
  }

  copyFromMut(o: ColorRGBA): this {
    this.r = o.r;
    this.g = o.g;
    this.b = o.b;
    this.a = o.a;
    return this;
  }

  /** Empaqueta a uint32 0xRRGGBBAA (cuantización para la red). */
  packRGBA8(): number {
    return (
      ((this.r & 0xff) * 0x1000000 +
        ((this.g & 0xff) << 16) +
        ((this.b & 0xff) << 8) +
        (this.a & 0xff)) >>>
      0
    );
  }

  /** Escribe en `this` el color desempaquetado desde un uint32 0xRRGGBBAA. */
  setFromPackedMut(packed: number): this {
    return this.setMut(
      (packed >>> 24) & 0xff,
      (packed >>> 16) & 0xff,
      (packed >>> 8) & 0xff,
      packed & 0xff,
    );
  }

  static fromPacked(packed: number): ColorRGBA {
    return new ColorRGBA().setFromPackedMut(packed);
  }
}
