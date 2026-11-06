/**
 * Hud — UI superpuesta. Lee SOLO estado LENTO del worldStore con selectores reactivos
 * de Zustand (fase, resultado, conexión, host, rol, error): cambian rara vez, así que
 * es seguro re-renderizar (skill `r3f-rendering`, regla 4). NUNCA lee estado por-frame:
 * la cuenta atrás se deriva del `serverTick` con un `setInterval`, no con `useFrame`.
 *
 * Presentación (V1-G): sistema de chips/overlays en `globals.css` ("juguete de selva":
 * tinta verde-bosque, amarillo-sol de marca, timer central con pulso, retícula de cruz).
 */
import { useEffect, useRef, useState } from 'react';
import { useStore } from 'zustand';
import { worldStore } from '@/features/canvas-3d/store/worldStore';
import { revealIndexAt } from '@/features/canvas-3d/hooks/reveal';
import { PlayerList } from '@/features/matchmaking/components/PlayerList';
import { audio } from '@/features/canvas-3d/audio/engine';
import { DEFAULT_SIM_CONFIG } from '@mecha/sim';

const PHASE_LABEL: Record<string, string> = {
  lobby: 'Lobby — esperando jugadores',
  prep: '¡Escóndete y camúflate!',
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
  caught: boolean; // fue atrapado
  pose: number; // pose actual del Hider (V1-B)
  ammo: number; // munición restante del Seeker (v4)
}

/**
 * Estado de camuflaje/detección del jugador local, leído de forma TRANSITORIA (getState)
 * con un `setInterval` (no por frame ni con selector reactivo sobre estado rápido). El
 * bail-out (`prev`) evita re-render salvo cambio real; en Hunt (Hider congelado) el score
 * es estable ⇒ no re-renderiza. Skill `r3f-rendering`.
 */
function useLocalStatus(): LocalStatus {
  const [status, setStatus] = useState<LocalStatus>({
    camo: 0,
    caught: false,
    pose: 0,
    ammo: 0,
  });
  useEffect(() => {
    const compute = (): void => {
      const l = worldStore.getState().local;
      setStatus((prev) =>
        prev.camo === l.camoScore &&
        prev.caught === l.caught &&
        prev.pose === l.pose &&
        prev.ammo === l.ammo
          ? prev
          : {
              camo: l.camoScore,
              caught: l.caught,
              pose: l.pose,
              ammo: l.ammo,
            },
      );
    };
    compute();
    const id = setInterval(compute, 120);
    return () => clearInterval(id);
  }, []);
  return status;
}

const POSE_LABEL = ['De pie', 'Agachado', 'Bola', 'Plano (pared)', 'Caja', 'Barril'];

/**
 * Hiders vivos/atrapados (feedback de captura para TODOS, como la fila de muñecos del
 * original). Derivado del estado rápido vía `getState()` + interval (nunca por frame);
 * bail-out si no cambió. Cuenta al local + remotos: atrapado = fue Hider y cayó.
 */
function useHidersCount(): { alive: number; caught: number } {
  const [v, setV] = useState({ alive: 0, caught: 0 });
  useEffect(() => {
    const compute = (): void => {
      const st = worldStore.getState();
      let alive = 0;
      let caught = 0;
      if (st.local.caught) caught++;
      else if (st.local.role === 'hider') alive++;
      for (const e of st.remotes.values()) {
        if (e.caught) caught++;
        else if (e.role === 'hider') alive++;
      }
      setV((prev) => (prev.alive === alive && prev.caught === caught ? prev : { alive, caught }));
    };
    compute();
    const id = setInterval(compute, 250);
    return () => clearInterval(id);
  }, []);
  return v;
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

/**
 * Índice del escondite en curso del tour de revelado (V1-F). Avanza por tiempo desde
 * `endedAt`; -1 = tour terminado (o sin tour) ⇒ panel final. Interval a 5 Hz con
 * bail-out (re-render solo al cambiar de escondite). La cámara (CameraRig) calcula el
 * MISMO índice con la misma función pura — HUD y cámara nunca se desincronizan.
 */
function useRevealIndex(endedAt: number | null, listLength: number): number {
  const [idx, setIdx] = useState(-1);
  useEffect(() => {
    if (endedAt === null || listLength === 0) {
      setIdx(-1);
      return;
    }
    const compute = (): void =>
      setIdx(revealIndexAt((performance.now() - endedAt) / 1000, listLength));
    compute();
    const id = setInterval(compute, 200);
    return () => clearInterval(id);
  }, [endedAt, listLength]);
  return idx;
}

/** Color CSS de la pintura final de un jugador (0xRRGGBBAA → #rrggbb). */
function packedToCss(packed: number): string {
  return `#${((packed >>> 8) & 0xffffff).toString(16).padStart(6, '0')}`;
}

/** Hit marker: visible ~400 ms cada vez que el servidor confirma una captura. */
function useHitMarker(): boolean {
  const hitPulse = useStore(worldStore, (s) => s.hitPulse);
  const [show, setShow] = useState(false);
  useEffect(() => {
    if (hitPulse <= 0) return undefined;
    setShow(true);
    const id = setTimeout(() => setShow(false), 400);
    return () => clearTimeout(id);
  }, [hitPulse]);
  return show;
}

/** V1-H — toggle de mute del motor de audio (pref recordada en localStorage). */
function AudioToggle() {
  const [muted, setMuted] = useState(() => audio.isMuted());
  const toggle = (): void => {
    const next = !muted;
    audio.setMuted(next);
    setMuted(next);
  };
  return (
    <button type="button" className="hud-chip hud-chip--audio" onClick={toggle} aria-pressed={muted}>
      {muted ? '🔇' : '🔊'}
    </button>
  );
}

export function Hud({
  onStart,
  onRestart,
  onLeave,
}: {
  onStart: () => void;
  onRestart: () => void;
  /** V1-E: salir de la sala (vuelve al RoomForm y limpia la sesión). */
  onLeave: () => void;
}) {
  const phase = useStore(worldStore, (s) => s.phase);
  const roomId = useStore(worldStore, (s) => s.roomId);
  const outcome = useStore(worldStore, (s) => s.outcome);
  const connected = useStore(worldStore, (s) => s.connected);
  const isHost = useStore(worldStore, (s) => s.isHost);
  const localRole = useStore(worldStore, (s) => s.localRole);
  const lastError = useStore(worldStore, (s) => s.lastError);
  const pointerLocked = useStore(worldStore, (s) => s.pointerLocked);
  const revealList = useStore(worldStore, (s) => s.revealList);
  const endedAt = useStore(worldStore, (s) => s.endedAt);
  const localPlayerId = useStore(worldStore, (s) => s.localPlayerId);
  const countdown = usePhaseCountdown(phase);
  const status = useLocalStatus();
  const justCaught = useJustCaught(status.caught);
  const hitMarker = useHitMarker();
  const hiders = useHidersCount();
  const revealIdx = useRevealIndex(endedAt, revealList?.length ?? 0);
  const revealEntry = revealIdx >= 0 ? (revealList?.[revealIdx] ?? null) : null;

  // La barra de camuflaje y la pose son para el Hider vivo, en juego.
  const showCamo = localRole === 'hider' && !status.caught && (phase === 'prep' || phase === 'hunt');
  const camoPct = Math.round(status.camo * 100);
  const seekerHunting = localRole === 'seeker' && phase === 'hunt';
  const seekerWaiting = localRole === 'seeker' && phase === 'prep';
  const inRound = phase === 'prep' || phase === 'hunt';

  return (
    <div className="hud">
      {/* Barra superior: identidad · timer/fase · estado */}
      <div className="hud-top">
        <div className="hud-cluster">
          <span className="hud-chip hud-chip--logo">🦎 Meccha Chameleon</span>
          {phase !== 'lobby' && (
            <span
              className={`hud-chip ${localRole === 'seeker' ? 'hud-chip--seeker' : 'hud-chip--hider'}`}
            >
              {localRole === 'seeker' ? '🔦 Seeker — atrapa' : '🦎 Hider — escóndete'}
            </span>
          )}
          {inRound && (
            <span className="hud-chip">
              🦎 quedan {hiders.alive}
              {hiders.caught > 0 ? ` · ✕ ${hiders.caught}` : ''}
            </span>
          )}
          {lastError && <span className="hud-chip hud-chip--error">⚠ {lastError}</span>}
        </div>
        <div className="hud-timer">
          {countdown !== null && (
            <span className={`hud-timer-count${countdown <= 10 ? ' hud-timer-count--low' : ''}`}>
              {countdown}s
            </span>
          )}
          <span className="hud-timer-phase">{PHASE_LABEL[phase] ?? phase}</span>
        </div>
        <div className="hud-cluster hud-cluster--right">
          <span className="hud-chip hud-chip--muted">
            {localRole === 'seeker'
              ? 'WASD mover · ratón mirar · click disparar'
              : 'WASD mover · ratón mirar · E absorber · R pose · T silbar'}
          </span>
          <AudioToggle />
          <span className="hud-chip hud-chip--muted">{connected ? '● conectado' : '○ desconectado'}</span>
        </div>
      </div>

      {/* Overlay del Seeker en PREPARATION: no ve el mapa mientras los Hiders se esconden.
          100% OPACO (ceguera funcional, biblia): rotar la cámara no revela NADA. */}
      {seekerWaiting && (
        <div className="hud-overlay hud-overlay--blind">
          <div className="hud-overlay-emoji">🔦</div>
          <div className="hud-overlay-title">Eres el Seeker</div>
          <div className="hud-overlay-sub">Los Hiders se están escondiendo…</div>
          {countdown !== null && <div className="hud-overlay-count">{countdown}s</div>}
          <div className="hud-overlay-hint">Podrás moverte y disparar cuando empiece la caza</div>
        </div>
      )}

      {/* Retícula central: para el Seeker (disparo) y para el Hider (punto de muestreo de E) */}
      {inRound && pointerLocked && !seekerWaiting && (
        <div className="hud-reticle">
          <div className="hud-reticle-dot" />
        </div>
      )}

      {/* Hit marker del Seeker: el servidor confirmó una captura */}
      {seekerHunting && hitMarker && (
        <>
          <div className="hud-hitmarker">✕</div>
          <div className="hud-hitmarker-label">🎯 ¡Atrapado!</div>
        </>
      )}

      {/* Munición del Seeker: solo en el MODO de munición limitada (opción del host,
          como el original). En el juego base es ilimitada y no se muestra contador. */}
      {seekerHunting && DEFAULT_SIM_CONFIG.ammoLimitEnabled && (
        <div className={`hud-ammo${status.ammo > 0 ? '' : ' hud-ammo--empty'}`}>
          {status.ammo > 0 ? `🔫 ${status.ammo} disparos` : '❌ sin munición'}
        </div>
      )}

      {/* Pila inferior: hint de pointer lock + pose + barra de camuflaje */}
      <div className="hud-bottom">
        {inRound && !pointerLocked && !seekerWaiting && (
          <span className="hud-chip">🖱 Haz clic en el juego para controlar la cámara (ESC suelta)</span>
        )}
        {showCamo && (
          <span className="hud-chip hud-chip--muted">
            🧘 Pose: {POSE_LABEL[status.pose] ?? 'De pie'} — R para cambiar
          </span>
        )}
        {showCamo && (
          <div className="hud-camo">
            <div className="hud-camo-head">
              <span>Camuflaje</span>
              <span className="hud-camo-pct">{camoPct}%</span>
            </div>
            <div className="hud-camo-track">
              <div
                className="hud-camo-fill"
                style={{ width: `${camoPct}%`, background: camoColor(status.camo) }}
              />
            </div>
            {phase === 'prep' && (
              <div className="hud-camo-tip">Absorbe (E) el color de tu escondite y quédate quieto</div>
            )}
          </div>
        )}
      </div>

      {/* Destello al ser atrapado */}
      {justCaught && (
        <div className="hud-overlay hud-overlay--caught">
          <div className="hud-overlay-title">¡Atrapado! Ahora eres Seeker 🔦</div>
        </div>
      )}

      {/* Lobby (V1-E): código compartible + jugadores + Empezar/Salir */}
      {phase === 'lobby' && (
        <div className="hud-lobby">
          <div className="hud-roomcode" role="status">
            <span className="hud-roomcode-label">Código de sala</span>
            <span className="hud-roomcode-value">{roomId ?? '…'}</span>
            <span className="hud-roomcode-hint">compártelo para que se unan</span>
          </div>
          <PlayerList />
          {isHost ? (
            <button type="button" onClick={onStart} className="hud-btn">
              ▶ Empezar partida
            </button>
          ) : (
            <span className="hud-chip hud-chip--muted">esperando a que el host inicie la partida…</span>
          )}
          <button type="button" onClick={onLeave} className="hud-btn hud-btn--leave">
            ← Salir de la sala
          </button>
        </div>
      )}

      {/* Tour de revelado (V1-F, answer-check): tarjeta del escondite en curso.
          La cámara (CameraRig) orbita el MISMO escondite; el panel final llega después. */}
      {phase === 'ended' && revealEntry && (
        <div className="hud-reveal">
          <div className="hud-reveal-step">
            🔎 Escondite {revealIdx + 1} / {revealList!.length}
          </div>
          <div className="hud-reveal-row">
            <span className="hud-swatch" style={{ background: packedToCss(revealEntry.colorPacked) }} />
            <span className={revealEntry.caught ? 'hud-reveal-caught' : 'hud-reveal-alive'}>
              {revealEntry.caught ? '✕ Atrapado' : '🦎 ¡Sobrevivió!'}
            </span>
            {revealEntry.id === localPlayerId && <span className="hud-reveal-you">(tú)</span>}
          </div>
          <div className="hud-reveal-meta">
            Camuflaje {Math.round(revealEntry.camoScore * 100)}% · Pose:{' '}
            {POSE_LABEL[revealEntry.pose] ?? 'De pie'}
          </div>
        </div>
      )}

      {/* Panel central de fin de ronda + "Jugar otra vez" (tras el tour) */}
      {phase === 'ended' && !revealEntry && (
        <div className="hud-overlay hud-overlay--end">
          <div className="hud-overlay-emoji">{outcome === 'hiders' ? '🦎' : outcome === 'seekers' ? '🔦' : '🏁'}</div>
          <div className="hud-overlay-title">
            {outcome === 'hiders'
              ? '¡Ganan los Hiders! Sobrevivió al menos uno.'
              : outcome === 'seekers'
                ? '¡Ganan los Seekers! Cayeron todos los Hiders.'
                : 'Ronda terminada'}
          </div>
          {isHost ? (
            <button type="button" onClick={onRestart} className="hud-btn">
              ↻ Jugar otra vez
            </button>
          ) : (
            <span className="hud-overlay-sub">esperando a que el host reinicie…</span>
          )}
        </div>
      )}
    </div>
  );
}
