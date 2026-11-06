/**
 * Sesión de matchmaking del jugador (lógica PURA, Storage inyectado para tests).
 *
 * - `mecha.session` en **sessionStorage**: sala + nombre actuales. Cada PESTAÑA
 *   es un jugador distinto (clave para probar el juego con dos tabs abiertos).
 * - `mecha.lastName` en **localStorage**: recuerda el nombre entre sesiones.
 *
 * Defensivo por diseño: el storage del navegador puede estar lleno/deshabilitado
 * (modo privado) ⇒ todos los accesos están guardados y devuelven null/'' en vez
 * de lanzar (el juego NUNCA se rompe por el storage).
 */
export interface Session {
  readonly roomId: string;
  readonly name: string;
  /**
   * V1-H: regla de silbidos que fija el HOST al crear la sala (viaja como query
   * param al conectar; solo aplica a la creación FRESH de la sala).
   */
  readonly whistling?: boolean;
}

const SESSION_KEY = 'mecha.session';
const NAME_KEY = 'mecha.lastName';

export function readSession(storage: Storage): Session | null {
  try {
    const raw = storage.getItem(SESSION_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { roomId?: unknown; name?: unknown; whistling?: unknown };
    if (typeof parsed.roomId === 'string' && typeof parsed.name === 'string' && parsed.roomId && parsed.name) {
      return {
        roomId: parsed.roomId,
        name: parsed.name,
        // Solo transporta el flag cuando está ACTIVO (sessions mínimas por defecto).
        ...(parsed.whistling === true ? { whistling: true } : {}),
      };
    }
    return null;
  } catch {
    return null;
  }
}

export function saveSession(storage: Storage, session: Session): void {
  try {
    storage.setItem(SESSION_KEY, JSON.stringify(session));
  } catch {
    /* storage lleno/deshabilitado: la sesión vive solo en memoria */
  }
}

export function clearSession(storage: Storage): void {
  try {
    storage.removeItem(SESSION_KEY);
  } catch {
    /* nada que hacer */
  }
}

export function readLastName(storage: Storage): string {
  try {
    return storage.getItem(NAME_KEY) ?? '';
  } catch {
    return '';
  }
}

export function saveLastName(storage: Storage, name: string): void {
  const trimmed = name.trim();
  if (!trimmed) return; // no pisar un nombre bueno con uno vacío
  try {
    storage.setItem(NAME_KEY, trimmed);
  } catch {
    /* modo privado: sin memoria entre sesiones */
  }
}
