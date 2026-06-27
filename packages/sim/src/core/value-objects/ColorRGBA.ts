/**
 * Value-object ColorRGBA — el color/textura que el Hider "absorbe" del entorno
 * con el cuentagotas (raycaster) al pulsar 'E' (regla de negocio de camuflaje).
 *
 * Se transmite cuantizado por la red (1 byte por canal) — ver `wire-format.md`
 * de la skill `authoritative-netcode`.
 *
 * SCAFFOLD del Paso 1 — implementación en el Paso 2/4.
 */
export class ColorRGBA {
  r = 0; // 0..255
  g = 0;
  b = 0;
  a = 255;

  constructor(r = 0, g = 0, b = 0, a = 255) {
    this.r = r;
    this.g = g;
    this.b = b;
    this.a = a;
  }

  // TODO(Paso 2): packRGBA8(): number  /  unpack(packed): ColorRGBA  (cuantización).
}
