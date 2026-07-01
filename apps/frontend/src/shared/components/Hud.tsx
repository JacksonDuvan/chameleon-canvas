/**
 * Hud — UI superpuesta. Lee SOLO estado LENTO del worldStore con selectores reactivos
 * de Zustand (fase, resultado, conexión, host, rol, error): cambian rara vez, así que
 * es seguro re-renderizar (skill `r3f-rendering`, regla 4). NUNCA lee estado por-frame:
 * la cuenta atrás se deriva del `serverTick` con un `setInterval`, no con `useFrame`.
 */
import { useEffect, useRef, useState } from 'react';
import { useStore } from 'zustand';
import { worldStore } from '@/features/canvas-3d/store/worldStore';
import { DEFAULT_SIM_CONFIG } from '@mecha/sim';

const PHASE_LABEL: Record<string, string> = {
  lobby: 'Lobby — esperando jugadores',
  prep: 'Preparación — ¡escóndete y camúflate!',
  hunt: 'Caza — los Seekers buscan',
  ended: 'Ronda terminada',
};

const HZ = DEFAULT_SIM_CONFIG.tickHz;
const PHASE_DURATION_S: Record<string, number | undefined> = {
  prep: DEFAULT_SIM_CONFIG.prepDurationTicks / HZ,
  hunt: DEFAULT_SIM_CONFIG.huntDurationTicks / HZ,
};

/**
 * Cuenta atrás aproximada de la fase (segundos). Deriva del `serverTick` leído de forma
 * TRANSITORIA (getState) con un `setInterval` a 4 Hz — sin re-render por frame ni acceso
 * reactivo al estado rápido. Aproximada: cuenta desde que el cliente VE el cambio de fase.
 */
function usePhaseCountdown(phase: string): number | null {
  const [left, setLeft] = useState<number | null>(null);
  useEffect(() => {
    const total = PHASE_DURATION_S[phase];
    if (total === undefined) {
      setLeft(null);
      return;
    }
    const startTick = worldStore.getState().serverTick;
    const compute = (): void => {
      const elapsed = (worldStore.getState().serverTick - startTick) / HZ;
      setLeft(Math.max(0, Math.ceil(total - elapsed)));
    };
    compute();
    const id = setInterval(compute, 250);
    return () => clearInterval(id);
  }, [phase]);
  return left;
}

interface LocalStatus {
  camo: number; // 0..1 camuflaje del jugador local
  watched: boolean; // un Seeker lo está fijando
  caught: boolean; // fue atrapado
}

/**
 * Estado de camuflaje/detección del jugador local, leído de forma TRANSITORIA (getState)
 * con un `setInterval` (no por frame ni con selector reactivo sobre estado rápido). El
 * bail-out (`prev`) evita re-render salvo cambio real; en Hunt (Hider congelado) el score
 * es estable ⇒ no re-renderiza. Skill `r3f-rendering`.
 */
function useLocalStatus(): LocalStatus {
  const [status, setStatus] = useState<LocalStatus>({ camo: 0, watched: false, caught: false });
  useEffect(() => {
    const compute = (): void => {
      const l = worldStore.getState().local;
      setStatus((prev) =>
        prev.camo === l.camoScore && prev.watched === l.beingWatched && prev.caught === l.caught
          ? prev
          : { camo: l.camoScore, watched: l.beingWatched, caught: l.caught },
      );
    };
    compute();
    const id = setInterval(compute, 150);
    return () => clearInterval(id);
  }, []);
  return status;
}

/** Destello transitorio cuando el jugador local acaba de ser atrapado (false→true). */
function useJustCaught(caught: boolean): boolean {
  const [flash, setFlash] = useState(false);
  const prev = useRef(false);
  useEffect(() => {
    if (caught && !prev.current) {
      prev.current = true;
      setFlash(true);
      const id = setTimeout(() => setFlash(false), 2500);
      return () => clearTimeout(id);
    }
    if (!caught) prev.current = false;
    return undefined;
  }, [caught]);
  return flash;
}

/** Color de la barra de camuflaje: rojo (0) → ámbar → verde (1). */
function camoColor(v: number): string {
  return `hsl(${Math.round(v * 120)}, 75%, 45%)`;
}

const BAR: React.CSSProperties = {
  position: 'absolute',
  top: 0,
  left: 0,
  right: 0,
  padding: '12px 16px',
  display: 'flex',
  gap: 16,
  alignItems: 'center',
  font: '14px system-ui, sans-serif',
  color: '#fff',
  background: 'linear-gradient(#0009, #0000)',
  pointerEvents: 'none',
};

const BTN: React.CSSProperties = {
  pointerEvents: 'auto',
  cursor: 'pointer',
  border: 0,
  borderRadius: 8,
  padding: '10px 18px',
  font: '600 15px system-ui, sans-serif',
  color: '#0b1020',
  background: '#ffd54a',
};

export function Hud({ onStart, onRestart }: { onStart: () => void; onRestart: () => void }) {
  const phase = useStore(worldStore, (s) => s.phase);
  const outcome = useStore(worldStore, (s) => s.outcome);
  const connected = useStore(worldStore, (s) => s.connected);
  const isHost = useStore(worldStore, (s) => s.isHost);
  const localRole = useStore(worldStore, (s) => s.localRole);
  const lastError = useStore(worldStore, (s) => s.lastError);
  const countdown = usePhaseCountdown(phase);
  const status = useLocalStatus();
  const justCaught = useJustCaught(status.caught);

  const roleBadge =
    localRole === 'seeker' ? '🔦 Eres Seeker — atrapa a los Hiders' : '🦎 Eres Hider — escóndete';

  // La barra de camuflaje y el aviso de fijación son para el Hider vivo, en juego.
  const showCamo = localRole === 'hider' && !status.caught && (phase === 'prep' || phase === 'hunt');
  const camoPct = Math.round(status.camo * 100);

  return (
    <>
      {/* Barra superior: identidad de ronda + estado */}
      <div style={BAR}>
        <strong>🦎 Meccha Chameleon</strong>
        <span style={{ opacity: 0.85 }}>{PHASE_LABEL[phase] ?? phase}</span>
        {countdown !== null && (
          <span style={{ fontVariantNumeric: 'tabular-nums', opacity: 0.95 }}>⏱ {countdown}s</span>
        )}
        {phase !== 'lobby' && <span style={{ opacity: 0.95 }}>{roleBadge}</span>}
        <span style={{ opacity: 0.6 }}>{connected ? '● conectado' : '○ desconectado'}</span>
        {lastError && <span style={{ color: '#ff8a8a' }}>⚠ {lastError}</span>}
        <span style={{ marginLeft: 'auto', opacity: 0.5 }}>
          WASD mover · E absorber color · Espacio pose · F (mantén) fijar y atrapar
        </span>
      </div>

      {/* Barra de camuflaje (Hider): verde = fundido con el entorno, rojo = visible */}
      {showCamo && (
        <div
          style={{
            position: 'absolute',
            bottom: 24,
            left: '50%',
            transform: 'translateX(-50%)',
            width: 260,
            font: '600 13px system-ui, sans-serif',
            color: '#fff',
            textShadow: '0 1px 2px #000a',
            pointerEvents: 'none',
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
            <span>Camuflaje</span>
            <span style={{ fontVariantNumeric: 'tabular-nums' }}>{camoPct}%</span>
          </div>
          <div style={{ height: 10, borderRadius: 6, background: '#0006', overflow: 'hidden' }}>
            <div
              style={{
                width: `${camoPct}%`,
                height: '100%',
                background: camoColor(status.camo),
                transition: 'width 120ms linear, background 120ms linear',
              }}
            />
          </div>
          {phase === 'prep' && (
            <div style={{ opacity: 0.7, fontWeight: 400, marginTop: 4 }}>
              Absorbe (E) el color de tu escondite y quédate quieto para fundirte
            </div>
          )}
        </div>
      )}

      {/* Aviso de fijación: un Seeker te está mirando AHORA */}
      {showCamo && status.watched && (
        <div
          style={{
            position: 'absolute',
            top: 64,
            left: '50%',
            transform: 'translateX(-50%)',
            padding: '8px 18px',
            borderRadius: 10,
            background: '#c0202088',
            border: '1px solid #ff6a6a',
            color: '#fff',
            font: '700 15px system-ui, sans-serif',
            pointerEvents: 'none',
          }}
        >
          👁 ¡Te están fijando! Aguanta camuflado…
        </div>
      )}

      {/* Destello al ser atrapado */}
      {justCaught && (
        <div
          style={{
            position: 'absolute',
            inset: 0,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: '#c0202033',
            color: '#fff',
            font: '800 30px system-ui, sans-serif',
            textShadow: '0 2px 8px #000',
            pointerEvents: 'none',
          }}
        >
          ¡Atrapado! Ahora eres Seeker 🔦
        </div>
      )}

      {/* Botón Empezar (solo el host, en Lobby) */}
      {phase === 'lobby' && (
        <div
          style={{
            position: 'absolute',
            bottom: 28,
            left: 0,
            right: 0,
            textAlign: 'center',
            pointerEvents: 'none',
          }}
        >
          {isHost ? (
            <button type="button" onClick={onStart} style={BTN}>
              ▶ Empezar partida
            </button>
          ) : (
            <span style={{ color: '#fff', opacity: 0.75, font: '14px system-ui' }}>
              esperando a que el host inicie la partida…
            </span>
          )}
        </div>
      )}

      {/* Panel central de fin de ronda + "Jugar otra vez" */}
      {phase === 'ended' && (
        <div
          style={{
            position: 'absolute',
            inset: 0,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 18,
            color: '#fff',
            background: '#0008',
            pointerEvents: 'none',
          }}
        >
          <div style={{ font: '700 28px system-ui, sans-serif' }}>
            {outcome === 'hiders'
              ? '🦎 ¡Ganan los Hiders! Sobrevivió al menos uno.'
              : outcome === 'seekers'
                ? '🔦 ¡Ganan los Seekers! Cayeron todos los Hiders.'
                : 'Ronda terminada'}
          </div>
          {isHost ? (
            <button type="button" onClick={onRestart} style={BTN}>
              ↻ Jugar otra vez
            </button>
          ) : (
            <span style={{ opacity: 0.75 }}>esperando a que el host reinicie…</span>
          )}
        </div>
      )}
    </>
  );
}
