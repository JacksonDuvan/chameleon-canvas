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

  return (
    <main style={{ position: 'fixed', inset: 0, margin: 0 }}>
      {/* Renderer (spec r4): sombras PCFSoft + ACESFilmic con exposición 1.2
          para que los colores del camuflaje resalten. */}
      <Canvas
        shadows="soft"
        gl={{ toneMapping: THREE.ACESFilmicToneMapping, toneMappingExposure: 1.2 }}
        camera={{ position: [0, 12, 16], fov: 60 }}
      >
        {/* Niebla suave a color de horizonte (bajo el cielo de drei): profundidad barata.
            Casa 80×64: la niebla abre el rango para que los pasillos largos respiren. */}
        <color attach="background" args={['#cfdce8']} />
        <fog attach="fog" args={['#cfdce8', 60, 170]} />
        <Scene />
        <Controles sockets={sockets} />
      </Canvas>
      <Hud
        onStart={() => sockets.sendControl({ type: 'start' })}
        onRestart={() => sockets.sendControl({ type: 'restart' })}
        onLeave={onLeave}
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
