/**
 * RoomForm — pantalla de ENTRADA (V1-E): nombre + crear sala o unirse por código.
 * UI pura: consume lógica vía los hooks/módulos puros (`api.ts`, `session.ts`);
 * cero reglas de negocio aquí (skill `hexagonal-vertical-slicing`).
 *
 * Contratos de la biblia UX (`ux-ui-spec.md` §Lobby): unión por código con
 * feedback claro ("haz esos campos claros y validados"): el código se normaliza
 * al escribir (mayúsculas, sin ambiguos) y se comprueba la sala ANTES de abrir
 * el socket (pre-flight: evita el reintento infinito si la ronda ya empezó).
 */
import { useState, type ChangeEvent, type FormEvent } from 'react';
import { createRoom, listRooms, roomStatus, type ApiError } from '../hooks/api';
import {
  readLastName,
  saveLastName,
  type Session,
} from '../hooks/session';
import { isValidRoomCode, normalizeRoomCode, ROOM_CODE_LENGTH } from '@mecha/shared';
import type { RoomSummary } from '@mecha/shared';

const ERROR_TEXT: Record<ApiError['kind'], string> = {
  Network: 'no se pudo llegar al servidor (¿está caído?)',
  ServerError: 'el servidor rechazó la operación',
  BadResponse: 'respuesta inesperada del servidor',
  InvalidName: 'ponte un nombre (1–24 caracteres)',
};

/** Mensaje legible del pre-flight: por qué NO puedes entrar a esa sala. */
function joinRefusalText(status: { phase: string; players: number; maxPlayers: number }): string {
  if (status.players >= status.maxPlayers) return 'esa sala está llena';
  if (status.phase !== 'lobby') return 'la partida ya está en curso — espera a que termine';
  return 'no puedes entrar a esa sala';
}

export function RoomForm({ onEnter }: { onEnter: (session: Session) => void }) {
  const [name, setName] = useState(() => readLastName(window.localStorage));
  const [code, setCode] = useState('');
  const [whistling, setWhistling] = useState(false); // V1-H: regla del host
  const [busy, setBusy] = useState<'create' | 'join' | 'list' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [rooms, setRooms] = useState<RoomSummary[] | null>(null);

  const trimmedName = (): string => name.trim().slice(0, 24);

  const enter = (roomId: string, playerName: string, hostRule?: boolean): void => {
    saveLastName(window.localStorage, playerName);
    onEnter({ roomId, name: playerName, ...(hostRule ? { whistling: true } : {}) });
  };

  const handleCreate = async (): Promise<void> => {
    const hostName = trimmedName();
    if (!hostName) {
      setError('ponte un nombre primero');
      return;
    }
    setBusy('create');
    setError(null);
    const res = await createRoom(hostName);
    setBusy(null);
    if (!res.ok) {
      setError(ERROR_TEXT[res.error.kind]);
      return;
    }
    enter(res.value.roomId, hostName, whistling);
  };

  const handleJoin = async (): Promise<void> => {
    const playerName = trimmedName();
    if (!playerName) {
      setError('ponte un nombre primero');
      return;
    }
    const roomId = normalizeRoomCode(code);
    if (!isValidRoomCode(roomId)) {
      setError(`código no válido: ${ROOM_CODE_LENGTH} caracteres (sin I, L, O ni U)`);
      return;
    }
    setBusy('join');
    setError(null);
    const status = await roomStatus(roomId);
    setBusy(null);
    if (!status.ok) {
      setError(ERROR_TEXT[status.error.kind]);
      return;
    }
    if (!status.value.joinable) {
      setError(joinRefusalText(status.value));
      return;
    }
    enter(roomId, playerName);
  };

  const handleListRooms = async (): Promise<void> => {
    setBusy('list');
    setError(null);
    const res = await listRooms();
    setBusy(null);
    if (!res.ok) {
      setError(ERROR_TEXT[res.error.kind]);
      return;
    }
    setRooms(res.value);
  };

  const onNameChange = (e: ChangeEvent<HTMLInputElement>): void => setName(e.target.value);
  const onCodeChange = (e: ChangeEvent<HTMLInputElement>): void =>
    setCode(normalizeRoomCode(e.target.value));

  const onSubmit = (e: FormEvent): void => e.preventDefault();

  return (
    <div className="lobby-screen">
      <form className="lobby-card" onSubmit={onSubmit}>
        <h1 className="lobby-title">🦎 Meccha Chameleon</h1>
        <p className="lobby-tag">Píntate, posa y desaparece… o caza a los camaleones.</p>

        <label className="lobby-label" htmlFor="lobby-name">
          Tu nombre
          <input
            id="lobby-name"
            className="lobby-input"
            value={name}
            onChange={onNameChange}
            maxLength={24}
            autoComplete="nickname"
            placeholder="Jugador"
          />
        </label>

        <button type="button" className="hud-btn lobby-btn" disabled={busy !== null} onClick={handleCreate}>
          {busy === 'create' ? 'creando…' : '▶ Crear sala'}
        </button>

        <label className="lobby-rule" title="Regla opcional del host: en caza, cada Hider vivo emite silbidos que delatan su dirección.">
          <input
            type="checkbox"
            checked={whistling}
            onChange={(e) => setWhistling(e.target.checked)}
          />
          Silbidos: los Hiders emiten pistas sonoras en la caza
        </label>

        <div className="lobby-divider">
          <span>o únete con un código</span>
        </div>

        <label className="lobby-label" htmlFor="lobby-code">
          Código de sala
          <input
            id="lobby-code"
            className="lobby-input lobby-input--code"
            value={code}
            onChange={onCodeChange}
            placeholder="7Q3HB"
            autoComplete="off"
            spellCheck={false}
            autoCapitalize="characters" /* móvil: teclado en mayúsculas para códigos */
          />
        </label>

        <button type="button" className="hud-btn lobby-btn" disabled={busy !== null} onClick={handleJoin}>
          {busy === 'join' ? 'comprobando…' : '🚪 Unirse'}
        </button>

        <button
          type="button"
          className="lobby-list-toggle"
          disabled={busy !== null}
          onClick={handleListRooms}
        >
          {busy === 'list' ? 'buscando…' : rooms === null ? '🔄 ver salas activas' : '🔄 refrescar'}
        </button>

        {rooms !== null && (
          <div className="lobby-rooms">
            {rooms.length === 0 ? (
              <span className="lobby-rooms-empty">no hay salas activas — crea la primera</span>
            ) : (
              rooms.map((r) => (
                <button
                  type="button"
                  key={r.roomId}
                  className="lobby-room-chip"
                  onClick={() => setCode(r.roomId)}
                >
                  <strong>{r.roomId}</strong> · {r.hostName}
                </button>
              ))
            )}
          </div>
        )}

        {error && <p className="lobby-error">⚠ {error}</p>}
      </form>
    </div>
  );
}
