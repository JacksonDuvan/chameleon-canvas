/**
 * Hud — UI superpuesta. Lee SOLO estado LENTO del worldStore con selectores reactivos
 * de Zustand (fase, resultado, conexión, host, rol, error): cambian rara vez, así que
 * es seguro re-renderizar (skill `r3f-rendering`, regla 4). NUNCA lee estado por-frame:
 * la cuenta atrás se deriva del `serverTick` con un `setInterval`, no con `useFrame`.
 */
import { useEffect, useState } from 'react';
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

  const roleBadge =
    localRole === 'seeker' ? '🔦 Eres Seeker — atrapa a los Hiders' : '🦎 Eres Hider — escóndete';

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
          WASD mover · E absorber color · Espacio pose · F atrapar
        </span>
      </div>

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
