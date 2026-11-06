/**
 * Parseo del mensaje de control `roster` (V1-E). El mensaje viene de la red ⇒
 * NUNCA se confía en su forma: filtra entradas malformadas y devuelve null para
 * mensajes que no son roster (el caller los ignora).
 *
 * El contrato del mensaje vive en `@mecha/shared/protocol` (RosterMsg).
 */
import type { RosterPlayer } from '@mecha/shared';

export interface ParsedRoster {
  readonly hostId: string | null;
  readonly players: RosterPlayer[];
}

export function parseRoster(raw: unknown): ParsedRoster | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const msg = raw as { type?: unknown; hostId?: unknown; players?: unknown };
  if (msg.type !== 'roster' || !Array.isArray(msg.players)) return null;

  const players: RosterPlayer[] = [];
  for (const entry of msg.players) {
    if (typeof entry !== 'object' || entry === null) continue;
    const p = entry as { id?: unknown; name?: unknown; isHost?: unknown };
    if (typeof p.id !== 'string' || typeof p.name !== 'string') continue;
    players.push({ id: p.id, name: p.name, isHost: p.isHost === true });
  }
  const hostId = typeof msg.hostId === 'string' ? msg.hostId : null;
  return { hostId, players };
}
