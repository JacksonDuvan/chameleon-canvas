/**
 * Contrato del CÓDIGO DE SALA — compartido por backend (genera) y frontend
 * (valida antes de conectar). Skill `hexagonal-vertical-slicing`: esto es un
 * CONTRATO de red, no lógica de juego ⇒ vive en `@mecha/shared`.
 *
 * Alfabeto **Crockford base32** (32 símbolos, 5 bits/byte sin sesgo de módulo):
 * elimina las LETRAS ambiguas al leer de pantalla o dictar (sin I/L/O/U); los
 * dígitos 0 y 1 se quedan porque no hay O ni I con las que confundirlos.
 */
export const ROOM_CODE_LENGTH = 5;
export const ROOM_CODE_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

/**
 * Genera un código desde bytes aleatorios. DETERMINISTA (misma entrada ⇒ mismo
 * código): la entropía la inyecta el caller (puerto IRandomSource en el backend),
 * así el dominio no toca `Math.random` ni `crypto` (skill `hexagonal-vertical-slicing`).
 * Usa los 5 bits bajos de cada byte (32 símbolos ⇒ sin sesgo de módulo).
 */
export function roomCodeFromBytes(bytes: Uint8Array): string {
  let out = '';
  const n = Math.min(bytes.length, ROOM_CODE_LENGTH);
  for (let i = 0; i < n; i++) {
    out += ROOM_CODE_ALPHABET[bytes[i]! & 31];
  }
  return out;
}

/** ¿Es un código bien formado? (longitud exacta + solo símbolos del alfabeto) */
export function isValidRoomCode(code: string): boolean {
  if (code.length !== ROOM_CODE_LENGTH) return false;
  for (let i = 0; i < code.length; i++) {
    if (!ROOM_CODE_ALPHABET.includes(code[i]!)) return false;
  }
  return true;
}

/**
 * Limpia lo que pega el usuario: mayúsculas, sin separadores (espacios/guiones)
 * y sin caracteres fuera del alfabeto. Acota a la longitud del código. Pensado
 * para el input del RoomForm (feedback inmediato en el cliente, biblia UX).
 */
export function normalizeRoomCode(input: string): string {
  let out = '';
  const upper = input.toUpperCase();
  for (let i = 0; i < upper.length && out.length < ROOM_CODE_LENGTH; i++) {
    if (ROOM_CODE_ALPHABET.includes(upper[i]!)) out += upper[i];
  }
  return out;
}
