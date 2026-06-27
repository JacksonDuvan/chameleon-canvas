/**
 * Value-object Position (x, y, z) — coordenadas puras del mundo.
 *
 * Skills: `hexagonal-vertical-slicing` (value-object inmutable) +
 * `workers-memory-optimization` (forma monomórfica; en el camino caliente se
 * mutará un scratch con `setMut`, no se asignará un objeto nuevo por tick).
 *
 * SCAFFOLD del Paso 1 — la implementación matemática llega en el Paso 2.
 */
export class Position {
  // Campos declarados en orden fijo en el constructor (hidden class estable).
  x = 0;
  y = 0;
  z = 0;

  constructor(x = 0, y = 0, z = 0) {
    this.x = x;
    this.y = y;
    this.z = z;
  }

  /** Mutación in situ para el camino caliente (cero asignaciones). */
  setMut(x: number, y: number, z: number): this {
    this.x = x;
    this.y = y;
    this.z = z;
    return this;
  }

  // TODO(Paso 2): addMut, distanceSq, clampToBounds… (todo mut, sin asignar).
}
