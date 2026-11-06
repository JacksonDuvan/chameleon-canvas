/**
 * Contrato del CÓDIGO DE SALA (compartido backend↔frontend).
 *
 * El código es lo que un host comparte y con lo que el resto se une: debe ser
 * corto, sin caracteres ambiguos (0/O, 1/I/L, U) y validable en el cliente
 * ANTES de abrir el socket (feedback inmediato, biblia UX "unión por código").
 *
 * Alfabeto: Crockford base32 (32 símbolos ⇒ 5 bits/byte, sin sesgo de módulo).
 */
import { describe, it, expect } from 'vitest';
import {
  ROOM_CODE_ALPHABET,
  ROOM_CODE_LENGTH,
  isValidRoomCode,
  normalizeRoomCode,
  roomCodeFromBytes,
} from './index';

describe('roomCodeFromBytes (determinista)', () => {
  it('produce un código de la longitud pedida con solo símbolos del alfabeto', () => {
    const code = roomCodeFromBytes(new Uint8Array([1, 2, 3, 4, 5]));
    expect(code.length).toBe(ROOM_CODE_LENGTH);
    for (const ch of code) expect(ROOM_CODE_ALPHABET).toContain(ch);
  });

  it('mismos bytes ⇒ mismo código (determinismo puro, sin Math.random)', () => {
    const bytes = new Uint8Array([0, 17, 255, 128, 31, 200, 7, 90, 45, 3]);
    expect(roomCodeFromBytes(bytes)).toBe(roomCodeFromBytes(bytes));
  });

  it('usa los 5 bits bajos de cada byte: cada símbolo es alphabet[byte & 31]', () => {
    const bytes = new Uint8Array([0, 31, 32, 33, 63]);
    expect(roomCodeFromBytes(bytes)).toBe(
      `${ROOM_CODE_ALPHABET[0]}${ROOM_CODE_ALPHABET[31]}${ROOM_CODE_ALPHABET[0]}${ROOM_CODE_ALPHABET[1]}${ROOM_CODE_ALPHABET[31]}`,
    );
  });

  it('todos los valores de byte mapean a símbolos válidos (0..255)', () => {
    for (let b = 0; b < 256; b++) {
      const code = roomCodeFromBytes(new Uint8Array([b, b, b, b, b]));
      expect(isValidRoomCode(code)).toBe(true);
    }
  });
});

describe('isValidRoomCode', () => {
  it('acepta un código del alfabeto con la longitud exacta', () => {
    expect(isValidRoomCode('7Q3HB')).toBe(true);
  });

  it('rechaza minúsculas (el código se comparte en mayúsculas)', () => {
    expect(isValidRoomCode('7q3hb')).toBe(false);
  });

  it('rechaza caracteres ambiguos fuera del alfabeto (letras I, L, O, U)', () => {
    expect(isValidRoomCode('7Q3HI')).toBe(false);
    expect(isValidRoomCode('7Q3HL')).toBe(false);
    expect(isValidRoomCode('7Q3HO')).toBe(false);
    expect(isValidRoomCode('7Q3HU')).toBe(false);
    // Los DÍGITOS 0 y 1 sí son válidos en Crockford (no hay O ni I que confundan).
    expect(isValidRoomCode('7Q3H0')).toBe(true);
    expect(isValidRoomCode('7Q3H1')).toBe(true);
  });

  it('rechaza longitudes incorrectas y la cadena vacía', () => {
    expect(isValidRoomCode('')).toBe(false);
    expect(isValidRoomCode('7Q3H')).toBe(false);
    expect(isValidRoomCode('7Q3HBX')).toBe(false);
  });
});

describe('normalizeRoomCode (UX: limpiar lo que pega el usuario)', () => {
  it('pasa a mayúsculas y elimina espacios, guiones y otros separadores', () => {
    expect(normalizeRoomCode(' 7 q 3 - h b ')).toBe('7Q3HB');
  });

  it('elimina caracteres fuera del alfabeto (p. ej. letras ambiguas pegadas)', () => {
    expect(normalizeRoomCode('7Q3HO')).toBe('7Q3H');
    expect(normalizeRoomCode('7Q3h1')).toBe('7Q3H1'); // dígitos válidos pasan
  });

  it('nunca devuelve más de ROOM_CODE_LENGTH caracteres', () => {
    expect(normalizeRoomCode('7Q3HB99999').length).toBeLessThanOrEqual(ROOM_CODE_LENGTH);
  });

  it('es idempotente respecto a isValidRoomCode: un código válido no cambia', () => {
    expect(normalizeRoomCode('7Q3HB')).toBe('7Q3HB');
  });
});
