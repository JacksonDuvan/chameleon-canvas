/**
 * PUERTO de físicas (interfaz pura). El núcleo de simulación (`core/`) depende
 * de ESTA interfaz, nunca de Rapier directamente — así `core/` sigue siendo puro
 * y testeable con un fake (skills `hexagonal-vertical-slicing` + `tdd-testing`).
 *
 * El adaptador real es `RapierPhysicsWorld`. Un fake en memoria (físicas
 * triviales) sirve para los tests deterministas del Paso 2.
 *
 * SCAFFOLD del Paso 1.
 */
export interface IPhysicsWorld {
  /** Avanza la simulación física exactamente `dt` segundos (timestep fijo). */
  step(dt: number): void;

  // TODO(Paso 2): addBody, setVelocity, raycast (para el cuentagotas/visión del
  // Seeker), queryContacts (impacto Seeker↔Hider), removeBody… todo síncrono.

  /** Libera recursos del mundo físico (el `World` de Rapier). */
  dispose(): void;
}
