/**
 * Ruta '/' — pantalla de inicio (lobby/matchmaking). Compone features; el lienzo
 * 3D y la lógica viven en sus features, no aquí.
 *
 * SCAFFOLD del Paso 1 — Paso 4.
 */
import { createFileRoute } from '@tanstack/react-router';

export const Route = createFileRoute('/')({
  component: Home,
});

function Home() {
  return (
    <main>
      {/* TODO(Paso 4): <RoomForm/> + <Canvas><Scene/></Canvas> + HUD */}
      <h1>Meccha Chameleon Clone</h1>
    </main>
  );
}
