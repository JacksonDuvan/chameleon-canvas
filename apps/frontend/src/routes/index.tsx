/**
 * Ruta '/' — compone las features; NO contiene lógica de juego (skill
 * `hexagonal-vertical-slicing`). El <Canvas> (WebGL) y el WebSocket son
 * client-only: se montan vía <ClientOnly> (fallback en SSR) para no romper la
 * hidratación de TanStack Start.
 *
 * V1-E — flujo de matchmaking: sin sesión → RoomForm (nombre + crear/unirse por
 * código); con sesión → Game. La sesión vive en sessionStorage (cada pestaña es
 * un jugador: dos tabs = dos jugadores para probar).
 */
import { ClientOnly, createFileRoute } from '@tanstack/react-router';
import { useState } from 'react';
import { Canvas } from '@react-three/fiber';
import * as THREE from 'three';
import { Scene } from '@/features/canvas-3d/components/Scene';
import { useRaycastColor } from '@/features/canvas-3d/hooks/useRaycastColor';
import { useMouseLook, lookState } from '@/features/canvas-3d/hooks/useMouseLook';
import {
  useGameSockets,
  type GameSockets,
} from '@/features/matchmaking/hooks/useGameSockets';
import { useLocalInput } from '@/features/matchmaking/hooks/useLocalInput';
import {
  clearSession,
  readSession,
  saveSession,
  type Session,
} from '@/features/matchmaking/hooks/session';
import { RoomForm } from '@/features/matchmaking/components/RoomForm';
import { worldStore } from '@/features/canvas-3d/store/worldStore';
import { useAudio } from '@/features/canvas-3d/audio/useAudio';
import { Hud } from '@/shared/components/Hud';
import { PostFx } from '@/features/canvas-3d/components/PostFx';

const FX_KEY = 'mecha.fx';
/** Preferencia de gráficos (posprocesado). Por defecto ALTO; se recuerda por navegador. */
function readFx(): boolean {
  try {
    return window.localStorage.getItem(FX_KEY) !== 'off';
  } catch {
    return true;
  }
}

export const Route = createFileRoute('/')({ component: Home });

function Home() {
  return (
    <ClientOnly
      fallback={
        <main style={{ font: '16px system-ui, sans-serif', padding: 24 }}>
          <h1>🦎 Meccha Chameleon Clone</h1>
          <p>Cargando el lienzo 3D…</p>
        </main>
      }
    >
      <LobbyFlow />
    </ClientOnly>
  );
}

/** V1-E: RoomForm ⇄ Game según la sesión (el storage manda al recargar). */
function LobbyFlow() {
  const [session, setSession] = useState<Session | null>(() => readSession(sessionStorage));

  if (!session) {
    return (
      <RoomForm
        onEnter={(s) => {
          saveSession(sessionStorage, s);
          setSession(s);
        }}
      />
    );
  }
  return (
    <Game
      session={session}
      onLeave={() => {
        clearSession(sessionStorage);
        setSession(null);
      }}
    />
  );
}

function Game({ session, onLeave }: { session: Session; onLeave: () => void }) {
  const sockets = useGameSockets(session);
  useLocalInput(sockets);
  useAudio(); // V1-H: SFX + ambiente + silbidos (presentación pura)
  const [fx, setFx] = useState(readFx);
  const toggleFx = (): void => {
    const next = !fx;
    setFx(next);
    try {
      window.localStorage.setItem(FX_KEY, next ? 'on' : 'off');
    } catch {
      /* almacenamiento bloqueado: la preferencia vale solo para esta sesión */
    }
  };

  return (
    <main style={{ position: 'fixed', inset: 0, margin: 0 }}>
      {/* Renderer: sombras PCFSoft + tone mapping NEUTRAL (Khronos PBR Neutral; ACES
          desaturaba los tonos que hay que IGUALAR). El tone mapping lo aplica
          `PostFx` (al final de la cadena de efectos, o el renderer en modo bajo).
          dpr ≤1.5: el posprocesado a 2× en pantallas retina cuesta el doble. */}
      <Canvas
        shadows="soft"
        dpr={[1, 1.5]}
        gl={{ toneMapping: THREE.NoToneMapping, powerPreference: 'high-performance' }}
        camera={{ position: [0, 12, 16], fov: 60 }}
      >
        {/* Niebla suave a color de horizonte (bajo el cielo de drei): profundidad barata.
            Casa 80×64: la niebla abre el rango para que los pasillos largos respiren. */}
        <color attach="background" args={['#cfdce8']} />
        <fog attach="fog" args={['#cfdce8', 60, 170]} />
        <Scene />
        <Controles sockets={sockets} />
        <PostFx enabled={fx} />
      </Canvas>
      <Hud
        onStart={(seekers) => sockets.sendControl({ type: 'start', seekers })}
        onRestart={() => sockets.sendControl({ type: 'restart' })}
        onLeave={onLeave}
        fx={fx}
        onToggleFx={toggleFx}
      />
    </main>
  );
}

/** Enlaza cuentagotas + mouse-look DENTRO del Canvas (useThree requiere el contexto R3F). */
function Controles({ sockets }: { sockets: GameSockets }) {
  useRaycastColor(sockets.sendControl);
  useMouseLook();
  // SOLO en dev: expone store + mouse-look para las verificaciones E2E headless
  // (leer estado real / apuntar sin pointer lock, que es flaky en headless).
  // Nunca llega al build de producción.
  if (import.meta.env.DEV) {
    const w = window as unknown as Record<string, unknown>;
    w.__world = worldStore;
    w.__look = lookState;
  }
  return null;
}
