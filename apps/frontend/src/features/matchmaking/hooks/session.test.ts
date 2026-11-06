/**
 * Tests de la sesión de matchmaking (lógica PURA fuera de React; skill
 * `tdd-testing`). sessionStorage = sala actual (cada pestaña es un jugador,
 * ideal para probar con dos tabs); localStorage recuerda el último nombre.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import {
  readSession,
  saveSession,
  clearSession,
  readLastName,
  saveLastName,
  type Session,
} from './session';

/** Storage fake (Map) — el mismo contrato que Storage del navegador. */
function fakeStorage(): Storage {
  const map = new Map<string, string>();
  const storage: Storage = {
    get length() {
      return map.size;
    },
    clear: () => map.clear(),
    getItem: (k: string) => map.get(k) ?? null,
    key: (i: number) => [...map.keys()][i] ?? null,
    removeItem: (k: string) => map.delete(k),
    setItem: (k: string, v: string) => map.set(k, String(v)),
  };
  return storage;
}

describe('sesión de sala (sessionStorage)', () => {
  let storage: Storage;
  beforeEach(() => {
    storage = fakeStorage();
  });

  it('roundtrip: save → read devuelve exactamente la sesión', () => {
    const s: Session = { roomId: '7Q3HB', name: 'Ana' };
    saveSession(storage, s);
    expect(readSession(storage)).toEqual(s);
  });

  it('read devuelve null si no hay sesión', () => {
    expect(readSession(storage)).toBeNull();
  });

  it('read es defensivo: JSON corrupto o incompleto ⇒ null (nunca lanza)', () => {
    storage.setItem('mecha.session', '{no-json');
    expect(readSession(storage)).toBeNull();
    storage.setItem('mecha.session', JSON.stringify({ roomId: 'X' }));
    expect(readSession(storage)).toBeNull();
    storage.setItem('mecha.session', JSON.stringify({ roomId: '', name: '' }));
    expect(readSession(storage)).toBeNull();
  });

  it('clear borra la sesión', () => {
    saveSession(storage, { roomId: '7Q3HB', name: 'Ana' });
    clearSession(storage);
    expect(readSession(storage)).toBeNull();
  });
});

describe('último nombre usado (localStorage)', () => {
  let storage: Storage;
  beforeEach(() => {
    storage = fakeStorage();
  });

  it('roundtrip y default vacío', () => {
    expect(readLastName(storage)).toBe('');
    saveLastName(storage, 'Ana');
    expect(readLastName(storage)).toBe('Ana');
  });

  it('guardar un nombre vacío NO pisa el anterior', () => {
    saveLastName(storage, 'Ana');
    saveLastName(storage, '   ');
    expect(readLastName(storage)).toBe('Ana');
  });
});
