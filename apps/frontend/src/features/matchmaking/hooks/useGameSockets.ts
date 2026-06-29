/**
 * useGameSockets — adaptador de transporte del cliente. Abre el WebSocket al DO,
 * PREDICE el input local (mismas funciones de `@mecha/sim` que el servidor),
 * RECONCILIA con cada snapshot (descarta inputs confirmados y re-aplica el resto, sin
 * snap) y acumula buffers de los remotos para INTERPOLAR. Escribe en `worldStore`.
 *
 * Skills: `authoritative-netcode` (predicción/reconciliación/interpolación) +
 * `r3f-rendering` (escribe el store vanilla, NO estado de React; el estado rápido se
 * muta in situ) + `tdd-testing` (la lógica pura vive en `prediction.ts`/`interpolation.ts`
 * y está testeada; este hook solo cablea el socket y el ciclo de vida).
 */
import { useCallback, useEffect, useRef } from 'react';
import { worldStore } from '@/features/canvas-3d/store/worldStore';
import { pushRemoteSnapshot } from '@/features/canvas-3d/hooks/interpolation';
import { reconcile, predict, type PendingInput } from './prediction';
import { WS_URL } from '@/endpoints';
import {
  encodeInput,
  decodeSnapshot,
  type ActionKind,
  type DecodedSnapshot,
  type UserCommand,
} from '@mecha/shared';
import { DEFAULT_SIM_CONFIG, Vec3 } from '@mecha/sim';

const DT = 1 / DEFAULT_SIM_CONFIG.tickHz;
const MAX_PENDING_INPUTS = 120; // ~4 s a 30 Hz: cota ante pérdida de snapshots

export interface InputIntent {
  readonly moveX: number;
  readonly moveZ: number;
  readonly aimX: number;
  readonly aimZ: number;
  readonly action: ActionKind;
}

export interface GameSockets {
  /** Envía un input (predice local + lo manda al servidor). */
  sendInput: (intent: InputIntent) => void;
  /** Envía un mensaje de control JSON (start/color/chat). */
  sendControl: (msg: Record<string, unknown>) => void;
}

function handleControlMessage(raw: string): void {
  try {
    const msg = JSON.parse(raw) as {
      type?: string;
      playerId?: string;
      isHost?: boolean;
      cmd?: string;
      kind?: string;
    };
    if (msg.type === 'welcome' && msg.playerId) {
      // Por si un snapshot creó al local como remoto antes del welcome (race): bórralo.
      worldStore.getState().remotes.delete(msg.playerId);
      worldStore.setState({ localPlayerId: msg.playerId, isHost: msg.isHost === true });
    } else if (msg.type === 'host') {
      // El servidor reasignó el host (el host anterior se desconectó).
      worldStore.setState({ isHost: msg.isHost === true });
    } else if (msg.type === 'error') {
      // El servidor rechazó un control (p. ej. NotHost al pulsar Empezar sin ser host).
      worldStore.setState({ lastError: `${msg.cmd ?? 'cmd'}: ${msg.kind ?? 'error'}` });
    }
  } catch {
    /* mensaje malformado: ignorar */
  }
}

function applySnapshot(snap: DecodedSnapshot, pending: PendingInput[]): void {
  const st = worldStore.getState();
  // Ignora snapshots previos al `welcome`: sin `localPlayerId` no podemos distinguir
  // al jugador local del resto y se crearía como un remoto fantasma (doble render).
  if (!st.localPlayerId) return;
  const now = performance.now();
  const seen = new Set<string>();

  for (const p of snap.players) {
    if (p.id === st.localPlayerId) {
      // Jugador local: reconciliar (re-aplica los inputs no confirmados; sin snap).
      reconcile(st.local, pending, p, snap.phase, DEFAULT_SIM_CONFIG);
      continue;
    }
    seen.add(p.id);
    let e = st.remotes.get(p.id);
    if (!e) {
      e = {
        id: p.id,
        buffer: [],
        render: new Vec3(p.x, p.y, p.z),
        role: p.role,
        frozen: p.frozen,
        caught: p.caught,
        colorPacked: p.colorPacked,
      };
      st.remotes.set(p.id, e);
    }
    pushRemoteSnapshot(e.buffer, { tick: snap.tick, recvAt: now, x: p.x, y: p.y, z: p.z });
    e.role = p.role;
    e.frozen = p.frozen;
    e.caught = p.caught;
    e.colorPacked = p.colorPacked;
  }

  // Un KEYFRAME es estado completo: elimina remotos ausentes (cambios de roster).
  if (snap.type === 'keyframe') {
    for (const id of [...st.remotes.keys()]) {
      if (id !== st.localPlayerId && !seen.has(id)) st.remotes.delete(id);
    }
  }

  st.serverTick = snap.tick; // RÁPIDO: mutación in situ
  worldStore.setState({ phase: snap.phase, outcome: snap.outcome }); // LENTO: notifica al HUD
}

export function useGameSockets(roomId: string, name: string): GameSockets {
  const wsRef = useRef<WebSocket | null>(null);
  const pendingRef = useRef<PendingInput[]>([]);
  const seqRef = useRef(0);

  useEffect(() => {
    const ws = new WebSocket(
      `${WS_URL}/api/rooms/${roomId}/ws?name=${encodeURIComponent(name)}`,
    );
    ws.binaryType = 'arraybuffer';
    wsRef.current = ws;
    pendingRef.current.length = 0;

    ws.onopen = () => worldStore.setState({ connected: true });
    ws.onclose = () => worldStore.setState({ connected: false });
    ws.onmessage = (ev: MessageEvent) => {
      if (typeof ev.data === 'string') handleControlMessage(ev.data);
      else applySnapshot(decodeSnapshot(ev.data as ArrayBuffer), pendingRef.current);
    };

    return () => {
      ws.close();
      wsRef.current = null;
    };
  }, [roomId, name]);

  const sendInput = useCallback((intent: InputIntent) => {
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    const st = worldStore.getState();
    const seq = ++seqRef.current;
    const cmd: UserCommand = { seq, playerId: st.localPlayerId ?? 'local', ...intent };
    const input: PendingInput = { seq, cmd, dt: DT };

    // Predicción local inmediata + buffer de inputs pendientes (para reconciliar).
    predict(st.local, input, st.phase, DEFAULT_SIM_CONFIG);
    if (pendingRef.current.length >= MAX_PENDING_INPUTS) pendingRef.current.shift(); // cota
    pendingRef.current.push(input);
    ws.send(encodeInput({ seq, ...intent }));
  }, []);

  const sendControl = useCallback((msg: Record<string, unknown>) => {
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
  }, []);

  return { sendInput, sendControl };
}
