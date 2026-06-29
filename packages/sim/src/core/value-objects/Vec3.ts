/**
 * Vec3 — vector 3D mutable. ES el tipo caliente de la simulación (posiciones y
 * velocidades), por eso es UNA sola clase con forma monomórfica fija y métodos que
 * MUTAN in situ (sin asignar). Skill `workers-memory-optimization`.
 *
 * Convención: los métodos `*Mut` mutan `this` y lo devuelven (encadenable, cero
 * asignaciones). `clone()` SÍ asigna y se usa solo fuera del camino caliente.
 */
export class Vec3 {
  x = 0;
  y = 0;
  z = 0;

  constructor(x = 0, y = 0, z = 0) {
    this.x = x;
    this.y = y;
    this.z = z;
  }

  setMut(x: number, y: number, z: number): this {
    this.x = x;
    this.y = y;
    this.z = z;
    return this;
  }

  copyFromMut(o: Vec3): this {
    this.x = o.x;
    this.y = o.y;
    this.z = o.z;
    return this;
  }

  addMut(o: Vec3): this {
    this.x += o.x;
    this.y += o.y;
    this.z += o.z;
    return this;
  }

  /** this += o * s (integración sin asignar un vector intermedio). */
  addScaledMut(o: Vec3, s: number): this {
    this.x += o.x * s;
    this.y += o.y * s;
    this.z += o.z * s;
    return this;
  }

  subMut(o: Vec3): this {
    this.x -= o.x;
    this.y -= o.y;
    this.z -= o.z;
    return this;
  }

  scaleMut(s: number): this {
    this.x *= s;
    this.y *= s;
    this.z *= s;
    return this;
  }

  lengthSq(): number {
    return this.x * this.x + this.y * this.y + this.z * this.z;
  }

  length(): number {
    return Math.sqrt(this.lengthSq());
  }

  /** Normaliza in situ a longitud 1 (no-op si es el vector cero). */
  normalizeMut(): this {
    const len = this.length();
    if (len > 0) this.scaleMut(1 / len);
    return this;
  }

  distanceSqTo(o: Vec3): number {
    const dx = this.x - o.x;
    const dy = this.y - o.y;
    const dz = this.z - o.z;
    return dx * dx + dy * dy + dz * dz;
  }

  /** Asigna: solo fuera del camino caliente. */
  clone(): Vec3 {
    return new Vec3(this.x, this.y, this.z);
  }
}
