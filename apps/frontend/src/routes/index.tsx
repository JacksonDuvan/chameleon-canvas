/**
 * Ruta '/' — pantalla de juego. Compone features; NO contiene lógica de juego
 * (skill `hexagonal-vertical-slicing`). El <Canvas> (WebGL) y el WebSocket son
 * client-only: se montan vía <ClientOnly> (fallback en SSR) para no romper la
 * hidratación de TanStack Start.
 */
import { ClientOnly, createFileRoute } from '@tanstack/react-router';
import { Canvas } from '@react-three/fiber';
import { Scene } from '@/features/canvas-3d/components/Scene';
import { useRaycastColor } from '@/features/canvas-3d/hooks/useRaycastColor';
import { useMouseLook } from '@/features/canvas-3d/hooks/useMouseLook';
import {
  useGameSockets,
  type GameSockets,
} from '@/features/matchmaking/hooks/useGameSockets';
import { useLocalInput } from '@/features/matchmaking/hooks/useLocalInput';
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
      <Game />
    </ClientOnly>
  );
}

function Game() {
  // TODO(matchmaking): roomId y nombre vendrán de RoomForm; fijos para el MVP.
  const sockets = useGameSockets('demo', 'Player');
  useLocalInput(sockets);

  return (
    <main style={{ position: 'fixed', inset: 0, margin: 0 }}>
      <Canvas shadows camera={{ position: [0, 12, 16], fov: 60 }}>
        {/* Fondo + niebla suave: profundidad visual barata (ayuda a leer distancias). */}
        <color attach="background" args={['#aebfd0']} />
        <fog attach="fog" args={['#aebfd0', 28, 70]} />
        <Scene />
        <Controles sockets={sockets} />
      </Canvas>
      <Hud
        onStart={() => sockets.sendControl({ type: 'start' })}
        onRestart={() => sockets.sendControl({ type: 'restart' })}
      />
    </main>
  );
}

/** Enlaza cuentagotas + mouse-look DENTRO del Canvas (useThree requiere el contexto R3F). */
function Controles({ sockets }: { sockets: GameSockets }) {
  useRaycastColor(sockets.sendControl);
  useMouseLook();
  return null;
}
