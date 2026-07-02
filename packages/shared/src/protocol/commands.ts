/**
 * `UserCommand` — el mensaje INPUT del camino caliente (cliente → servidor).
 *
 * Skill `authoritative-netcode`: el input lleva SOLO intención (movimiento + acción)
 * etiquetada con `seq` monotónico; NUNCA resultados calculados por el cliente. El
 * servidor es autoritativo y hace clamp.
 *
 * Nota de determinismo: el apunte viaja como dirección normalizada (`aimX`,`aimZ`),
 * NO como ángulo, para que la simulación no use trigonometría (evita drift entre
 * motores). El `yaw` para renderizar se deriva en el cliente.
 */
export const ActionKind = {
  NONE: 0,
  CATCH: 1, // el Seeker "dispara"/atrapa con un rayo hacia adelante
  FREEZE: 2, // el Hider congela su pose ('Espacio')
  ABSORB_COLOR: 3, // el Hider absorbe color del entorno (cuentagotas, 'E')
} as const;
export type ActionKind = (typeof ActionKind)[keyof typeof ActionKind];

export interface UserCommand {
  readonly seq: number; // secuencia monotónica (reconciliación)
  readonly playerId: string;
  readonly moveX: number; // intención de movimiento -1..1 (el servidor clampa)
  readonly moveZ: number;
  readonly aimX: number; // dirección de apunte normalizada 3D (mouse-look)
  readonly aimY: number; // componente vertical (pitch) — el Seeker apunta arriba/abajo
  readonly aimZ: number;
  readonly pose: number; // pose deseada del Hider 0..3 (el servidor sanea y valida fase/rol)
  readonly action: ActionKind;
}
