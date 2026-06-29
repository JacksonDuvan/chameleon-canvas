/**
 * Hud — UI superpuesta. Lee SOLO estado LENTO del worldStore con selectores
 * reactivos de Zustand (fase, resultado, conexión, host, error): cambian rara vez,
 * así que es seguro re-renderizar (skill `r3f-rendering`, regla 4). NUNCA lee estado
 * por-frame.
 */
import { useStore } from 'zustand';
import { worldStore } from '@/features/canvas-3d/store/worldStore';

const PHASE_LABEL: Record<string, string> = {
  lobby: 'Lobby — esperando',
  prep: 'Preparación — ¡camúflate! (E para absorber color)',
  hunt: 'Caza — Seekers a buscar',
  ended: 'Fin de ronda',
};

export function Hud({ onStart }: { onStart: () => void }) {
  const phase = useStore(worldStore, (s) => s.phase);
  const outcome = useStore(worldStore, (s) => s.outcome);
  const connected = useStore(worldStore, (s) => s.connected);
  const isHost = useStore(worldStore, (s) => s.isHost);
  const lastError = useStore(worldStore, (s) => s.lastError);

  return (
    <div
      style={{
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
      }}
    >
      <strong>🦎 Meccha Chameleon</strong>
      <span style={{ opacity: 0.85 }}>{PHASE_LABEL[phase] ?? phase}</span>
      <span style={{ opacity: 0.6 }}>{connected ? '● conectado' : '○ desconectado'}</span>
      {outcome !== 'none' && (
        <span>Ganan: {outcome === 'hiders' ? 'Hiders' : 'Seekers'}</span>
      )}
      {phase === 'lobby' &&
        (isHost ? (
          <button type="button" onClick={onStart} style={{ pointerEvents: 'auto' }}>
            Empezar (eres el host)
          </button>
        ) : (
          <span style={{ opacity: 0.7 }}>esperando a que el host inicie…</span>
        ))}
      {lastError && <span style={{ color: '#ff8a8a' }}>⚠ {lastError}</span>}
      <span style={{ marginLeft: 'auto', opacity: 0.5 }}>
        WASD mover · F cazar · Espacio congelar · E color
      </span>
    </div>
  );
}
