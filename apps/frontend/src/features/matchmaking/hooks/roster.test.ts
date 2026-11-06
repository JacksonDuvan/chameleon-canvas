/**
 * Tests del parseo del mensaje `roster` (JSON de control del DO). Lógica PURA
 * fuera de React (skill `tdd-testing`): el mensaje viene de la red ⇒ jamás se
 * confía en su forma.
 */
import { describe, it, expect } from 'vitest';
import { parseRoster } from './roster';

describe('parseRoster', () => {
  it('parsea un mensaje roster válido', () => {
    const res = parseRoster({
      type: 'roster',
      hostId: 'p1',
      players: [
        { id: 'p1', name: 'Ana', isHost: true },
        { id: 'p2', name: 'Bob', isHost: false },
      ],
    });
    expect(res).not.toBeNull();
    expect(res!.hostId).toBe('p1');
    expect(res!.players).toHaveLength(2);
    expect(res!.players[0]).toEqual({ id: 'p1', name: 'Ana', isHost: true });
  });

  it('devuelve null para mensajes que no son roster', () => {
    expect(parseRoster({ type: 'welcome', playerId: 'p1' })).toBeNull();
    expect(parseRoster({ type: 'host', isHost: true })).toBeNull();
    expect(parseRoster(null)).toBeNull();
    expect(parseRoster('roster')).toBeNull();
    expect(parseRoster(42)).toBeNull();
  });

  it('es defensivo: filtra entradas malformadas en lugar de fallar entero', () => {
    const res = parseRoster({
      type: 'roster',
      hostId: 7, // tipo incorrecto ⇒ null-safe
      players: [
        { id: 'p1', name: 'Ana', isHost: true },
        { id: 42, name: 'Roto' }, // entrada inválida: se descarta
        'basura',
        { id: 'p3', name: 'Cara' }, // sin isHost ⇒ false
      ],
    });
    expect(res).not.toBeNull();
    expect(res!.hostId).toBeNull();
    expect(res!.players).toHaveLength(2);
    expect(res!.players[1]).toEqual({ id: 'p3', name: 'Cara', isHost: false });
  });

  it('acepta un roster vacío (todos se fueron)', () => {
    const res = parseRoster({ type: 'roster', hostId: null, players: [] });
    expect(res).not.toBeNull();
    expect(res!.players).toHaveLength(0);
  });
});
