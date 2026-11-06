/**
 * Tests del parseo del mensaje `whistle` (JSON de control del DO). La red NUNCA
 * se confía: entradas malformadas ⇒ null (y el juego sigue sin sonar, sin romperse).
 */
import { describe, it, expect } from 'vitest';
import { parseWhistle } from './whistleEvent';

describe('parseWhistle', () => {
  it('parsea un silbido válido con posición', () => {
    const w = parseWhistle({ type: 'whistle', playerId: 'p1', x: 1.5, y: 2, z: -3.25 });
    expect(w).toEqual({ playerId: 'p1', x: 1.5, y: 2, z: -3.25 });
  });

  it('devuelve null si no es un whistle', () => {
    expect(parseWhistle({ type: 'roster', players: [] })).toBeNull();
    expect(parseWhistle({ type: 'welcome' })).toBeNull();
    expect(parseWhistle(null)).toBeNull();
    expect(parseWhistle('whistle')).toBeNull();
  });

  it('devuelve null si falta playerId o las coords no son finitas', () => {
    expect(parseWhistle({ type: 'whistle', x: 1, y: 2, z: 3 })).toBeNull();
    expect(parseWhistle({ type: 'whistle', playerId: 'p1', x: NaN, y: 2, z: 3 })).toBeNull();
    expect(parseWhistle({ type: 'whistle', playerId: 'p1', x: '1', y: 2, z: 3 })).toBeNull();
    expect(parseWhistle({ type: 'whistle', playerId: 'p1', x: Infinity, y: 2, z: 3 })).toBeNull();
  });
});
