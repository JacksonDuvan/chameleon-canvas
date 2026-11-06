/**
 * Parseo del mensaje de control `whistle` (V1-H): el DO difunde {type:'whistle',
 * playerId, x, y, z} cuando un Hider vivo silba en HUNT (regla del host).
 * Defensivo: la red nunca se confía ⇒ null en lugar de lanzar.
 */
export interface WhistleEvent {
  readonly playerId: string;
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

export function parseWhistle(raw: unknown): WhistleEvent | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const msg = raw as { type?: unknown; playerId?: unknown; x?: unknown; y?: unknown; z?: unknown };
  if (msg.type !== 'whistle') return null;
  if (typeof msg.playerId !== 'string' || !msg.playerId) return null;
  if (
    typeof msg.x !== 'number' || !Number.isFinite(msg.x) ||
    typeof msg.y !== 'number' || !Number.isFinite(msg.y) ||
    typeof msg.z !== 'number' || !Number.isFinite(msg.z)
  ) {
    return null;
  }
  return { playerId: msg.playerId, x: msg.x, y: msg.y, z: msg.z };
}
